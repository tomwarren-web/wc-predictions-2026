/**
 * stripe-webhook edge function tests
 *
 * Run with:  deno test --allow-env supabase/functions/stripe-webhook/index.test.ts
 *
 * The webhook handler is tested in isolation by extracting the core routing logic.
 * Stripe signature verification and Supabase DB calls are stubbed.
 */

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

// ─── Inline handler (mirrors index.ts logic with injectable deps) ─────────────

interface WebhookDeps {
  constructEvent: (body: string, sig: string, secret: string) => unknown;
  updatePayment: (sessionId: string, data: Record<string, unknown>) => Promise<void>;
  updateProfile: (userId: string, data: Record<string, unknown>) => Promise<void>;
  getProfile: (userId: string) => Promise<{ email: string; name: string } | null>;
  sendEmail: (to: string, type: string, data: Record<string, unknown>) => Promise<void>;
  getPaymentByIntent: (intentId: string) => Promise<{ user_id: string } | null>;
  markPaymentRefunded: (intentId: string) => Promise<void>;
  markPaymentExpired: (sessionId: string) => Promise<void>;
}

async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();

  let event: Record<string, unknown>;
  try {
    event = deps.constructEvent(body, signature, "whsec_test") as Record<string, unknown>;
  } catch (err) {
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data as { object: Record<string, unknown> };
    const obj = session.object;
    const userId = (obj.metadata as Record<string, unknown>)?.supabase_uid as string;

    if (!userId) {
      return new Response("Missing user ID", { status: 400 });
    }

    await deps.updatePayment(obj.id as string, {
      status: "completed",
      stripe_payment_intent_id: obj.payment_intent,
      completed_at: new Date().toISOString(),
    });
    await deps.updateProfile(userId, { paid: true, locked: true });

    const profile = await deps.getProfile(userId);
    if (profile?.email) {
      await deps.sendEmail(profile.email, "payment_confirmation", { name: profile.name });
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data as { object: { id: string } };
    await deps.markPaymentExpired(session.object.id);
  }

  if (event.type === "charge.refunded") {
    const charge = event.data as { object: { payment_intent: string } };
    const intentId = charge.object.payment_intent;
    await deps.markPaymentRefunded(intentId);
    const payment = await deps.getPaymentByIntent(intentId);
    if (payment?.user_id) {
      await deps.updateProfile(payment.user_id, { paid: false });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeWebhookRequest = (eventJson: string, sig = "valid-sig") =>
  new Request("https://edge.example.com/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": sig, "Content-Type": "application/json" },
    body: eventJson,
  });

const checkoutCompletedEvent = JSON.stringify({
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_abc",
      payment_intent: "pi_test_xyz",
      metadata: { supabase_uid: "user-abc-123" },
    },
  },
});

const expiredEvent = JSON.stringify({
  type: "checkout.session.expired",
  data: { object: { id: "cs_test_expired" } },
});

const refundedEvent = JSON.stringify({
  type: "charge.refunded",
  data: { object: { payment_intent: "pi_test_refund" } },
});

const validDeps = (): WebhookDeps & { calls: Record<string, unknown[]> } => {
  const calls: Record<string, unknown[]> = {
    updatePayment: [],
    updateProfile: [],
    sendEmail: [],
    markPaymentExpired: [],
    markPaymentRefunded: [],
  };
  return {
    calls,
    constructEvent: (body, _sig, _secret) => JSON.parse(body),
    updatePayment: async (id, data) => { calls.updatePayment.push({ id, data }); },
    updateProfile: async (uid, data) => { calls.updateProfile.push({ uid, data }); },
    getProfile: async (_uid) => ({ email: "user@example.com", name: "Test User" }),
    sendEmail: async (to, type, data) => { calls.sendEmail.push({ to, type, data }); },
    getPaymentByIntent: async (_id) => ({ user_id: "user-abc-123" }),
    markPaymentRefunded: async (id) => { calls.markPaymentRefunded.push({ id }); },
    markPaymentExpired: async (id) => { calls.markPaymentExpired.push({ id }); },
  };
};

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("missing stripe-signature returns 400", async () => {
  const req = new Request("https://edge.example.com/stripe-webhook", {
    method: "POST",
    body: "{}",
  });
  const res = await handleWebhook(req, validDeps());
  assertEquals(res.status, 400);
  const text = await res.text();
  assertEquals(text, "Missing signature");
});

