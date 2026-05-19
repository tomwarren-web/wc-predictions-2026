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

function passwordResetRedirectUrl() {
  const explicit = import.meta.env.VITE_AUTH_PASSWORD_RESET_REDIRECT_URL || authEmailRedirectUrl();
  if (!explicit) return undefined;
  try {
    const u = new URL(explicit);
    u.searchParams.set("reset-password", "1");
    return u.toString();
  } catch {
    return explicit;
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}

function firstPublicDisplayText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && !looksLikeEmail(text)) return text;
  }
  return "";
}

export function publicLeaderboardProfile(profile, fallback = {}) {
  return {
    name: firstPublicDisplayText(profile?.name, fallback?.name),
    username: firstPublicDisplayText(profile?.username, fallback?.username),
    paid: Boolean(profile?.paid ?? fallback?.paid),
  };
}

function normalizeEmail(email) {
  return cleanText(email).toLowerCase();
}

function defaultUsernameForUser(userId) {
  const suffix = cleanText(userId).replace(/-/g, "").slice(0, 8) || `${Date.now()}`;
  return `user_${suffix}`;
}

function usernameTakenError(error) {
  const msg = `${cleanText(error?.message)} ${cleanText(error?.details)}`.toLowerCase();
  return (
    error?.code === "23505" &&
    (msg.includes("username") || msg.includes("profiles_username_idx") || msg.includes("profiles_username_key"))
  );
}

function profileIdConflictError(error) {
  const msg = `${cleanText(error?.message)} ${cleanText(error?.details)}`.toLowerCase();
  return error?.code === "23505" && (msg.includes("profiles_pkey") || msg.includes("id"));
}

function networkErrorMessage(lower) {
  return lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch");
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
    case "email_address_invalid":
      return "Enter a valid email address.";
    case "email_not_confirmed":
      return "Confirm your email first, then sign in.";
    case "weak_password":
      return "That password is too weak. Use at least 6 characters.";
    case "signup_disabled":
      return "New accounts are not open right now. Try again later or contact the organiser.";
    case "user_banned":
      return "This account cannot sign in. Contact support if you think this is a mistake.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
    case "rate_limit_exceeded":
      return "Too many attempts. Wait a minute, then try again.";
    case "validation_failed":
      return "Check the details and try again.";
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
    return "Confirm your email first, then sign in.";
  }
  if (lower.includes("already been registered") || lower.includes("user already registered")) {
    return "That email already has an account. Use Sign in below.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("too many")) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  if (networkErrorMessage(lower)) {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (lower.includes("422") || lower.includes("redirect") || lower.includes("redirect_uri")) {
    return "Email link settings need updating on the server. Ask the organiser to check Supabase redirect URLs.";
  }
  if (
    lower.includes("database error saving new user") ||
    lower.includes("duplicate key") ||
    lower.includes("profiles_username")
  ) {
    return "We could not finish creating your profile. Try a different display username, then try again.";
  }

  if (!msg) return "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}

export function friendlyProfileMessage(rawMessage, code) {
  const c = code || "";
  const msg = cleanText(rawMessage);
  const lower = msg.toLowerCase();

  if (c === "not_configured")
    return "Online accounts are not set up in this app yet. If this keeps happening, contact the organiser.";
  if (c === "no_session") return "Your sign-in expired. Sign in again to continue.";
  if (usernameTakenError({ code: c, message: msg })) return "That display username is already taken. Choose another one.";
  if (c === "23503" || lower.includes("foreign key")) return "Your account profile is still being created. Try again in a moment.";
  if (c === "42501" || lower.includes("row-level security") || lower.includes("permission denied")) {
    return "We could not save your profile with this session. Sign in again and try once more.";
  }
  if (networkErrorMessage(lower)) return "Could not reach the server. Check your connection and try again.";
  if (lower.includes("server-managed fields")) return "Payment status is managed by the server and cannot be changed here.";

  return "We could not save your profile. Please try again.";
}

