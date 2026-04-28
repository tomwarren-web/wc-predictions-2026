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
  createStripeCustomer: (profile: Record<string, unknown>) => Promise<{ id: string }>;
  createStripeSession: (customerId: string, origin: string, userId: string) => Promise<{ url: string; id: string }>;
  insertPayment: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  updateProfileCustomerId: (userId: string, customerId: string) => Promise<void>;
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
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const p = profile as Record<string, unknown>;
  let customerId = p.stripe_customer_id as string;
  if (!customerId) {
    const customer = await deps.createStripeCustomer(p);
    customerId = customer.id;
    await deps.updateProfileCustomerId((user as { id: string }).id, customerId);
  }

  const payload = await req.json().catch(() => ({}));
  const allowedOrigins = new Set(["http://localhost:5173", "https://myapp.com"]);
  let origin = "http://localhost:5173";
  if (typeof (payload as { origin?: string }).origin === "string") {
    try {
      const candidate = new URL((payload as { origin: string }).origin).origin;
      if (allowedOrigins.has(candidate)) origin = candidate;
    } catch {
      // Fall back to configured app URL.
    }
  }

  const session = await deps.createStripeSession(customerId, origin, (user as { id: string }).id);
  await deps.insertPayment({
    user_id: (user as { id: string }).id,
    stripe_checkout_session_id: session.id,
    amount_pence: 1000,
    currency: "gbp",
    status: "pending",
  });

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
  createStripeCustomer: async (_profile) => ({ id: "cus_test_new" }),
  createStripeSession: async (_cid, _origin, _uid) => mockSession,
  insertPayment: async (_row) => ({ error: null }),
  updateProfileCustomerId: async (_uid, _cid) => {},
});

const makeRequest = (overrides: { method?: string; auth?: string; body?: unknown } = {}) =>
  new Request("https://edge.example.com/create-checkout", {
    method: overrides.method || "POST",
    headers: {
      "Content-Type": "application/json",
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

Deno.test("already-paid user returns 400 with paid: true flag", async () => {
  const deps = validDeps();
  deps.getProfile = async (_id) => ({ ...validProfile, paid: true, stripe_customer_id: "cus_existing" });

  const res = await handleCheckout(makeRequest(), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Already paid");
  assertEquals(body.paid, true);
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

Deno.test("untrusted browser origin falls back to configured app URL", async () => {
  let usedOrigin = "";
  const deps = validDeps();
  deps.createStripeSession = async (_cid, origin, _uid) => {
    usedOrigin = origin;
    return mockSession;
  };

  await handleCheckout(makeRequest({ body: { origin: "https://evil.example" } }), deps);
  assertEquals(usedOrigin, "http://localhost:5173");
});
