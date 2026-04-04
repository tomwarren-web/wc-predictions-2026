import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "WC Predictions <noreply@yourdomain.com>";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

const templates: Record<string, (data: Record<string, unknown>) => { subject: string; html: string }> = {
  welcome: (d) => ({
    subject: "Welcome to WC Predictions 2026! ⚽",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">⚽ WC Predictions 2026</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Hey ${d.name}!</p>
        <p>Welcome to the World Cup 2026 Prediction League. You're in!</p>
        <p>Here's what to do next:</p>
        <ol style="line-height: 2;">
          <li>Fill in your <strong>match predictions</strong> for all group stage games</li>
          <li>Pick your <strong>group standings</strong></li>
          <li>Make your <strong>outright predictions</strong> (winner, golden boot, total tournament goals, etc.)</li>
          <li>Lock it all in with a <strong>£10 payment</strong></li>
        </ol>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${d.appUrl || '#'}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #facc15, #f59e0b); color: #0a0f1a; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 16px;">Make Your Predictions →</a>
        </div>
        <p style="color: #9ca3af; font-size: 13px;">Good luck! 🏆</p>
      </div>
    `,
  }),

  payment_confirmation: (d) => ({
    subject: "Payment Confirmed — You're Locked In! 🎉",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">⚽ WC Predictions 2026</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Thanks ${d.name}!</p>
        <p>Your <strong>£10 entry</strong> has been received and your predictions are now <strong>locked in</strong>.</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #22c55e;">
          <p style="margin: 0; color: #22c55e; font-weight: 600;">✓ Payment confirmed</p>
          <p style="margin: 8px 0 0; color: #9ca3af;">Your predictions cannot be changed now. Sit back and enjoy the tournament!</p>
        </div>
        <p>We'll send you updates as matches are played and the leaderboard changes.</p>
        <p style="color: #9ca3af; font-size: 13px;">Good luck! 🏆</p>
      </div>
    `,
  }),

  predictions_locked: (d) => ({
    subject: "Predictions Are Locked — The Tournament Begins! 🏟️",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">⚽ WC Predictions 2026</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">It's go time, ${d.name}!</p>
        <p>All predictions are now <strong>locked</strong>. The World Cup kicks off and scores will update in real time.</p>
        <p>Keep an eye on the leaderboard to see how you stack up against the competition!</p>
        <p style="color: #9ca3af; font-size: 13px;">May the best predictor win! 🏆</p>
      </div>
    `,
  }),

  matchday_recap: (d) => ({
    subject: `Match Day Recap — ${d.matchday || "Today's Results"} ⚽`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">⚽ Match Day Recap</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Hey ${d.name}!</p>
        <p>Here's how today's matches went:</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0;">
          ${d.resultsHtml || "<p>No results yet.</p>"}
        </div>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <p style="color: #facc15; font-weight: 600; margin: 0 0 8px;">Your Points Today: ${d.pointsToday || 0}</p>
          <p style="margin: 0; color: #9ca3af;">Total: ${d.totalPoints || 0} pts — Rank: ${d.rank || "—"}</p>
        </div>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${d.appUrl || '#'}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #facc15, #f59e0b); color: #0a0f1a; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 16px;">View Full Leaderboard →</a>
        </div>
      </div>
    `,
  }),

  weekly_standings: (d) => ({
    subject: `Weekly Leaderboard Update — You're #${d.rank || "?"} 📊`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">📊 Weekly Standings</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">Hey ${d.name}!</p>
        <p>Here's where you stand this week:</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
          <p style="font-size: 48px; color: #facc15; margin: 0; font-weight: 800;">#${d.rank || "?"}</p>
          <p style="color: #9ca3af; margin: 8px 0 0;">out of ${d.totalPlayers || "?"} players</p>
          <p style="font-size: 24px; color: #fff; margin: 16px 0 0; font-weight: 700;">${d.totalPoints || 0} points</p>
        </div>
        ${d.leaderboardHtml || ""}
        <div style="text-align: center; margin: 32px 0;">
          <a href="${d.appUrl || '#'}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #facc15, #f59e0b); color: #0a0f1a; font-weight: 700; border-radius: 8px; text-decoration: none; font-size: 16px;">View Full Leaderboard →</a>
        </div>
      </div>
    `,
  }),

  tournament_complete: (d) => ({
    subject: "The World Cup Is Over — Final Standings! 🏆",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">🏆 Final Standings</h1>
        </div>
        <p style="font-size: 18px; color: #fff;">It's all over, ${d.name}!</p>
        <p>The 2026 World Cup has come to an end. Here are the final prediction league results:</p>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
          <p style="font-size: 48px; color: #facc15; margin: 0; font-weight: 800;">#${d.rank || "?"}</p>
          <p style="color: #9ca3af; margin: 8px 0 0;">Your final position</p>
          <p style="font-size: 24px; color: #fff; margin: 16px 0 0; font-weight: 700;">${d.totalPoints || 0} points</p>
        </div>
        <div style="background: #1a2332; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <p style="color: #facc15; font-weight: 600; margin: 0 0 12px;">🏆 Prize Winners</p>
          ${d.winnersHtml || "<p>To be confirmed.</p>"}
        </div>
        <p>Thanks for playing! See you at the next tournament.</p>
      </div>
    `,
  }),

  custom: (d) => ({
    subject: (d.subject as string) || "WC Predictions 2026 Update",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0a0f1a; color: #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #facc15; font-size: 28px; margin: 0;">⚽ WC Predictions 2026</h1>
        </div>
        ${d.bodyHtml || "<p>No content.</p>"}
      </div>
    `,
  }),
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supabaseAuth.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, type, data = {}, userId } = (await req.json()) as EmailRequest;

    if (!to || !type) {
      return new Response(
        JSON.stringify({ error: "Missing 'to' or 'type'" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
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
      user_id: userId || null,
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