export async function signUpWithPassword({ email, password, name, username }) {
  if (!supabase) return { ok: false, error: friendlyAuthMessage(null, "not_configured"), errorCode: "not_configured" };
  const emailRedirectTo = authEmailRedirectUrl();
  const cleanEmail = normalizeEmail(email);
  const options = { data: { name: cleanText(name), username: cleanText(username) } };
  if (emailRedirectTo) options.emailRedirectTo = emailRedirectTo;
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options,
  });
  if (error)
    return {
      ok: false,
      error: friendlyAuthMessage(error.message, error.code),
      errorCode: error.code,
    };
  if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
    return {
      ok: false,
      error: friendlyAuthMessage("User already registered", "user_already_exists"),
      errorCode: "user_already_exists",
    };
  }
  if (data.session) return { ok: true, session: data.session, user: data.user };

  // If Confirm email is enabled, Supabase returns a user but no session.
  // Check once for immediate-session projects, then ask the user to confirm.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return { ok: true, session, user: data.user };
  return {
    ok: true,
    session: null,
    user: data.user,
    needsEmailConfirmation: true,
    message: "Check your email to confirm your account, then sign in.",
  };
}

export async function signInWithPassword({ email, password }) {
  if (!supabase) return { ok: false, error: friendlyAuthMessage(null, "not_configured"), errorCode: "not_configured" };
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(Object.assign(new Error("Request timed out"), { code: "timeout" })), 20000);
  });
  try {
    const { data, error } = await Promise.race([
      supabase.auth.signInWithPassword({ email: normalizeEmail(email), password }),
      timeout,
    ]);
    if (error)
      return {
        ok: false,
        error: friendlyAuthMessage(error.message, error.code),
        errorCode: error.code,
      };
    return { ok: true, session: data.session, user: data.user };
  } catch (err) {
    return {
      ok: false,
      error: err.code === "timeout"
        ? "Sign in timed out — check your connection and try again."
        : friendlyAuthMessage(err.message, err.code),
      errorCode: err.code || "network_error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestPasswordReset(email) {
  if (!supabase) return { ok: false, error: friendlyAuthMessage(null, "not_configured"), errorCode: "not_configured" };
  const redirectTo = passwordResetRedirectUrl();
  const opts = redirectTo ? { redirectTo } : {};
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), opts);
  if (error)
    return {
      ok: false,
      error: friendlyAuthMessage(error.message, error.code),
      errorCode: error.code,
    };
  return { ok: true };
}

// ── Profile ──────────────────────────────────────────────────────────────────
// Supabase Auth owns credentials. The DB trigger creates public.profiles; the
// client only updates editable profile fields or repairs old rows missing one.
// Stripe webhook (checkout.session.completed) sets paid=true. The deadline
// setting, not payment, decides when predictions become locked.

export async function updatePassword(password) {
  if (!supabase) return { ok: false, error: friendlyAuthMessage(null, "not_configured"), errorCode: "not_configured" };
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error)
    return {
      ok: false,
      error: friendlyAuthMessage(error.message, error.code),
      errorCode: error.code,
    };
  return { ok: true, user: data?.user || null };
}

