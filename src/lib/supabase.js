import { createClient, FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Service role JWTs must never run in the browser — Supabase rejects them with 401 / "Forbidden use of secret API key". */
function isLikelyServiceRoleKey(key) {
  if (!key || typeof key !== "string" || key.split(".").length < 2) return false;
  try {
    const b64 = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    const padded = b64 + (pad ? "=".repeat(4 - pad) : "");
    const payload = JSON.parse(atob(padded));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

if (import.meta.env.DEV && anonKey && isLikelyServiceRoleKey(anonKey)) {
  console.error(
    "[WC Predictions] VITE_SUPABASE_ANON_KEY is set to the service_role secret. Use the anon (public) key from Supabase → Project Settings → API. Never put the service_role key in frontend env files.",
  );
}

const clientKeyOk = Boolean(anonKey) && !isLikelyServiceRoleKey(anonKey);
export const isSupabaseConfigured = Boolean(url && clientKeyOk);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

/** Returns the current session or null (no automatic anonymous sign-in). */
export async function ensureSupabaseSession() {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ?? null;
}

/** True when the DB never had migration 001 / 006 (only 003 gives match_predictions, not wc_predictions). */
function isWcPredictionsMissingError(err) {
  const m = (err && err.message) || "";
  return (
    err?.code === "PGRST205" ||
    /Could not find the table ['"]public\.wc_predictions['"]/i.test(m) ||
    (/schema cache/i.test(m) && /wc_predictions/i.test(m))
  );
}

// ── Email / password ─────────────────────────────────────────────────────────

/**
 * Supabase rejects sign-up / password-reset with 422 if `redirect_to` is not allowlisted
 * (Authentication → URL Configuration → Redirect URLs). Passing `window.location.origin`
 * (e.g. http://localhost:5173) causes that unless every dev URL is added in the dashboard.
 *
 * Omitting redirect uses the project **Site URL** from the same screen for email links.
 * Set `VITE_AUTH_EMAIL_REDIRECT_URL` when you need an explicit redirect and have added it
 * to the allowlist (e.g. production URL).
 */
function authEmailRedirectUrl() {
  const v = import.meta.env.VITE_AUTH_EMAIL_REDIRECT_URL;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Turns Supabase Auth API errors into short messages for the signup / sign-in UI.
 * Keeps technical details out of toasts while still matching common codes and phrases.
 */
export function friendlyAuthMessage(rawMessage, code) {
  const c = code || "";
  const msg = typeof rawMessage === "string" ? rawMessage.trim() : "";
  const lower = msg.toLowerCase();

  if (c === "not_configured")
    return "Online accounts are not set up in this app yet. If this keeps happening, contact the organiser.";

  switch (c) {
    case "user_already_exists":
      return "That email already has an account. Use Sign in below (we can restore your league profile if needed).";
    case "invalid_credentials":
      return "Wrong email or password. Try again, or use Forgot password.";
    case "email_not_confirmed":
      return "Confirm your email first — open the link we sent you, then sign in.";
    case "weak_password":
      return "That password is too weak. Use at least 6 characters.";
    case "signup_disabled":
      return "New accounts are not open right now. Try again later or contact the organiser.";
    case "user_banned":
      return "This account cannot sign in. Contact support if you think this is a mistake.";
    default:
      break;
  }

  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid credentials") ||
    (lower.includes("email") && lower.includes("password") && lower.includes("invalid"))
  ) {
    return "Wrong email or password. Try again, or use Forgot password.";
  }
  if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
    return "Confirm your email first — open the link we sent you, then sign in.";
  }
  if (lower.includes("already been registered") || lower.includes("user already registered")) {
    return "That email already has an account. Use Sign in below.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("too many")) {
    return "Too many attempts — wait a minute, then try again.";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch")) {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (lower.includes("422") || lower.includes("redirect") || lower.includes("redirect_uri")) {
    return "Email link settings need updating on the server — ask the organiser to check Supabase redirect URLs.";
  }

  if (!msg) return "Something went wrong. Please try again.";
  return msg;
}

export async function signUpWithPassword({ email, password, name, username }) {
  if (!supabase) return { ok: false, error: friendlyAuthMessage(null, "not_configured"), errorCode: "not_configured" };
  const emailRedirectTo = authEmailRedirectUrl();
  const options = { data: { name, username: username || "" } };
  if (emailRedirectTo) options.emailRedirectTo = emailRedirectTo;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options,
  });
  if (error)
    return {
      ok: false,
      error: friendlyAuthMessage(error.message, error.code),
      errorCode: error.code,
    };
  return { ok: true, session: data.session, user: data.user };
}

export async function signInWithPassword({ email, password }) {
  if (!supabase) return { ok: false, error: friendlyAuthMessage(null, "not_configured"), errorCode: "not_configured" };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error)
    return {
      ok: false,
      error: friendlyAuthMessage(error.message, error.code),
      errorCode: error.code,
    };
  return { ok: true, session: data.session };
}

