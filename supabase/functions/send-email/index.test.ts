/**
 * send-email edge function tests
 *
 * Run with:  deno test --allow-env supabase/functions/send-email/index.test.ts
 *
 * Tests the handler logic in isolation — auth, template dispatch, Resend call,
 * email_log insert, and error paths.
 */

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

// ─── Inline handler (mirrors index.ts logic with injectable deps) ─────────────

interface SendEmailDeps {
  getUser: (token: string) => Promise<{ user: unknown; error: unknown }>;
  sendViaResend: (payload: Record<string, unknown>) => Promise<{ ok: boolean; id?: string }>;
  logEmail: (row: Record<string, unknown>) => Promise<void>;
}

const EMAIL_TEMPLATES: Record<string, (d: Record<string, unknown>) => { subject: string; html: string }> = {
  welcome: (d) => ({ subject: "Welcome to WC Predictions 2026!", html: `<p>Hey ${d.name}</p>` }),
  payment_confirmation: (_d) => ({ subject: "Payment Confirmed!", html: "<p>Confirmed</p>" }),
  predictions_locked: (_d) => ({ subject: "Predictions Locked!", html: "<p>Locked</p>" }),
  matchday_recap: (_d) => ({ subject: "Match Day Recap", html: "<p>Recap</p>" }),
  weekly_standings: (_d) => ({ subject: "Weekly Standings", html: "<p>Standings</p>" }),
  tournament_complete: (_d) => ({ subject: "Tournament Complete!", html: "<p>Done</p>" }),
};
const USER_ALLOWED_TYPES = new Set(["welcome"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function handleSendEmail(req: Request, deps: SendEmailDeps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { user, error: authErr } = await deps.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { to, type, data = {}, userId } = await req.json();

  if (!to || !type) {
    return new Response(JSON.stringify({ error: "Missing 'to' or 'type'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const templateFn = EMAIL_TEMPLATES[type];
  if (!templateFn) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const u = user as { id: string; email?: string };
  if (!USER_ALLOWED_TYPES.has(type)) {
    return new Response(JSON.stringify({ error: `Email type not allowed: ${type}` }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!u.email || String(to).trim().toLowerCase() !== u.email.toLowerCase()) {
    return new Response(JSON.stringify({ error: "Email recipient must match the signed-in user." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (userId && userId !== u.id) {
    return new Response(JSON.stringify({ error: "userId must match the signed-in user." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { subject, html } = templateFn(data);

  const sendResult = await deps.sendViaResend({ to: [to], subject, html });
  await deps.logEmail({
    user_id: userId || (user as { id: string }).id,
    email_to: to,
    email_type: type,
    subject,
    resend_id: sendResult.id || null,
    status: sendResult.ok ? "sent" : "failed",
  });

  if (!sendResult.ok) {
    return new Response(JSON.stringify({ error: "Email send failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, id: sendResult.id }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Stub factories ───────────────────────────────────────────────────────────

const validUser = { id: "user-123", email: "user@example.com" };

const validDeps = (): SendEmailDeps & { calls: Record<string, unknown[]> } => {
  const calls: Record<string, unknown[]> = { sendViaResend: [], logEmail: [] };
  return {
    calls,
    getUser: async (_token) => ({ user: validUser, error: null }),
    sendViaResend: async (payload) => {
      calls.sendViaResend.push(payload);
      return { ok: true, id: "resend-id-123" };
    },
    logEmail: async (row) => { calls.logEmail.push(row); },
  };
};

const makeRequest = (body: Record<string, unknown>, auth = "Bearer valid-token") =>
  new Request("https://edge.example.com/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
  });

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("OPTIONS preflight returns 204 with CORS headers", async () => {
  const req = new Request("https://edge.example.com/send-email", { method: "OPTIONS" });
  const res = await handleSendEmail(req, validDeps());
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("missing Authorization header returns 401", async () => {
  const req = new Request("https://edge.example.com/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "a@b.com", type: "welcome" }),
  });
  const res = await handleSendEmail(req, validDeps());
  assertEquals(res.status, 401);
});

Deno.test("invalid JWT returns 401", async () => {
  const deps = validDeps();
  deps.getUser = async (_token) => ({ user: null, error: new Error("bad jwt") });
  const res = await handleSendEmail(makeRequest({ to: "a@b.com", type: "welcome" }), deps);
  assertEquals(res.status, 401);
});

Deno.test("missing 'to' returns 400", async () => {
  const res = await handleSendEmail(makeRequest({ type: "welcome" }), validDeps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Missing 'to' or 'type'");
});

Deno.test("missing 'type' returns 400", async () => {
  const res = await handleSendEmail(makeRequest({ to: "user@example.com" }), validDeps());
  assertEquals(res.status, 400);
});

Deno.test("unknown email type returns 400", async () => {
  const res = await handleSendEmail(
    makeRequest({ to: "user@example.com", type: "unknown_type_xyz" }),
    validDeps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.includes("Unknown email type"), true);
});

Deno.test("welcome email → calls Resend and logs to email_log", async () => {
  const deps = validDeps();
  const res = await handleSendEmail(
    makeRequest({ to: "user@example.com", type: "welcome", data: { name: "Alice" }, userId: "user-123" }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(deps.calls.sendViaResend.length, 1);
  assertEquals(deps.calls.logEmail.length, 1);
  const log = deps.calls.logEmail[0] as Record<string, unknown>;
  assertEquals(log.email_type, "welcome");
  assertEquals(log.email_to, "user@example.com");
  assertEquals(log.status, "sent");
  assertEquals(log.user_id, "user-123");
});

Deno.test("payment_confirmation is blocked for browser callers", async () => {
  const deps = validDeps();
  const res = await handleSendEmail(
    makeRequest({ to: "user@example.com", type: "payment_confirmation", data: { name: "Bob" } }),
    deps,
  );
  assertEquals(res.status, 403);
  assertEquals(deps.calls.sendViaResend.length, 0);
});

Deno.test("Resend failure → logs status as 'failed' and returns 502", async () => {
  const deps = validDeps();
  deps.sendViaResend = async (_payload) => {
    (deps.calls.sendViaResend as unknown[]).push(_payload);
    return { ok: false };
  };

  const res = await handleSendEmail(
    makeRequest({ to: "user@example.com", type: "welcome", data: { name: "Alice" } }),
    deps,
  );
  assertEquals(res.status, 502);
  const log = deps.calls.logEmail[0] as Record<string, unknown>;
  assertEquals(log.status, "failed");
});

Deno.test("custom email type is not available", async () => {
  const res = await handleSendEmail(
    makeRequest({ to: "user@example.com", type: "custom", data: { bodyHtml: "<p>Hi</p>" } }),
    validDeps(),
  );
  assertEquals(res.status, 400);
});

Deno.test("recipient must match authenticated user email", async () => {
  const res = await handleSendEmail(
    makeRequest({ to: "other@example.com", type: "welcome", data: { name: "Test" } }),
    validDeps(),
  );
  assertEquals(res.status, 403);
});