export async function upsertProfile({ name, email, username }) {
  if (!supabase) return { ok: false, error: friendlyProfileMessage(null, "not_configured"), errorCode: "not_configured" };
  const session = await ensureSupabaseSession();
  if (!session?.user?.id) return { ok: false, error: friendlyProfileMessage(null, "no_session"), errorCode: "no_session" };

  const meta = session.user.user_metadata && typeof session.user.user_metadata === "object" ? session.user.user_metadata : {};
  const emailFromSession = normalizeEmail(session.user.email);
  const profilePatch = {
    name: cleanText(name) || cleanText(meta.name) || (emailFromSession ? emailFromSession.split("@")[0] : "Player"),
    email: normalizeEmail(email) || emailFromSession,
    username: cleanText(username) || cleanText(meta.username) || defaultUsernameForUser(session.user.id),
  };

  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();
  if (existingError) {
    return {
      ok: false,
      error: friendlyProfileMessage(`${existingError.message || ""} ${existingError.details || ""}`, existingError.code),
      errorCode: existingError.code,
    };
  }

  if (existing) {
    const { data, error } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("id", session.user.id)
      .select("*")
      .maybeSingle();
    if (error)
      return {
        ok: false,
        error: friendlyProfileMessage(`${error.message || ""} ${error.details || ""}`, error.code),
        errorCode: error.code,
      };
    return { ok: true, profile: data || { ...existing, ...profilePatch } };
  }

  const insertPayload = {
    id: session.user.id,
    ...profilePatch,
    paid: false,
    locked: false,
  };

  const insertProfile = async (payload) =>
    supabase
      .from("profiles")
      .insert(payload)
      .select("*")
      .maybeSingle();

  let { data, error } = await insertProfile(insertPayload);

  if (profileIdConflictError(error)) {
    const latest = await fetchProfile();
    if (latest) {
      const update = await supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", session.user.id)
        .select("*")
        .maybeSingle();
      if (!update.error) return { ok: true, profile: update.data || { ...latest, ...profilePatch } };
      error = update.error;
    }
  }

  if (usernameTakenError(error)) {
    const retryPayload = { ...insertPayload, username: defaultUsernameForUser(session.user.id) };
    const retry = await insertProfile(retryPayload);
    data = retry.data;
    error = retry.error;
    if (!error) {
      return {
        ok: true,
        profile: data || retryPayload,
        warning: "That display username was taken, so we assigned a unique one for now.",
      };
    }
  }

  if (error)
    return {
      ok: false,
      error: friendlyProfileMessage(`${error.message || ""} ${error.details || ""}`, error.code),
      errorCode: error.code,
    };
  return { ok: true, profile: data || insertPayload };
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

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await fetchProfile();
    if (existing) return { ok: true, profile: existing, created: false };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const u = session.user;
  const meta = u.user_metadata && typeof u.user_metadata === "object" ? u.user_metadata : {};
  const email = normalizeEmail(u.email);
  const nameFromMeta = cleanText(meta.name);
  const name = nameFromMeta || (email ? email.split("@")[0] : "") || "Player";
  const usernameFromMeta = cleanText(meta.username);
  const username = usernameFromMeta || defaultUsernameForUser(u.id);

  const up = await upsertProfile({ name, email, username });
  if (!up.ok) return { ok: false, error: up.error, profile: null, created: false };

  const profile = up.profile || (await fetchProfile());
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
  const { data: leaderboardData, error: leaderboardError } = await supabase.functions.invoke("leaderboard-entries", {
    body: {},
    timeout: 20_000,
  });

  if (!leaderboardError && Array.isArray(leaderboardData?.entries)) {
    return leaderboardData.entries.map((entry) => ({
      ...entry,
      profile: publicLeaderboardProfile(entry?.profile),
    }));
  }

  if (leaderboardError instanceof FunctionsHttpError && leaderboardError.context?.status === 403) {
    return [];
  }

  if (leaderboardError && import.meta.env.DEV) {
    console.warn("[leaderboard-entries]", leaderboardError.message);
  }

  const { data, error } = await supabase
    .from("wc_predictions")
    .select("id, profile, predictions");
  if (error) {
    if (!isWcPredictionsMissingError(error)) console.warn("fetchAllPredictions:", error.message);
    return [];
  }
  return (data || []).map((entry) => ({
    ...entry,
    profile: publicLeaderboardProfile(entry?.profile),
  }));
}

export async function fetchTournamentSettings() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["entry_deadline_iso", "first_match_kickoff_iso"]);

  if (error) {
    const msg = error.message || "";
    if (!/does not exist|schema cache|Could not find/i.test(msg)) {
      console.warn("fetchTournamentSettings:", msg);
    }
    return null;
  }

  const byKey = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return {
    entryDeadlineIso: byKey.entry_deadline_iso || null,
    firstKickoffIso: byKey.first_match_kickoff_iso || null,
  };
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
const MAX_MATCH_GOALS = 20;

function parseSmallGoal(v) {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  if (whole < 0 || whole > MAX_MATCH_GOALS) return null;
  return whole;
}

