/**
 * create-checkout edge function tests
 *
 * Run with:  deno test --allow-env supabase/functions/create-checkout/index.test.ts
 *
 * Strategy: we cannot easily import index.ts directly because it calls serve() at
 * the module level (starting a server). Instead, we extract and test the core
 * handler logic in isolation by simulating requests and stubbing dependencies.
 *
 * The tests document the expected behaviour at each decision point in the handler.
 */

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

// ─── Inline handler logic (mirrors index.ts, with injectable dependencies) ────

interface HandlerDeps {
  getUser: (token: string) => Promise<{ user: unknown; error: unknown }>;
  getProfile: (userId: string) => Promise<unknown>;
  getRecentPayments: (userId: string) => Promise<{ data: unknown[]; error: unknown }>;
  getStripeSession: (sessionId: string) => Promise<Record<string, unknown>>;
  createStripeCustomer: (profile: Record<string, unknown>) => Promise<{ id: string }>;
  createStripeSession: (customerId: string, origin: string, userId: string) => Promise<{ url: string; id: string }>;
  insertPayment: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  updatePayment: (id: string, row: Record<string, unknown>) => Promise<{ error: unknown }>;
  updateProfilePaid: (userId: string) => Promise<{ error: unknown }>;
  updateProfileCustomerId: (userId: string, customerId: string) => Promise<{ error: unknown }>;
  expireStripeSession: (sessionId: string) => Promise<void>;
  nowMs: () => number;
  deadlineMs: () => number;
  appUrl?: string;
  allowedOrigins?: string[];
}

function normalizeHttpOrigin(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function resolveAppUrl(requestOrigin: unknown, payloadOrigin: unknown, deps: HandlerDeps) {
  const configuredOrigins = [deps.appUrl || "", ...(deps.allowedOrigins || [])]
    .map(normalizeHttpOrigin)
    .filter(Boolean) as string[];
  const candidates = [normalizeHttpOrigin(requestOrigin), normalizeHttpOrigin(payloadOrigin)]
    .filter(Boolean) as string[];
  const hasProductionConfig = configuredOrigins.some((origin) => !isLocalOrigin(origin));

  if (hasProductionConfig) {
    for (const candidate of candidates) {
      if (configuredOrigins.includes(candidate)) return candidate;
    }
    return configuredOrigins[0];
  }

  return candidates.find((origin) => !isLocalOrigin(origin)) || candidates[0] || configuredOrigins[0] || "http://localhost:5173";
}

function getErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}

function getPaymentIntentId(session: Record<string, unknown>) {
  const intent = session.payment_intent;
  if (typeof intent === "string") return intent;
  if (intent && typeof intent === "object" && "id" in intent) return String((intent as { id?: unknown }).id || "");
  return "";
}

async function findExistingCheckoutState(deps: HandlerDeps, userId: string) {
  const { data: payments, error } = await deps.getRecentPayments(userId);
  if (error) return { kind: "error", error: "Could not verify existing payment status. Please try again." };

  if ((payments || []).some((payment) => (payment as { status?: string }).status === "completed")) {
    await deps.updateProfilePaid(userId);
    return { kind: "paid" };
  }

  for (const payment of payments || []) {
    const p = payment as { id: string; status?: string; stripe_checkout_session_id?: string };
    if (p.status !== "pending" || !p.stripe_checkout_session_id) continue;

    const session = await deps.getStripeSession(p.stripe_checkout_session_id);
    const paymentIntentId = getPaymentIntentId(session);
    const isPaid =
      (session.payment_status === "paid" || session.status === "complete") &&
      session.amount_total === 1000 &&
      session.currency === "gbp" &&
      paymentIntentId;

    if (isPaid) {
      await deps.updatePayment(p.id, {
        status: "completed",
        stripe_payment_intent_id: paymentIntentId,
      });
      await deps.updateProfilePaid(userId);
      return { kind: "paid" };
    }

    if (session.status === "open" && typeof session.url === "string") {
      return { kind: "open", url: session.url };
    }

    if (session.status === "expired") {
      await deps.updatePayment(p.id, { status: "expired" });
    }
  }

  return { kind: "none" };
}

