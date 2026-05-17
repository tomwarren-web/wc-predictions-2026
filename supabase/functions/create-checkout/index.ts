import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@20.4.0?target=deno";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENTRY_AMOUNT_PENCE = 1000;
const ENTRY_CURRENCY = "gbp";
const ONE_HOUR_MS = 60 * 60 * 1000;
const FALLBACK_FIRST_KICKOFF_ISO = "2026-06-11T22:00:00.000Z";
const STRIPE_API_VERSION = "2026-02-25.clover";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function resolveAppUrl(payloadOrigin: unknown) {
  const fallback = Deno.env.get("APP_URL") || "http://localhost:5173";
  const allowed = new Set<string>();

  for (const raw of [fallback, ...(Deno.env.get("ALLOWED_APP_ORIGINS") || "").split(",")]) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      allowed.add(new URL(trimmed).origin);
    } catch {
      console.warn("Ignoring invalid app origin:", trimmed);
    }
  }

  if (typeof payloadOrigin === "string") {
    try {
      const origin = new URL(payloadOrigin).origin;
      if (allowed.has(origin)) return origin;
    } catch {
      // Ignore malformed browser input and fall back to server configuration.
    }
  }

  return new URL(fallback).origin;
}

function parseIsoMs(value: string | undefined | null) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function envSubmissionDeadlineMs() {
  const explicitDeadline = parseIsoMs(Deno.env.get("ENTRY_DEADLINE_ISO"));
  if (explicitDeadline != null) return explicitDeadline;

  const firstKickoff =
    parseIsoMs(Deno.env.get("FIRST_MATCH_KICKOFF_ISO")) ??
    parseIsoMs(Deno.env.get("VITE_FIRST_MATCH_KICKOFF_ISO")) ??
    Date.parse(FALLBACK_FIRST_KICKOFF_ISO);

  return firstKickoff - ONE_HOUR_MS;
}

function isMissingSettingsTableError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || "")
    : "";
  return /does not exist|schema cache|Could not find/i.test(message);
}

async function getSubmissionDeadlineMs(
  supabase: any,
) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "entry_deadline_iso")
    .maybeSingle();

  const dbDeadline = parseIsoMs(data?.value);
  if (dbDeadline != null) return dbDeadline;

  if (error && !isMissingSettingsTableError(error)) {
    console.warn("Could not read entry deadline from app_settings:", error.message);
  }

  return envSubmissionDeadlineMs();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

    const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });

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

    const entryDeadlineMs = await getSubmissionDeadlineMs(supabase);
    if (Date.now() >= entryDeadlineMs) {
      return new Response(
        JSON.stringify({ error: "Submissions are closed — payment is no longer available." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
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
      const { error: customerUpdateErr } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);

      if (customerUpdateErr) {
        console.error("Failed to store Stripe customer id:", customerUpdateErr.message);
        return new Response(
          JSON.stringify({ error: "Payment setup failed before checkout. Please try again." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const payload = await req.json().catch(() => ({}));
    const appUrl = resolveAppUrl(payload?.origin);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      client_reference_id: user.id,
      line_items: [
        {
          price_data: {
            currency: ENTRY_CURRENCY,
            product_data: {
              name: "World Cup 2026 Prediction League Entry",
              description: "£10 entry fee — 80% prize pool, 20% organiser and hosting costs",
            },
            unit_amount: ENTRY_AMOUNT_PENCE,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}?payment=cancelled`,
      metadata: { supabase_uid: user.id },
    });

    const { error: paymentInsertErr } = await supabase.from("payments").insert({
      user_id: user.id,
      stripe_checkout_session_id: session.id,
      amount_pence: ENTRY_AMOUNT_PENCE,
      currency: ENTRY_CURRENCY,
      status: "pending",
    });

    if (paymentInsertErr) {
      console.error("Failed to create pending payment row:", paymentInsertErr.message);
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireErr) {
        console.error("Failed to expire orphan checkout session:", expireErr);
      }
      return new Response(
        JSON.stringify({ error: "Payment setup failed before checkout. Please try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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
