import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@20.4.0?target=deno";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const ENTRY_AMOUNT_PENCE = 1000;
const ENTRY_CURRENCY = "gbp";
const STRIPE_API_VERSION = "2026-02-25.clover";
const appUrl = Deno.env.get("APP_URL") || "";

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

function getPaymentIntentId(session: Stripe.Checkout.Session) {
  const intent = session.payment_intent;
  if (typeof intent === "string") return intent;
  if (intent && typeof intent === "object" && typeof intent.id === "string") return intent.id;
  return null;
}

function sessionBelongsToUser(session: Stripe.Checkout.Session, userId: string) {
  return session.metadata?.supabase_uid === userId || session.client_reference_id === userId;
}

function isExpectedPaidSession(session: Stripe.Checkout.Session) {
  return (
    (session.payment_status === "paid" || session.status === "complete") &&
    session.amount_total === ENTRY_AMOUNT_PENCE &&
    session.currency?.toLowerCase() === ENTRY_CURRENCY &&
    Boolean(getPaymentIntentId(session))
  );
}

async function sendPaymentConfirmationIfNeeded(supabase: any, userId: string) {
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
  if (existingEmail) return { sent: false, skipped: true };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email, name")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("Payment confirmation profile lookup failed:", profileError.message);
    return { sent: false, skipped: false };
  }
  if (!profile?.email) return { sent: false, skipped: false };

  const { error } = await supabase.functions.invoke("send-email", {
    body: {
      to: profile.email,
      type: "payment_confirmation",
      data: { name: profile.name, appUrl },
      userId,
    },
  });

  if (error) {
    console.error("Payment confirmation email failed:", error.message);
    return { sent: false, skipped: false };
  }

  return { sent: true, skipped: false };
}

async function completePaymentFromSession(
  supabase: any,
  userId: string,
  session: Stripe.Checkout.Session,
) {
  if (!sessionBelongsToUser(session, userId)) {
    return { paid: false, error: "Checkout session does not belong to this user.", status: 403 };
  }
  if (!isExpectedPaidSession(session)) {
    return { paid: false, error: "Checkout session has not completed payment yet.", status: 409 };
  }

  const paymentIntentId = getPaymentIntentId(session)!;
  const { data: existingPayment, error: existingPaymentError } = await supabase
    .from("payments")
    .select("user_id, status")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  if (existingPaymentError) {
    console.error("Payment lookup failed:", existingPaymentError.message);
    return { paid: false, error: "Payment lookup failed.", status: 500 };
  }
  if (existingPayment && existingPayment.user_id !== userId) {
    return { paid: false, error: "Checkout session is linked to another user.", status: 403 };
  }

  if (!existingPayment) {
    await supabase
      .from("payments")
      .update({ status: "expired" })
      .eq("user_id", userId)
      .eq("status", "pending")
      .neq("stripe_checkout_session_id", session.id);

    const { error: insertError } = await supabase.from("payments").insert({
      user_id: userId,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      amount_pence: ENTRY_AMOUNT_PENCE,
      currency: ENTRY_CURRENCY,
      status: "completed",
      completed_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("Completed payment insert failed:", insertError.message);
      return { paid: false, error: "Payment update failed.", status: 500 };
    }
  } else if (existingPayment.status !== "completed") {
    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        status: "completed",
        stripe_payment_intent_id: paymentIntentId,
        completed_at: new Date().toISOString(),
      })
      .eq("stripe_checkout_session_id", session.id)
      .eq("user_id", userId);

    if (updatePaymentError) {
      console.error("Payment completion update failed:", updatePaymentError.message);
      return { paid: false, error: "Payment update failed.", status: 500 };
    }
  }

  const { error: updateProfileError } = await supabase
    .from("profiles")
    .update({ paid: true })
    .eq("id", userId);

  if (updateProfileError) {
    console.error("Profile paid update failed:", updateProfileError.message);
    return { paid: false, error: "Profile update failed.", status: 500 };
  }

  const email = await sendPaymentConfirmationIfNeeded(supabase, userId);
  return { paid: true, repaired: existingPayment?.status !== "completed", emailSent: email.sent };
}

async function reconcilePayment(
  supabase: any,
  stripe: Stripe,
  userId: string,
  sessionId?: string,
) {
  if (sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return completePaymentFromSession(supabase, userId, session);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("paid, locked")
    .eq("id", userId)
    .maybeSingle();

  const { data: completedPayment } = await supabase
    .from("payments")
    .select("stripe_checkout_session_id")
    .eq("user_id", userId)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();

  if (completedPayment) {
    if (!profile?.paid) {
      const { error } = await supabase
        .from("profiles")
        .update({ paid: true })
        .eq("id", userId);
      if (error) {
        console.error("Profile paid repair failed:", error.message);
        return { paid: false, error: "Profile update failed.", status: 500 };
      }
    }
    const email = await sendPaymentConfirmationIfNeeded(supabase, userId);
    return {
      paid: true,
      locked: Boolean(profile?.locked),
      repaired: !profile?.paid,
      emailSent: email.sent,
    };
  }

  const { data: pendingPayments, error } = await supabase
    .from("payments")
    .select("stripe_checkout_session_id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Pending payment lookup failed:", error.message);
    return { paid: false, error: "Payment lookup failed.", status: 500 };
  }

  for (const payment of pendingPayments || []) {
    if (!payment.stripe_checkout_session_id) continue;
    const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
    if (isExpectedPaidSession(session)) {
      return completePaymentFromSession(supabase, userId, session);
    }

    if (session.status === "expired") {
      await supabase
        .from("payments")
        .update({ status: "expired" })
        .eq("user_id", userId)
        .eq("stripe_checkout_session_id", payment.stripe_checkout_session_id);
    }
  }

  return { paid: false, locked: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseServiceKey = getSupabaseServiceKey();
    if (!stripeKey?.startsWith("sk_") || !supabaseServiceKey) {
      return json({ error: "Payment confirmation service is not configured." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth header" }, 401);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => ({}));
    const sessionId = typeof payload?.sessionId === "string" && payload.sessionId.trim()
      ? payload.sessionId.trim()
      : undefined;

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
    const result = await reconcilePayment(supabase, stripe, user.id, sessionId);
    if (result.error) return json({ error: result.error, paid: false }, result.status || 500);

    return json(result);
  } catch (err) {
    console.error("confirm-payment error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
