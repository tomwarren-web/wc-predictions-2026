import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey?.startsWith("sk_")) {
      return new Response(
        JSON.stringify({
          error:
            "STRIPE_SECRET_KEY is not set on the server. In Supabase: Project Settings → Edge Functions → Secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-04-10" });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("email, name, username, paid, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) {
      return new Response(JSON.stringify({ error: profileErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found. Save your predictions once, then try Pay again." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (profile.paid) {
      return new Response(
        JSON.stringify({ error: "Already paid", paid: true }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        name: profile.name,
        metadata: { supabase_uid: user.id, username: profile.username },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const payload = await req.json().catch(() => ({}));
    const origin =
      typeof payload?.origin === "string" && payload.origin.startsWith("http")
        ? payload.origin
        : undefined;
    const appUrl = origin || Deno.env.get("APP_URL") || "http://localhost:5173";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: "World Cup 2026 Prediction League Entry",
              description: "£10 entry fee — all funds go to the prize pool",
            },
            unit_amount: 1000,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}?payment=cancelled`,
      metadata: { supabase_uid: user.id },
    });

    await supabase.from("payments").insert({
      user_id: user.id,
      stripe_checkout_session_id: session.id,
      amount_pence: 1000,
      currency: "gbp",
      status: "pending",
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-checkout error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
