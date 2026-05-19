import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@20.4.0?target=deno";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const ENTRY_AMOUNT_PENCE = 1000;
const ENTRY_CURRENCY = "gbp";
const STRIPE_API_VERSION = "2026-02-25.clover";
const appUrl = Deno.env.get("APP_URL") || "";

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
    headers: { "Content-Type": "application/json" },
  });
}

async function shouldLockForDeadline(supabase: any) {
  const { data, error } = await supabase.rpc("entries_are_closed");
  if (error) {
    console.warn("Could not check entries_are_closed while confirming payment:", error.message);
    return false;
  }
  return Boolean(data);
}

async function sendPaymentConfirmationIfNeeded(
  supabase: any,
  userId: string,
  fallbackProfile?: { email?: string; name?: string } | null,
) {
  const { data: existingEmail, error: emailLogError } = await supabase
    .from("email_log")
    .select("id")
    .eq("user_id", userId)
    .eq("email_type", "payment_confirmation")
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();

  if (emailLogError) {
    console.error("Payment confirmation email log lookup failed:", emailLogError.message);
  }
  if (existingEmail) return;

  const profile = fallbackProfile?.email
    ? fallbackProfile
    : (await supabase
        .from("profiles")
        .select("email, name")
        .eq("id", userId)
        .single()).data;

  if (!profile?.email) return;

  const { error } = await supabase.functions.invoke("send-email", {
    body: {
      to: profile.email,
      type: "payment_confirmation",
      data: { name: profile.name, appUrl },
      userId,
    },
  });

  if (error) {
    console.error("Failed to send payment confirmation email:", error.message);
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseServiceKey = getSupabaseServiceKey();
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!supabaseServiceKey || !stripeKey?.startsWith("sk_") || !endpointSecret) {
    console.error("Stripe webhook secrets are not configured");
    return json({ error: "Webhook is not configured" }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.supabase_uid;

    if (!userId) {
      console.error("No supabase_uid in session metadata");
      return json({ received: true, ignored: "missing_user_id" });
    }

    if (
      session.payment_status !== "paid" ||
      session.amount_total !== ENTRY_AMOUNT_PENCE ||
      session.currency?.toLowerCase() !== ENTRY_CURRENCY ||
      !session.payment_intent
    ) {
      console.error("Unexpected checkout.session.completed payload", {
        payment_status: session.payment_status,
        amount_total: session.amount_total,
        currency: session.currency,
        payment_intent: session.payment_intent,
      });
      return json({ received: true, ignored: "invalid_payment_payload" });
    }

    const { data: existingPayment, error: paymentReadError } = await supabase
      .from("payments")
      .select("user_id, status")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();

    if (paymentReadError) {
      console.error("Payment lookup failed:", paymentReadError.message);
      return json({ error: "Payment lookup failed" }, 500);
    }

    if (!existingPayment || existingPayment.user_id !== userId) {
      console.error("Checkout session did not match a pending payment row", {
        sessionId: session.id,
        metadataUserId: userId,
        paymentUserId: existingPayment?.user_id,
      });
      return json({ received: true, ignored: "payment_row_mismatch" });
    }

    const { data: profileBeforeLock } = await supabase
      .from("profiles")
      .select("email, name, paid, locked")
      .eq("id", userId)
      .maybeSingle();

    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        status: "completed",
        stripe_payment_intent_id: session.payment_intent as string,
        completed_at: new Date().toISOString(),
      })
      .eq("stripe_checkout_session_id", session.id)
      .eq("user_id", userId);

    if (updatePaymentError) {
      console.error("Payment completion update failed:", updatePaymentError.message);
      return json({ error: "Payment update failed" }, 500);
    }

    const { error: updateProfileError } = await supabase
      .from("profiles")
      .update({ paid: true, locked: await shouldLockForDeadline(supabase) })
      .eq("id", userId);

    if (updateProfileError) {
      console.error("Profile paid update failed:", updateProfileError.message);
      return json({ error: "Profile update failed" }, 500);
    }

    // Trigger payment confirmation email after the profile has been marked paid.
    // The email log prevents duplicates while allowing webhook retries to repair
    // a previously failed email send.
    await sendPaymentConfirmationIfNeeded(supabase, userId, profileBeforeLock);
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await supabase
      .from("payments")
      .update({ status: "expired" })
      .eq("stripe_checkout_session_id", session.id);
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = charge.payment_intent as string;

    const { error: refundError } = await supabase
      .from("payments")
      .update({ status: "refunded" })
      .eq("stripe_payment_intent_id", paymentIntentId);

    if (refundError) {
      console.error("Payment refund update failed:", refundError.message);
      return json({ error: "Refund update failed" }, 500);
    }

    const { data: payment } = await supabase
      .from("payments")
      .select("user_id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .single();

    if (payment?.user_id) {
      await supabase
        .from("profiles")
        .update({ paid: false, locked: false })
        .eq("id", payment.user_id);
    }
  }

  return json({ received: true });
});