export async function requestPasswordReset(email) {
  if (!supabase) return { ok: false, error: friendlyAuthMessage(null, "not_configured"), errorCode: "not_configured" };
  const redirectTo = authEmailRedirectUrl();
  const opts = redirectTo ? { redirectTo } : {};
  const { error } = await supabase.auth.resetPasswordForEmail(email, opts);
  if (error)
    return {
      ok: false,
      error: friendlyAuthMessage(error.message, error.code),
      errorCode: error.code,
    };
  return { ok: true };
}

// ── Profile ──────────────────────────────────────────────────────────────────
// Landing-page signup creates a row with paid=false / locked=false. Stripe webhook
// (checkout.session.completed) sets paid=true and locked=true after payment.

export async function upsertProfile({ name, email, username }) {
  if (!supabase) return { ok: false, error: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { ok: false, error: "no_session" };

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", session.user.id)
    .maybeSingle();

  const base = {
    name,
    email,
    username: username || `user_${session.user.id.slice(0, 8)}`,
  };

  if (!existing) {
    const { error } = await supabase.from("profiles").insert({
      id: session.user.id,
      ...base,
      paid: false,
      locked: false,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from("profiles").update(base).eq("id", session.user.id);
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

/**
 * Supabase stores users in auth.users; this app uses public.profiles. Those can get out of sync:
 * e.g. profile row deleted, or sign-up failed after the auth user was created. Sign-in then works
 * but fetchProfile is empty. This inserts (or updates) a profile row using the JWT email + metadata.
 */
export async function ensureProfileFromAuthSession() {
  if (!supabase) return { ok: false, error: "not_configured", profile: null, created: false };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { ok: false, error: "no_session", profile: null, created: false };

  const existing = await fetchProfile();
  if (existing) return { ok: true, profile: existing, created: false };

  const u = session.user;
  const meta = u.user_metadata && typeof u.user_metadata === "object" ? u.user_metadata : {};
  const email = typeof u.email === "string" ? u.email.trim() : "";
  const nameFromMeta = typeof meta.name === "string" ? meta.name.trim() : "";
  const name = nameFromMeta || (email ? email.split("@")[0] : "") || "Player";
  const usernameFromMeta = typeof meta.username === "string" ? meta.username.trim() : "";
  const username = usernameFromMeta || `user_${u.id.slice(0, 8)}`;

  const up = await upsertProfile({ name, email, username });
  if (!up.ok) return { ok: false, error: up.error, profile: null, created: false };

  const profile = await fetchProfile();
  return { ok: true, profile, created: true };
}

// ── Legacy predictions (backward compatible) ─────────────────────────────────

export async function fetchPredictionsRow() {
  if (!supabase) return null;
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return null;
  const { data, error } = await supabase
    .from("wc_predictions")
    .select("predictions, profile, updated_at")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) {
    if (!isWcPredictionsMissingError(error)) console.warn("fetchPredictionsRow:", error.message);
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
    if (!isWcPredictionsMissingError(error)) console.warn("fetchAllPredictions:", error.message);
    return [];
  }
  return data || [];
}

const OUTRIGHT_KEYS = [
  "winner",
  "runner_up",
  "third",
  "golden_boot",
  "golden_glove",
  "best_young",
  "top_scoring_team",
  "england_progress",
  "total_goals",
];

const STAT_KEYS = ["total_goals"];

function parseSmallGoal(v) {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Writes match_predictions, standings_predictions, outright_predictions, stat_predictions (full schema). */
export async function syncNormalizedPredictions(predictions) {
  if (!supabase) return { ok: false, error: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { ok: false, error: "no_session" };
  const uid = session.user.id;

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("locked")
    .eq("id", uid)
    .maybeSingle();

  if (profErr) {
    if (/does not exist|schema cache|Could not find/i.test(profErr.message || "")) {
      return { ok: true, skipped: true };
    }
    return { ok: false, error: profErr.message };
  }
  if (!prof) {
    return { ok: true, skipped: true };
  }
  if (prof.locked) return { ok: true };

  const pred = predictions && typeof predictions === "object" ? predictions : {};

  const del = async (table) => {
    const { error } = await supabase.from(table).delete().eq("user_id", uid);
    if (error && /does not exist|schema cache|Could not find/i.test(error.message || "")) {
      return { skip: true };
    }
    if (error) return { error };
    return {};
  };

  const matchRows = [];
  for (const [key, raw] of Object.entries(pred)) {
    if (!key.includes("-") || key.startsWith("standings_")) continue;
    const v = raw && typeof raw === "object" ? raw : {};
    const home_goals = parseSmallGoal(v.home);
    const away_goals = parseSmallGoal(v.away);
    const scorer = v.scorer && String(v.scorer).trim() ? String(v.scorer) : null;
    if (home_goals === null && away_goals === null && !scorer) continue;
    matchRows.push({
      user_id: uid,
      match_key: key,
      home_goals,
      away_goals,
      scorer,
    });
  }

  const standingsRows = [];
  for (const [key, raw] of Object.entries(pred)) {
    if (!key.startsWith("standings_")) continue;
    const letter = key.slice("standings_".length).slice(0, 1);
    if (!letter) continue;
    const arr = Array.isArray(raw) ? raw : [];
    if (!arr.some((x) => x != null && x !== "")) continue;
    standingsRows.push({
      user_id: uid,
      group_letter: letter,
      position_1: arr[0] != null && arr[0] !== "" ? String(arr[0]) : null,
      position_2: arr[1] != null && arr[1] !== "" ? String(arr[1]) : null,
      position_3: arr[2] != null && arr[2] !== "" ? String(arr[2]) : null,
      position_4: arr[3] != null && arr[3] !== "" ? String(arr[3]) : null,
    });
  }

  const outrightRows = [];
  for (const k of OUTRIGHT_KEYS) {
    const val = pred[k];
    if (val === undefined || val === null || val === "") continue;
    outrightRows.push({
      user_id: uid,
      prediction_type: k,
      value: String(val),
    });
  }

  const statRows = [];
  for (const k of STAT_KEYS) {
    const val = pred[k];
    if (val === undefined || val === null || val === "") continue;
    statRows.push({
      user_id: uid,
      stat_key: k,
      value: String(val),
    });
  }

  const t1 = await del("match_predictions");
  if (t1.error) return { ok: false, error: t1.error.message };
  if (t1.skip) return { ok: true, skipped: true };

  const t2 = await del("standings_predictions");
  if (t2.error) return { ok: false, error: t2.error.message };
  const t3 = await del("outright_predictions");
  if (t3.error) return { ok: false, error: t3.error.message };
  const t4 = await del("stat_predictions");
  if (t4.error) return { ok: false, error: t4.error.message };

  if (matchRows.length) {
    const { error } = await supabase.from("match_predictions").insert(matchRows);
    if (error) return { ok: false, error: error.message };
  }
  if (standingsRows.length) {
    const { error } = await supabase.from("standings_predictions").insert(standingsRows);
    if (error) return { ok: false, error: error.message };
  }
  if (outrightRows.length) {
    const { error } = await supabase.from("outright_predictions").insert(outrightRows);
    if (error) return { ok: false, error: error.message };
  }
  if (statRows.length) {
    const { error } = await supabase.from("stat_predictions").insert(statRows);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function upsertPredictions(predictions, profilePatch) {
  if (!supabase) return { ok: false, error: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { ok: false, error: "no_session" };

  const patch = profilePatch && typeof profilePatch === "object" ? profilePatch : {};

  let prof = await fetchProfile();
  if (!prof) {
    const ensured = await ensureProfileFromAuthSession();
    prof = ensured.profile;
    if (!prof) {
      return { ok: false, error: ensured.error || "no_profile — sign in again or complete your profile" };
    }
  }
  if (prof.locked) return { ok: false, error: "predictions_locked" };

  const profileSnapshot = {
    name: patch.name ?? prof.name,
    username: patch.username ?? prof.username,
  };

  let existingProfileJson = {};
  const sel = await supabase
    .from("wc_predictions")
    .select("profile")
    .eq("id", session.user.id)
    .maybeSingle();

  if (sel.error) {
    if (!isWcPredictionsMissingError(sel.error)) return { ok: false, error: sel.error.message };
  } else if (sel.data?.profile && typeof sel.data.profile === "object") {
    existingProfileJson = sel.data.profile;
  }

  const row = {
    id: session.user.id,
    predictions,
    updated_at: new Date().toISOString(),
    profile: { ...existingProfileJson, ...profileSnapshot },
  };

  if (!sel.error) {
    const { error: upErr } = await supabase.from("wc_predictions").upsert(row, {
      onConflict: "id",
    });
    if (upErr) {
      if (!isWcPredictionsMissingError(upErr)) return { ok: false, error: upErr.message };
      if (import.meta.env.DEV) {
        console.warn(
          "[WC Predictions] public.wc_predictions is missing — run supabase/migrations/006_wc_predictions_table.sql in the SQL Editor. Saving normalized tables only.",
        );
      }
    }
  } else if (import.meta.env.DEV) {
    console.warn(
      "[WC Predictions] public.wc_predictions is missing — run supabase/migrations/006_wc_predictions_table.sql. Saving normalized tables only.",
    );
  }

  const sync = await syncNormalizedPredictions(predictions);
  if (!sync.ok) return { ok: false, error: sync.error || "normalized_sync_failed" };
  return { ok: true };
}

// ── Stripe Payment ───────────────────────────────────────────────────────────

export async function createCheckoutSession() {
  if (!supabase) return { ok: false, error: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.access_token) return { ok: false, error: "no_session" };

  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: { origin: window.location.origin },
    timeout: 45_000,
  });

  if (error) {
    let message = error.message || "Checkout request failed";
    if (error instanceof FunctionsHttpError && error.context) {
      try {
        const ct = error.context.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const body = await error.context.json();
          if (body?.error && typeof body.error === "string") message = body.error;
        }
      } catch {
        /* ignore parse errors */
      }
    }
    if (error instanceof FunctionsFetchError) {
      message = `Could not reach payment service: ${error.message}`;
    }
    console.warn("[create-checkout]", message);
    return { ok: false, error: message };
  }

  if (data?.error) return { ok: false, error: data.error, paid: data.paid };
  if (data?.url && typeof data.url === "string") return { ok: true, url: data.url };
  return { ok: false, error: "No checkout URL returned — is the create-checkout function deployed?" };
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
