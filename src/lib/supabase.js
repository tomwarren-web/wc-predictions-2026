import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export async function ensureSupabaseSession() {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return session;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn("Supabase anonymous sign-in failed:", error.message);
    return null;
  }
  return data.session;
}

// ── Profile ──────────────────────────────────────────────────────────────────

export async function upsertProfile({ name, email, username }) {
  if (!supabase) return { ok: false, error: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { ok: false, error: "no_session" };

  const { error } = await supabase.from("profiles").upsert(
    {
      id: session.user.id,
      name,
      email,
      username: username || `user_${session.user.id.slice(0, 8)}`,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchProfile() {
  if (!supabase) return null;
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) {
    console.warn("fetchProfile:", error.message);
    return null;
  }
  return data;
}

// ── Legacy predictions (backward compatible) ─────────────────────────────────

export async function fetchPredictionsRow() {
  if (!supabase) return null;
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from("wc_predictions")
    .select("predictions, profile")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) {
    console.warn("fetchPredictionsRow:", error.message);
    return null;
  }
  return data;
}

export async function fetchAllPredictions() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("wc_predictions")
    .select("id, profile, predictions");
  if (error) {
    console.warn("fetchAllPredictions:", error.message);
    return [];
  }
  return data || [];
}

export async function upsertPredictions(predictions, profilePatch) {
  if (!supabase) return { ok: false, error: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { ok: false, error: "no_session" };

  const row = {
    id: session.user.id,
    predictions,
    updated_at: new Date().toISOString(),
  };
  if (profilePatch && Object.keys(profilePatch).length) {
    const { data: existing } = await supabase
      .from("wc_predictions")
      .select("profile")
      .eq("id", session.user.id)
      .maybeSingle();
    row.profile = { ...(existing?.profile || {}), ...profilePatch };
  }

  const { error } = await supabase.from("wc_predictions").upsert(row, {
    onConflict: "id",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Stripe Payment ───────────────────────────────────────────────────────────

export async function createCheckoutSession() {
  if (!supabase) return { ok: false, error: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.access_token) return { ok: false, error: "no_session" };

  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: { origin: window.location.origin },
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error, paid: data.paid };
  if (data?.url) return { ok: true, url: data.url };
  return { ok: false, error: "No checkout URL returned" };
}

export async function checkPaymentStatus() {
  if (!supabase) return { paid: false };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { paid: false };

  const { data } = await supabase
    .from("payments")
    .select("status")
    .eq("user_id", session.user.id)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();

  return { paid: Boolean(data) };
}

// ── Email ────────────────────────────────────────────────────────────────────

export async function sendEmail(to, type, data = {}) {
  if (!supabase) return { ok: false };
  const session = await ensureSupabaseSession();

  const { data: res, error } = await supabase.functions.invoke("send-email", {
    body: {
      to,
      type,
      data: { ...data, appUrl: window.location.origin },
      userId: session?.user?.id || null,
    },
  });

  if (error) {
    console.warn("sendEmail:", error.message);
    return { ok: false };
  }
  return { ok: true, id: res?.id };
}
