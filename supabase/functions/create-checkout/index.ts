import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@20.4.0?target=deno";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const ENTRY_AMOUNT_PENCE = 1000;
const ENTRY_CURRENCY = "gbp";
const ONE_HOUR_MS = 60 * 60 * 1000;
const FALLBACK_FIRST_KICKOFF_ISO = "2026-06-11T22:00:00.000Z";
const STRIPE_API_VERSION = "2026-02-25.clover";
const appUrl = Deno.env.get("APP_URL") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

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

function resolveAppUrl(requestOrigin: unknown, payloadOrigin: unknown) {
  const fallback = "http://localhost:5173";
  const configuredOrigins: string[] = [];

  for (const raw of [Deno.env.get("APP_URL") || "", ...(Deno.env.get("ALLOWED_APP_ORIGINS") || "").split(",")]) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const origin = normalizeHttpOrigin(trimmed);
    if (origin) {
      configuredOrigins.push(origin);
    } else {
      console.warn("Ignoring invalid app origin:", trimmed);
    }
  }

  const candidates = [normalizeHttpOrigin(requestOrigin), normalizeHttpOrigin(payloadOrigin)].filter(Boolean) as string[];
  const hasProductionConfig = configuredOrigins.some((origin) => !isLocalOrigin(origin));

  if (hasProductionConfig) {
    for (const candidate of candidates) {
      if (configuredOrigins.includes(candidate)) return candidate;
    }
    return configuredOrigins[0];
  }

  return candidates.find((origin) => !isLocalOrigin(origin)) || candidates[0] || configuredOrigins[0] || fallback;
}

function parseIsoMs(value: string | undefined | null) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

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

function getPaymentIntentId(session: any) {
  const intent = session?.payment_intent;
  if (typeof intent === "string") return intent;
  if (intent && typeof intent === "object" && typeof intent.id === "string") return intent.id;
  return null;
}

async function markProfilePaid(supabase: any, userId: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ paid: true })
    .eq("id", userId);

  if (error) console.error("Failed to mark profile paid:", error.message);
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
  if (existingEmail) return;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email, name")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("Payment confirmation profile lookup failed:", profileError.message);
    return;
  }
  if (!profile?.email) return;

  const { error } = await supabase.functions.invoke("send-email", {
    body: {
      to: profile.email,
      type: "payment_confirmation",
      data: { name: profile.name, appUrl },
      userId,
    },
  });

  if (error) console.error("Payment confirmation email failed:", error.message);
}

async function markPaymentCompletedFromSession(supabase: any, userId: string, session: any) {
  const paymentIntentId = getPaymentIntentId(session);
  const isExpectedPaidSession =
    (session?.payment_status === "paid" || session?.status === "complete") &&
    session?.amount_total === ENTRY_AMOUNT_PENCE &&
    String(session?.currency || "").toLowerCase() === ENTRY_CURRENCY &&
    paymentIntentId;

  if (!isExpectedPaidSession) return false;

  const { error: paymentUpdateErr } = await supabase
    .from("payments")
    .update({
      status: "completed",
      stripe_payment_intent_id: paymentIntentId,
      completed_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_session_id", session.id);

  if (paymentUpdateErr) {
    console.error("Failed to reconcile completed checkout session:", paymentUpdateErr.message);
  }

  await markProfilePaid(supabase, userId);
  await sendPaymentConfirmationIfNeeded(supabase, userId);
  return true;
}

async function findExistingCheckoutState(supabase: any, stripe: any, userId: string) {
  const { data: payments, error } = await supabase
    .from("payments")
    .select("id, status, stripe_checkout_session_id, created_at")
    .eq("user_id", userId)
    .in("status", ["pending", "completed"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Failed to check existing payments before checkout:", error.message);
    return { kind: "error", error: "Could not verify existing payment status. Please try again." };
  }

  if ((payments || []).some((payment: any) => payment.status === "completed")) {
    await markProfilePaid(supabase, userId);
    await sendPaymentConfirmationIfNeeded(supabase, userId);
    return { kind: "paid" };
  }

  for (const payment of payments || []) {
    if (payment.status !== "pending" || !payment.stripe_checkout_session_id) continue;

    try {
      const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);

      if (await markPaymentCompletedFromSession(supabase, userId, session)) {
        return { kind: "paid" };
      }

      if (session.status === "open" && typeof session.url === "string" && session.url) {
        return { kind: "open", url: session.url };
      }

      if (session.status === "expired") {
        const { error: expireErr } = await supabase
          .from("payments")
          .update({ status: "expired" })
          .eq("id", payment.id)
          .eq("status", "pending");
        if (expireErr) console.error("Failed to expire stale payment row:", expireErr.message);
      }
    } catch (err) {
      console.error("Failed to inspect existing checkout session:", err);
      return { kind: "error", error: "Payment is already in progress. Refresh and try again." };
    }
  }

  return { kind: "none" };
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
            "STRIPE_SECRET_KEY is not set on the server. In Supabase: Project Settings -> Edge Functions -> Secrets.",
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

    const supabaseServiceKey = getSupabaseServiceKey();
    if (!supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Supabase service key is not configured on the server." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
      .select("email, name, username, paid, locked, stripe_customer_id")
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
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (profile.locked) {
      return new Response(
        JSON.stringify({ error: "Predictions are already locked.", locked: true }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const existingCheckout = await findExistingCheckoutState(supabase, stripe, user.id);
    if (existingCheckout.kind === "error") {
      return new Response(
        JSON.stringify({ error: existingCheckout.error, checkoutInProgress: true }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (existingCheckout.kind === "paid") {
      return new Response(
        JSON.stringify({ error: "Already paid", paid: true }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const entryDeadlineMs = await getSubmissionDeadlineMs(supabase);
    if (Date.now() >= entryDeadlineMs) {
      return new Response(
        JSON.stringify({ error: "Submissions are closed - payment is no longer available." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (existingCheckout.kind === "open") {
      return new Response(JSON.stringify({ url: existingCheckout.url, checkoutInProgress: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const appUrl = resolveAppUrl(req.headers.get("Origin"), payload?.origin);

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
              description: "GBP 10 prediction league entry",
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
      if (paymentInsertErr.code === "23505") {
        const latestCheckout = await findExistingCheckoutState(supabase, stripe, user.id);
        if (latestCheckout.kind === "paid") {
          return new Response(
            JSON.stringify({ error: "Already paid", paid: true }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        if (latestCheckout.kind === "open") {
          return new Response(JSON.stringify({ url: latestCheckout.url, checkoutInProgress: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ error: "Payment is already in progress. Refresh and try again.", checkoutInProgress: true }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
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
