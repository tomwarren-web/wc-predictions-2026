import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-04-10",
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();

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
      return new Response("Missing user ID", { status: 400 });
    }

    await supabase
      .from("payments")
      .update({
        status: "completed",
        stripe_payment_intent_id: session.payment_intent as string,
        completed_at: new Date().toISOString(),
      })
      .eq("stripe_checkout_session_id", session.id);

    await supabase
      .from("profiles")
      .update({ paid: true, locked: true })
      .eq("id", userId);

    // Trigger payment confirmation email
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

    await supabase
      .from("payments")
      .update({ status: "refunded" })
      .eq("stripe_payment_intent_id", paymentIntentId);

    const { data: payment } = await supabase
      .from("payments")
      .select("user_id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .single();

    if (payment?.user_id) {
      await supabase
        .from("profiles")
        .update({ paid: false })
        .eq("id", payment.user_id);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
