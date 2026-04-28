import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENTRY_AMOUNT_PENCE = 1000;
const ENTRY_CURRENCY = "gbp";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey?.startsWith("sk_") || !endpointSecret) {
    console.error("Stripe webhook secrets are not configured");
    return json({ error: "Webhook is not configured" }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-04-10" });

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

    const alreadyCompleted = existingPayment.status === "completed";
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
      .update({ paid: true, locked: true })
      .eq("id", userId);

    if (updateProfileError) {
      console.error("Profile lock update failed:", updateProfileError.message);
      return json({ error: "Profile lock failed" }, 500);
    }

    // Trigger payment confirmation email
    if (!alreadyCompleted) {
      try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, name")
        .eq("id", userId)
        .single();

      if (profile?.email) {
        await supabase.functions.invoke("send-email", {
          body: {
            to: profile.email,
            type: "payment_confirmation",
            data: { name: profile.name },
          },
        });
      }
      } catch (emailErr) {
        console.error("Failed to send payment confirmation email:", emailErr);
      }
    }
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