Deno.test("invalid signature (constructEvent throws) returns 400", async () => {
  const deps = validDeps();
  deps.constructEvent = (_body, _sig, _secret) => {
    throw new Error("No signatures found matching");
  };
  const res = await handleWebhook(makeWebhookRequest("{}", "bad-sig"), deps);
  assertEquals(res.status, 400);
  const text = await res.text();
  assertEquals(text.includes("Webhook Error"), true);
});

Deno.test("checkout.session.completed → sets paid:true and locked:true on profile", async () => {
  const deps = validDeps();
  const res = await handleWebhook(makeWebhookRequest(checkoutCompletedEvent), deps);
  assertEquals(res.status, 200);

  const profileUpdate = deps.calls.updateProfile.find(
    (c) => (c as { data: Record<string, unknown> }).data.paid === true,
  );
  assertEquals(profileUpdate !== undefined, true);
  const call = profileUpdate as { uid: string; data: Record<string, unknown> };
  assertEquals(call.data.paid, true);
  assertEquals(call.data.locked, true);
  assertEquals(call.uid, "user-abc-123");
});

Deno.test("checkout.session.completed → marks payment as completed", async () => {
  const deps = validDeps();
  await handleWebhook(makeWebhookRequest(checkoutCompletedEvent), deps);

  assertEquals(deps.calls.updatePayment.length, 1);
  const call = deps.calls.updatePayment[0] as { id: string; data: Record<string, unknown> };
  assertEquals(call.id, "cs_test_abc");
  assertEquals(call.data.status, "completed");
});

Deno.test("checkout.session.completed → triggers payment_confirmation email", async () => {
  const deps = validDeps();
  await handleWebhook(makeWebhookRequest(checkoutCompletedEvent), deps);

  assertEquals(deps.calls.sendEmail.length, 1);
  const email = deps.calls.sendEmail[0] as { to: string; type: string };
  assertEquals(email.to, "user@example.com");
  assertEquals(email.type, "payment_confirmation");
});

Deno.test("checkout.session.completed → missing supabase_uid returns 400", async () => {
  const event = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { id: "cs_abc", payment_intent: "pi_abc", metadata: {} } },
  });
  const res = await handleWebhook(makeWebhookRequest(event), validDeps());
  assertEquals(res.status, 400);
  const text = await res.text();
  assertEquals(text, "Missing user ID");
});

Deno.test("checkout.session.expired → marks payment as expired", async () => {
  const deps = validDeps();
  const res = await handleWebhook(makeWebhookRequest(expiredEvent), deps);
  assertEquals(res.status, 200);
  assertEquals(deps.calls.markPaymentExpired.length, 1);
  const call = deps.calls.markPaymentExpired[0] as { id: string };
  assertEquals(call.id, "cs_test_expired");
});

Deno.test("charge.refunded → marks payment refunded and sets paid:false on profile", async () => {
  const deps = validDeps();
  const res = await handleWebhook(makeWebhookRequest(refundedEvent), deps);
  assertEquals(res.status, 200);

  assertEquals(deps.calls.markPaymentRefunded.length, 1);

  const profileUpdate = deps.calls.updateProfile.find(
    (c) => (c as { data: Record<string, unknown> }).data.paid === false,
  );
  assertEquals(profileUpdate !== undefined, true);
});

Deno.test("returns 200 with received:true for unknown event types", async () => {
  const event = JSON.stringify({ type: "customer.created", data: { object: {} } });
  const res = await handleWebhook(makeWebhookRequest(event), validDeps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.received, true);
});
