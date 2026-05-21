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

function cleanText(value: unknown, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const jsonValue = JSON.stringify(value);
    if (jsonValue.length > 4000) return {};
    return JSON.parse(jsonValue);
  } catch {
    return {};
  }
}

async function getUserId(supabase: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.split(".").length < 3) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  return user?.id || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const serviceKey = getSupabaseServiceKey();
    if (!serviceKey) return json({ error: "Analytics service is not configured." }, 500);

    const body = await req.json().catch(() => ({}));
    const sessionId = cleanText(body.sessionId, 128);
    const eventType = cleanText(body.eventType || "page_view", 64);
    if (!/^[a-z0-9_:-]{1,64}$/.test(eventType)) return json({ error: "Invalid event type." }, 400);
    if (sessionId.length < 12) return json({ error: "Invalid analytics session." }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);
    const userId = await getUserId(supabase, req).catch(() => null);
    const screen = cleanText(body.screen, 64) || null;
    const path = cleanText(body.path, 255) || null;
    const referrer = cleanText(body.referrer, 255) || null;
    const userAgent = cleanText(req.headers.get("user-agent"), 512) || null;
    const now = new Date().toISOString();

    const { error: sessionError } = await supabase
      .from("analytics_sessions")
      .upsert({
        session_id: sessionId,
        user_id: userId,
        last_seen_at: now,
        current_screen: screen,
        current_path: path,
        referrer,
        user_agent: userAgent,
        is_authenticated: Boolean(userId),
      }, { onConflict: "session_id" });

    if (sessionError) {
      console.error("analytics session upsert failed:", sessionError.message);
      return json({ error: "Could not record analytics session." }, 500);
    }

    if (eventType !== "heartbeat") {
      const { error: eventError } = await supabase.from("analytics_events").insert({
        session_id: sessionId,
        user_id: userId,
        event_type: eventType,
        screen,
        path,
        referrer,
        metadata: cleanMetadata(body.metadata),
      });

      if (eventError) {
        console.error("analytics event insert failed:", eventError.message);
        return json({ error: "Could not record analytics event." }, 500);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error("analytics-track error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