function isMissingNormalizedTableError(error) {
  return /does not exist|schema cache|Could not find/i.test(error?.message || "");
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

  const upsertRows = async (table, rows, onConflict) => {
    if (!rows.length) return {};
    const { error } = await supabase.from(table).upsert(rows, { onConflict });
    if (error && isMissingNormalizedTableError(error)) return { skip: true };
    if (error) return { error };
    return {};
  };

  const deleteStaleRows = async (table, keyColumn, keepValues) => {
    const { data, error } = await supabase
      .from(table)
      .select(keyColumn)
      .eq("user_id", uid);
    if (error && isMissingNormalizedTableError(error)) return { skip: true };
    if (error) return { error };

    const keep = new Set(keepValues);
    const stale = (data || [])
      .map((row) => row[keyColumn])
      .filter((value) => value != null && value !== "" && !keep.has(value));

    for (let i = 0; i < stale.length; i += 50) {
      const batch = stale.slice(i, i + 50);
      const { error: delError } = await supabase
        .from(table)
        .delete()
        .eq("user_id", uid)
        .in(keyColumn, batch);
      if (delError) return { error: delError };
    }
    return {};
  };

  const writes = [
    await upsertRows("match_predictions", matchRows, "user_id,match_key"),
    await upsertRows("standings_predictions", standingsRows, "user_id,group_letter"),
    await upsertRows("outright_predictions", outrightRows, "user_id,prediction_type"),
    await upsertRows("stat_predictions", statRows, "user_id,stat_key"),
  ];
  for (const result of writes) {
    if (result.skip) return { ok: true, skipped: true };
    if (result.error) return { ok: false, error: result.error.message };
  }

  const deletes = [
    await deleteStaleRows("match_predictions", "match_key", matchRows.map((row) => row.match_key)),
    await deleteStaleRows("standings_predictions", "group_letter", standingsRows.map((row) => row.group_letter)),
    await deleteStaleRows("outright_predictions", "prediction_type", outrightRows.map((row) => row.prediction_type)),
    await deleteStaleRows("stat_predictions", "stat_key", statRows.map((row) => row.stat_key)),
  ];
  for (const result of deletes) {
    if (result.skip) return { ok: true, skipped: true };
    if (result.error) return { ok: false, error: result.error.message };
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
      return { ok: false, error: ensured.error || "We could not load your profile. Sign in again, then try once more." };
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
    let responseBody = null;
    if (error instanceof FunctionsHttpError && error.context) {
      try {
        const ct = error.context.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          responseBody = await error.context.json();
          if (responseBody?.error && typeof responseBody.error === "string") {
            message = responseBody.error;
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }
    if (error instanceof FunctionsFetchError) {
      message = `Could not reach payment service: ${error.message}`;
    }
    console.warn("[create-checkout]", message);
    return {
      ok: false,
      error: message,
      paid: Boolean(responseBody?.paid),
      locked: Boolean(responseBody?.locked),
      checkoutInProgress: Boolean(responseBody?.checkoutInProgress),
    };
  }

  if (data?.error) {
    return {
      ok: false,
      error: data.error,
      paid: Boolean(data.paid),
      locked: Boolean(data.locked),
      checkoutInProgress: Boolean(data.checkoutInProgress),
    };
  }
  if (data?.url && typeof data.url === "string") {
    return { ok: true, url: data.url, checkoutInProgress: Boolean(data.checkoutInProgress) };
  }
  return { ok: false, error: "No checkout URL returned — is the create-checkout function deployed?" };
}

async function readFunctionError(error, fallback) {
  let message = error?.message || fallback;
  let responseBody = null;
  if (error instanceof FunctionsHttpError && error.context) {
    try {
      const ct = error.context.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        responseBody = await error.context.json();
        if (responseBody?.error && typeof responseBody.error === "string") {
          message = responseBody.error;
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }
  if (error instanceof FunctionsFetchError) {
    message = `Could not reach payment service: ${error.message}`;
  }
  return { message, responseBody };
}

export async function confirmPaymentStatus(sessionId) {
  if (!supabase) return { paid: false };
  const session = await ensureSupabaseSession();
  if (!session?.access_token) return { paid: false };

  const body = {};
  if (typeof sessionId === "string" && sessionId.trim()) {
    body.sessionId = sessionId.trim();
  }

  const { data, error } = await supabase.functions.invoke("confirm-payment", {
    body,
    timeout: 45_000,
  });

  if (error) {
    const { message, responseBody } = await readFunctionError(error, "Payment confirmation failed");
    console.warn("[confirm-payment]", message);
    return {
      paid: Boolean(responseBody?.paid),
      locked: Boolean(responseBody?.locked),
      error: message,
    };
  }

  if (data?.error) {
    return {
      paid: Boolean(data.paid),
      locked: Boolean(data.locked),
      error: data.error,
    };
  }

  return {
    paid: Boolean(data?.paid),
    locked: Boolean(data?.locked),
    repaired: Boolean(data?.repaired),
    emailSent: Boolean(data?.emailSent),
  };
}

export async function checkPaymentStatus({ reconcile = true } = {}) {
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

  if (data) return { paid: true };
  if (!reconcile) return { paid: false };
  return confirmPaymentStatus();
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
