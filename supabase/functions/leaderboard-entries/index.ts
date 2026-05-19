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

function isMissingWcPredictionsError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || "")
    : "";
  return /does not exist|schema cache|Could not find/i.test(message);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}

function firstPublicDisplayText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && !looksLikeEmail(text)) return text;
  }
  return "";
}

function cleanProfile(storedProfile: Record<string, unknown> | null | undefined, profileRecord: Record<string, unknown>) {
  return {
    name: firstPublicDisplayText(profileRecord.name, storedProfile?.name),
    username: firstPublicDisplayText(profileRecord.username, storedProfile?.username),
    paid: true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const serviceKey = getSupabaseServiceKey();
    if (!serviceKey) return json({ error: "Leaderboard service is not configured." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth header" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: closed, error: closedError } = await supabase.rpc("entries_are_closed");
    if (closedError) {
      console.error("Could not check entries_are_closed:", closedError.message);
      return json({ error: "Could not check entry deadline." }, 500);
    }

    const { data: viewerProfile, error: viewerError } = await supabase
      .from("profiles")
      .select("paid")
      .eq("id", user.id)
      .maybeSingle();

    if (viewerError) {
      console.error("Could not read viewer profile:", viewerError.message);
      return json({ error: "Could not verify entry status." }, 500);
    }

    if (!closed && !viewerProfile?.paid) {
      return json({ error: "Leaderboard is available after payment." }, 403);
    }

    const { data: paidProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, name, username, paid")
      .eq("paid", true)
      .order("username", { ascending: true });

    if (profilesError) {
      console.error("Could not read paid profiles:", profilesError.message);
      return json({ error: "Could not load leaderboard entries." }, 500);
    }

    const ids = (paidProfiles || []).map((profile: { id: string }) => profile.id);
    const predictionsById = new Map<string, Record<string, unknown>>();
    if (closed && ids.length > 0) {
      const { data: predictionRows, error: predictionsError } = await supabase
        .from("wc_predictions")
        .select("id, profile, predictions")
        .in("id", ids);

      if (predictionsError && !isMissingWcPredictionsError(predictionsError)) {
        console.error("Could not read prediction rows:", predictionsError.message);
        return json({ error: "Could not load prediction rows." }, 500);
      }

      for (const row of predictionRows || []) {
        predictionsById.set(row.id, row);
      }
    }

    const entries = (paidProfiles || []).map((profile: Record<string, unknown>) => {
      const predictionRow = predictionsById.get(String(profile.id));
      return {
        id: profile.id,
        profile: cleanProfile(predictionRow?.profile as Record<string, unknown> | undefined, profile),
        predictions: closed ? predictionRow?.predictions || {} : {},
      };
    });

    return json({
      canView: true,
      closed: Boolean(closed),
      entryCount: entries.length,
      entries,
    });
  } catch (err) {
    console.error("leaderboard-entries error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