async function handleCheckout(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No auth header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { user, error: authError } = await deps.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const profile = await deps.getProfile((user as { id: string }).id);
  if (!profile) {
    return new Response(
      JSON.stringify({ error: "Profile not found. Save your predictions once, then try Pay again." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if ((profile as { paid: boolean }).paid) {
    return new Response(JSON.stringify({ error: "Already paid", paid: true }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if ((profile as { locked?: boolean }).locked) {
    return new Response(JSON.stringify({ error: "Predictions are already locked.", locked: true }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const existingCheckout = await findExistingCheckoutState(deps, (user as { id: string }).id);
  if (existingCheckout.kind === "error") {
    return new Response(JSON.stringify({ error: existingCheckout.error, checkoutInProgress: true }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (existingCheckout.kind === "paid") {
    return new Response(JSON.stringify({ error: "Already paid", paid: true }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (deps.nowMs() >= deps.deadlineMs()) {
    return new Response(JSON.stringify({ error: "Submissions are closed — payment is no longer available." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (existingCheckout.kind === "open") {
    return new Response(JSON.stringify({ url: existingCheckout.url, checkoutInProgress: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const p = profile as Record<string, unknown>;
  let customerId = p.stripe_customer_id as string;
  if (!customerId) {
    const customer = await deps.createStripeCustomer(p);
    customerId = customer.id;
    const customerUpdate = await deps.updateProfileCustomerId((user as { id: string }).id, customerId);
    if (customerUpdate.error) {
      return new Response(JSON.stringify({ error: "Payment setup failed before checkout. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const payload = await req.json().catch(() => ({}));
  const origin = resolveAppUrl(req.headers.get("Origin"), (payload as { origin?: string }).origin, deps);

  const session = await deps.createStripeSession(customerId, origin, (user as { id: string }).id);
  const paymentInsert = await deps.insertPayment({
    user_id: (user as { id: string }).id,
    stripe_checkout_session_id: session.id,
    amount_pence: 1000,
    currency: "gbp",
    status: "pending",
  });

  if (paymentInsert.error) {
    await deps.expireStripeSession(session.id);
    if (getErrorCode(paymentInsert.error) === "23505") {
      const latestCheckout = await findExistingCheckoutState(deps, (user as { id: string }).id);
      if (latestCheckout.kind === "paid") {
        return new Response(JSON.stringify({ error: "Already paid", paid: true }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (latestCheckout.kind === "open") {
        return new Response(JSON.stringify({ url: latestCheckout.url, checkoutInProgress: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Payment is already in progress. Refresh and try again.", checkoutInProgress: true }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Payment setup failed before checkout. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Stub factories ───────────────────────────────────────────────────────────

const validUser = { id: "user-abc-123", email: "test@example.com" };
const validProfile = { email: "test@example.com", name: "Test User", username: "testuser", paid: false, stripe_customer_id: null };
const mockSession = { id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" };

const validDeps = (): HandlerDeps => ({
  getUser: async (_token) => ({ user: validUser, error: null }),
  getProfile: async (_id) => validProfile,
  getRecentPayments: async (_id) => ({ data: [], error: null }),
  getStripeSession: async (_sessionId) => ({
    id: mockSession.id,
    status: "open",
    payment_status: "unpaid",
    url: mockSession.url,
  }),
  createStripeCustomer: async (_profile) => ({ id: "cus_test_new" }),
  createStripeSession: async (_cid, _origin, _uid) => mockSession,
  insertPayment: async (_row) => ({ error: null }),
  updatePayment: async (_id, _row) => ({ error: null }),
  updateProfilePaid: async (_uid) => ({ error: null }),
  updateProfileCustomerId: async (_uid, _cid) => ({ error: null }),
  expireStripeSession: async (_sessionId) => {},
  nowMs: () => Date.parse("2026-05-01T12:00:00.000Z"),
  deadlineMs: () => Date.parse("2026-06-11T21:00:00.000Z"),
  appUrl: "https://myapp.com",
  allowedOrigins: ["http://localhost:5173"],
});

const makeRequest = (overrides: { method?: string; auth?: string; body?: unknown; origin?: string } = {}) =>
  new Request("https://edge.example.com/create-checkout", {
    method: overrides.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(overrides.origin ? { Origin: overrides.origin } : {}),
      ...(overrides.auth !== undefined ? { Authorization: overrides.auth } : { Authorization: "Bearer valid-token" }),
    },
    body: (overrides.method || "POST") === "GET"
      ? undefined
      : overrides.body !== undefined ? JSON.stringify(overrides.body) : JSON.stringify({ origin: "https://myapp.com" }),
  });

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("OPTIONS preflight returns 204 with CORS headers", async () => {
  const req = new Request("https://edge.example.com/create-checkout", { method: "OPTIONS" });
  const res = await handleCheckout(req, validDeps());
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("non-POST request returns 405", async () => {
  const res = await handleCheckout(makeRequest({ method: "GET" }), validDeps());
  assertEquals(res.status, 405);
});

Deno.test("missing Authorization header returns 401", async () => {
  const req = makeRequest({ auth: undefined });
  // @ts-ignore — intentionally omitting auth
  const req2 = new Request("https://edge.example.com/create-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await handleCheckout(req2, validDeps());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "No auth header");
});

Deno.test("invalid JWT returns 401 Unauthorized", async () => {
  const deps = validDeps();
  deps.getUser = async (_token) => ({ user: null, error: new Error("invalid jwt") });

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("missing profile returns 400 with helpful message", async () => {
  const deps = validDeps();
  deps.getProfile = async (_id) => null;

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Profile not found. Save your predictions once, then try Pay again.");
});

Deno.test("already-paid user returns 409 with paid: true flag", async () => {
  const deps = validDeps();
  deps.getProfile = async (_id) => ({ ...validProfile, paid: true, stripe_customer_id: "cus_existing" });

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "Already paid");
  assertEquals(body.paid, true);
});

Deno.test("completed payment row blocks duplicate checkout", async () => {
  let sessionCreated = false;
  let profileLocked = false;
  const deps = validDeps();
  deps.getRecentPayments = async (_id) => ({
    data: [{ id: "pay_done", status: "completed", stripe_checkout_session_id: "cs_done" }],
    error: null,
  });
  deps.createStripeSession = async (_cid, _origin, _uid) => {
    sessionCreated = true;
    return mockSession;
  };
  deps.updateProfilePaid = async (_uid) => {
    profileLocked = true;
    return { error: null };
  };

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "Already paid");
  assertEquals(body.paid, true);
  assertEquals(sessionCreated, false);
  assertEquals(profileLocked, true);
});

Deno.test("open pending checkout is reused instead of creating another session", async () => {
  let sessionCreated = false;
  const existingUrl = "https://checkout.stripe.com/pay/cs_existing";
  const deps = validDeps();
  deps.getRecentPayments = async (_id) => ({
    data: [{ id: "pay_pending", status: "pending", stripe_checkout_session_id: "cs_existing" }],
    error: null,
  });
  deps.getStripeSession = async (_sessionId) => ({
    id: "cs_existing",
    status: "open",
    payment_status: "unpaid",
    url: existingUrl,
  });
  deps.createStripeSession = async (_cid, _origin, _uid) => {
    sessionCreated = true;
    return mockSession;
  };

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, existingUrl);
  assertEquals(body.checkoutInProgress, true);
  assertEquals(sessionCreated, false);
});

Deno.test("paid pending checkout is reconciled and blocks another payment", async () => {
  const updates: Record<string, unknown>[] = [];
  let profileLocked = false;
  const deps = validDeps();
  deps.getRecentPayments = async (_id) => ({
    data: [{ id: "pay_pending", status: "pending", stripe_checkout_session_id: "cs_paid" }],
    error: null,
  });
  deps.getStripeSession = async (_sessionId) => ({
    id: "cs_paid",
    status: "complete",
    payment_status: "paid",
    amount_total: 1000,
    currency: "gbp",
    payment_intent: "pi_paid",
  });
  deps.updatePayment = async (_id, row) => {
    updates.push(row);
    return { error: null };
  };
  deps.updateProfilePaid = async (_uid) => {
    profileLocked = true;
    return { error: null };
  };

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.paid, true);
  assertEquals(updates[0].status, "completed");
  assertEquals(updates[0].stripe_payment_intent_id, "pi_paid");
  assertEquals(profileLocked, true);
});

Deno.test("valid unpaid user → creates Stripe session and returns URL", async () => {
  const res = await handleCheckout(makeRequest(), validDeps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, mockSession.url);
});

Deno.test("creates new Stripe customer when stripe_customer_id is null", async () => {
  let customerCreated = false;
  const deps = validDeps();
  deps.createStripeCustomer = async (_profile) => {
    customerCreated = true;
    return { id: "cus_brand_new" };
  };

  await handleCheckout(makeRequest(), deps);
  assertEquals(customerCreated, true);
});

Deno.test("skips customer creation when stripe_customer_id already exists", async () => {
  let customerCreated = false;
  const deps = validDeps();
  deps.getProfile = async (_id) => ({ ...validProfile, stripe_customer_id: "cus_existing" });
  deps.createStripeCustomer = async (_profile) => {
    customerCreated = true;
    return { id: "cus_new" };
  };

  await handleCheckout(makeRequest(), deps);
  assertEquals(customerCreated, false);
});

Deno.test("customer id update failure returns 500 before Checkout Session creation", async () => {
  let sessionCreated = false;
  const deps = validDeps();
  deps.updateProfileCustomerId = async (_uid, _cid) => ({ error: new Error("profile update failed") });
  deps.createStripeSession = async (_cid, _origin, _uid) => {
    sessionCreated = true;
    return mockSession;
  };

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Payment setup failed before checkout. Please try again.");
  assertEquals(sessionCreated, false);
});

Deno.test("inserts a pending payment row after session creation", async () => {
  const insertedRows: Record<string, unknown>[] = [];
  const deps = validDeps();
  deps.insertPayment = async (row) => {
    insertedRows.push(row);
    return { error: null };
  };

  await handleCheckout(makeRequest(), deps);
  assertEquals(insertedRows.length, 1);
  assertEquals(insertedRows[0].status, "pending");
  assertEquals(insertedRows[0].amount_pence, 1000);
  assertEquals(insertedRows[0].currency, "gbp");
});

Deno.test("payment row insert failure expires Checkout Session and returns 500", async () => {
  let expiredSessionId = "";
  const deps = validDeps();
  deps.insertPayment = async (_row) => ({ error: new Error("database unavailable") });
  deps.expireStripeSession = async (sessionId) => {
    expiredSessionId = sessionId;
  };

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Payment setup failed before checkout. Please try again.");
  assertEquals(expiredSessionId, mockSession.id);
});

Deno.test("active payment unique conflict expires new session and returns the existing checkout URL", async () => {
  let expiredSessionId = "";
  let paymentLookupCount = 0;
  const existingUrl = "https://checkout.stripe.com/pay/cs_existing";
  const deps = validDeps();
  deps.insertPayment = async (_row) => ({ error: { code: "23505" } });
  deps.expireStripeSession = async (sessionId) => {
    expiredSessionId = sessionId;
  };
  deps.getRecentPayments = async (_id) => ({
    data: paymentLookupCount++ === 0
      ? []
      : [{ id: "pay_pending", status: "pending", stripe_checkout_session_id: "cs_existing" }],
    error: null,
  });
  deps.getStripeSession = async (_sessionId) => ({
    id: "cs_existing",
    status: "open",
    payment_status: "unpaid",
    url: existingUrl,
  });

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, existingUrl);
  assertEquals(body.checkoutInProgress, true);
  assertEquals(expiredSessionId, mockSession.id);
});

Deno.test("payment is blocked after the server-side entry deadline", async () => {
  let sessionCreated = false;
  const deps = validDeps();
  deps.nowMs = () => Date.parse("2026-06-11T21:00:00.000Z");
  deps.createStripeSession = async (_cid, _origin, _uid) => {
    sessionCreated = true;
    return mockSession;
  };

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "Submissions are closed — payment is no longer available.");
  assertEquals(sessionCreated, false);
});

Deno.test("untrusted browser origin falls back to configured app URL", async () => {
  let usedOrigin = "";
  const deps = validDeps();
  deps.createStripeSession = async (_cid, origin, _uid) => {
    usedOrigin = origin;
    return mockSession;
  };

  await handleCheckout(makeRequest({ body: { origin: "https://evil.example" } }), deps);
  assertEquals(usedOrigin, "https://myapp.com");
});

Deno.test("uses request origin when no app URL has been configured", async () => {
  let usedOrigin = "";
  const deps = validDeps();
  deps.appUrl = "";
  deps.allowedOrigins = [];
  deps.createStripeSession = async (_cid, origin, _uid) => {
    usedOrigin = origin;
    return mockSession;
  };

  await handleCheckout(makeRequest({
    origin: "https://live-app.example",
    body: { origin: "https://live-app.example" },
  }), deps);
  assertEquals(usedOrigin, "https://live-app.example");
});

Deno.test("uses production request origin when only localhost is configured", async () => {
  let usedOrigin = "";
  const deps = validDeps();
  deps.appUrl = "http://localhost:5173";
  deps.allowedOrigins = [];
  deps.createStripeSession = async (_cid, origin, _uid) => {
    usedOrigin = origin;
    return mockSession;
  };

  await handleCheckout(makeRequest({
    origin: "https://live-app.example",
    body: { origin: "https://live-app.example" },
  }), deps);
  assertEquals(usedOrigin, "https://live-app.example");
});
