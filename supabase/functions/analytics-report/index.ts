import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function getSupabaseServiceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const singleSecret = Deno.env.get("SUPABASE_SECRET_KEY");
  if (singleSecret) return singleSecret;
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (typeof parsed.default === "string") return parsed.default;
      const first = Object.values(parsed).find((value) => typeof value === "string");
      if (typeof first === "string") return first;
    } catch {
      console.warn("SUPABASE_SECRET_KEYS was not valid JSON");
    }
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminEmails() {
  return (Deno.env.get("ANALYTICS_ADMIN_EMAILS") || Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function dayKey(value: string) {
  return value.slice(0, 10);
}

function topEntries(map: Map<string, number>, limit = 10) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function inc(map: Map<string, number>, key: string | null | undefined, by = 1) {
  const label = key && key.trim() ? key.trim() : "unknown";
  map.set(label, (map.get(label) || 0) + by);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const serviceKey = getSupabaseServiceKey();
    if (!serviceKey) return json({ error: "Analytics service is not configured." }, 500);

    const allowedEmails = adminEmails();
    if (allowedEmails.length === 0) {
      return json({ error: "Analytics admin emails are not configured." }, 403);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth header" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user?.email) return json({ error: "Unauthorized" }, 401);
    if (!allowedEmails.includes(user.email.toLowerCase())) {
      return json({ error: "Analytics is admin only." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const days = Math.min(90, Math.max(1, Number(body.days) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const liveSince = new Date(Date.now() - 5 * 60 * 1000);

    const { data: events, error: eventsError } = await supabase
      .from("analytics_events")
      .select("created_at, session_id, user_id, event_type, screen, path")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(10000);

    if (eventsError) {
      console.error("analytics event report failed:", eventsError.message);
      return json({ error: "Could not load analytics events." }, 500);
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from("analytics_sessions")
      .select("session_id, user_id, first_seen_at, last_seen_at, current_screen, is_authenticated")
      .gte("last_seen_at", since.toISOString())
      .order("last_seen_at", { ascending: false })
      .limit(10000);

    if (sessionsError) {
      console.error("analytics session report failed:", sessionsError.message);
      return json({ error: "Could not load analytics sessions." }, 500);
    }

    const allEvents = events || [];
    const allSessions = sessions || [];
    const pageViews = allEvents.filter((event) => event.event_type === "page_view");
    const uniqueSessions = new Set(allEvents.map((event) => event.session_id).filter(Boolean));
    const signedInUsers = new Set(allEvents.map((event) => event.user_id).filter(Boolean));

    const dailyMap = new Map<string, number>();
    const screenMap = new Map<string, number>();
    const eventTypeMap = new Map<string, number>();
    const liveScreenMap = new Map<string, number>();

    for (const event of allEvents) {
      inc(eventTypeMap, event.event_type);
      if (event.event_type === "page_view") {
        inc(dailyMap, dayKey(event.created_at));
        inc(screenMap, event.screen || event.path);
      }
    }

    const liveSessions = allSessions.filter((session) =>
      session.last_seen_at && new Date(session.last_seen_at).getTime() >= liveSince.getTime()
    );
    for (const session of liveSessions) {
      inc(liveScreenMap, session.current_screen);
    }

    const pageViewsBySession = new Map<string, Array<{ screen: string; created_at: string }>>();
    for (const event of pageViews) {
      if (!event.session_id) continue;
      const label = event.screen || event.path || "unknown";
      const list = pageViewsBySession.get(event.session_id) || [];
      list.push({ screen: label, created_at: event.created_at });
      pageViewsBySession.set(event.session_id, list);
    }

    const transitionMap = new Map<string, number>();
    for (const views of pageViewsBySession.values()) {
      let previous = "";
      for (const view of views.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        if (previous && previous !== view.screen) {
          inc(transitionMap, `${previous} -> ${view.screen}`);
        }
        previous = view.screen;
      }
    }

    return json({
      days,
      generatedAt: new Date().toISOString(),
      totals: {
        pageViews: pageViews.length,
        events: allEvents.length,
        uniqueVisitors: uniqueSessions.size,
        signedInUsers: signedInUsers.size,
        liveUsers: liveSessions.length,
      },
      dailyViews: topEntries(dailyMap, days).sort((a, b) => a.label.localeCompare(b.label)),
      screens: topEntries(screenMap, 12),
      eventsByType: topEntries(eventTypeMap, 12),
      liveScreens: topEntries(liveScreenMap, 8),
      flows: topEntries(transitionMap, 12),
      recentEvents: allEvents.slice(-12).reverse(),
    });
  } catch (err) {
    console.error("analytics-report error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
