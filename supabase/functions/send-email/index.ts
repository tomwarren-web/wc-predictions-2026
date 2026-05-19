import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "WC Predictions <noreply@yourdomain.com>";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ALLOWED_TYPES = new Set([
  "welcome",
  "payment_confirmation",
  "predictions_locked",
  "matchday_recap",
  "weekly_standings",
  "tournament_complete",
]);
const USER_ALLOWED_TYPES = new Set(["welcome"]);

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

interface EmailRequest {
  to: string;
  type: string;
  data?: Record<string, unknown>;
  userId?: string;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return "#";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? escapeHtml(url.toString()) : "#";
  } catch {
    return "#";
  }
}

const templates: Record<string, (data: Record<string, unknown>) => { subject: string; html: string }> = {
  welcome: (d) => ({
    subject: "Welcome to WC Predictions 2026!",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">WC Predictions 2026</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Hey ${escapeHtml(d.name)}!</p>
        <p>Welcome to the World Cup 2026 Prediction League. You're in!</p>
        <p>Here's what to do next:</p>
        <ol style="line-height: 2;">
          <li>Fill in your <strong>match predictions</strong> for all group stage games</li>
          <li>Pick your <strong>group standings</strong></li>
          <li>Make your <strong>outright predictions</strong> (winner, golden boot, total tournament goals, etc.)</li>
          <li>Lock it all in with a <strong>£10 payment</strong></li>
        </ol>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${safeUrl(d.appUrl)}" style="display: inline-block; padding: 14px 32px; background: #facc15; color: #0a0f1a; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 16px;">Make Your Predictions</a>
        </div>
        <p style="color: #9ca3af; font-size: 13px;">Good luck!</p>
      </div>
    `,
  }),

  payment_confirmation: (d) => ({
    subject: "Entry Confirmed - Predictions Submitted",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">WC Predictions 2026</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Thanks ${escapeHtml(d.name)}!</p>
        <p>Your <strong>£10 entry</strong> has been received. Your predictions have been <strong>submitted</strong>, and you can keep editing them until the entry deadline.</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #22c55e;">
          <p style="margin: 0; color: #22c55e; font-weight: 600;">Entry confirmed</p>
          <p style="margin: 8px 0 0; color: #9ca3af;">Your place is paid for. If you change any picks before the deadline, just save them again.</p>
        </div>
        <div style="background: #111827; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <p style="color: #facc15; font-weight: 700; margin: 0 0 12px;">How to keep track</p>
          <ol style="line-height: 1.8; padding-left: 20px; margin: 0; color: #d1d5db;">
            <li>Sign in any time before the deadline to review or edit your predictions.</li>
            <li>Once entries close, predictions lock and the <strong>Leaderboard</strong> tab will appear so everyone can see the standings.</li>
            <li>During the tournament, points and rankings update as match results come in.</li>
            <li>Open the leaderboard to follow your rank, points breakdown, prize race, and other players' picks.</li>
          </ol>
        </div>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${safeUrl(d.appUrl)}" style="display: inline-block; padding: 14px 32px; background: #facc15; color: #0a0f1a; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 16px;">Review Predictions</a>
        </div>
        <p style="color: #9ca3af; font-size: 13px;">Good luck!</p>
      </div>
    `,
  }),

  predictions_locked: (d) => ({
    subject: "Predictions Are Locked — The Tournament Begins!",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">WC Predictions 2026</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">It's go time, ${escapeHtml(d.name)}!</p>
        <p>All predictions are now <strong>locked</strong>. The World Cup kicks off and scores will update in real time.</p>
        <p>Keep an eye on the leaderboard to see how you stack up against the competition!</p>
        <p style="color: #9ca3af; font-size: 13px;">May the best predictor win!</p>
      </div>
    `,
  }),

  matchday_recap: (d) => ({
    subject: `Match Day Recap — ${escapeHtml(d.matchday || "Today's Results")}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">Match Day Recap</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Hey ${escapeHtml(d.name)}!</p>
        <p>Here's how today's matches went:</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0;">
          ${d.resultsHtml || "<p>No results yet.</p>"}
        </div>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <p style="color: #facc15; font-weight: 600; margin: 0 0 8px;">Your Points Today: ${escapeHtml(d.pointsToday || 0)}</p>
          <p style="margin: 0; color: #9ca3af;">Total: ${escapeHtml(d.totalPoints || 0)} pts — Rank: ${escapeHtml(d.rank || "—")}</p>
        </div>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${safeUrl(d.appUrl)}" style="display: inline-block; padding: 14px 32px; background: #facc15; color: #0a0f1a; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 16px;">View Full Leaderboard</a>
        </div>
      </div>
    `,
  }),

  weekly_standings: (d) => ({
    subject: `Weekly Leaderboard Update — You're #${escapeHtml(d.rank || "?")}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">Weekly Standings</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Hey ${escapeHtml(d.name)}!</p>
        <p>Here's where you stand this week:</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
          <p style="font-size: 48px; color: #facc15; margin: 0; font-weight: 800;">#${escapeHtml(d.rank || "?")}</p>
          <p style="color: #9ca3af; margin: 8px 0 0;">out of ${escapeHtml(d.totalPlayers || "?")} players</p>
          <p style="font-size: 24px; color: #fff; margin: 16px 0 0; font-weight: 700;">${escapeHtml(d.totalPoints || 0)} points</p>
        </div>
        ${d.leaderboardHtml || ""}
        <div style="text-align: center; margin: 32px 0;">
          <a href="${safeUrl(d.appUrl)}" style="display: inline-block; padding: 14px 32px; background: #facc15; color: #0a0f1a; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 16px;">View Full Leaderboard</a>
        </div>
      </div>
    `,
  }),

  tournament_complete: (d) => ({
    subject: "The World Cup Is Over — Final Standings!",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">Final Standings</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">It's all over, ${escapeHtml(d.name)}!</p>
        <p>The 2026 World Cup has come to an end. Here are the final prediction league results:</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
          <p style="font-size: 48px; color: #facc15; margin: 0; font-weight: 800;">#${escapeHtml(d.rank || "?")}</p>
          <p style="color: #9ca3af; margin: 8px 0 0;">Your final position</p>
          <p style="font-size: 24px; color: #fff; margin: 16px 0 0; font-weight: 700;">${escapeHtml(d.totalPoints || 0)} points</p>
        </div>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <p style="color: #facc15; font-weight: 600; margin: 0 0 12px;">Prize Winners</p>
          ${d.winnersHtml || "<p>To be confirmed.</p>"}
        </div>
        <p>Thanks for playing! See you at the next tournament.</p>
      </div>
    `,
  }),
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseServiceKey = getSupabaseServiceKey();
    if (!supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Supabase service key is not configured on the server." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const isServiceCall = token === supabaseServiceKey;
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);
    const authResult = isServiceCall
      ? { user: null, error: null }
      : await supabaseAuth.auth.getUser(token).then(({ data: { user }, error }) => ({ user, error }));

    if (!isServiceCall && (authResult.error || !authResult.user)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, type, data = {}, userId } = (await req.json()) as EmailRequest;
    const user = authResult.user;

    if (!to || !type) {
      return new Response(
        JSON.stringify({ error: "Missing 'to' or 'type'" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (isServiceCall) {
      if (!SERVICE_ALLOWED_TYPES.has(type)) {
        return new Response(JSON.stringify({ error: `Email type not allowed: ${type}` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const userEmail = user?.email?.trim().toLowerCase();
      if (!USER_ALLOWED_TYPES.has(type)) {
        return new Response(JSON.stringify({ error: `Email type not allowed: ${type}` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!userEmail || to.trim().toLowerCase() !== userEmail) {
        return new Response(JSON.stringify({ error: "Email recipient must match the signed-in user." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (userId && userId !== user?.id) {
        return new Response(JSON.stringify({ error: "userId must match the signed-in user." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const templateFn = templates[type];
    if (!templateFn) {
      return new Response(
        JSON.stringify({ error: `Unknown email type: ${type}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { subject, html } = templateFn(data);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });

    const resBody = await res.json();

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await supabase.from("email_log").insert({
      user_id: userId || user?.id || null,
      email_to: to,
      email_type: type,
      subject,
      resend_id: resBody.id || null,
      status: res.ok ? "sent" : "failed",
    });

    if (!res.ok) {
      console.error("Resend API error:", resBody);
      return new Response(JSON.stringify({ error: "Email send failed", detail: resBody }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: resBody.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-email error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
