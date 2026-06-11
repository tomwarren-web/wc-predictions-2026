import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const API_KEY = Deno.env.get("API_FOOTBALL_KEY") || Deno.env.get("VITE_API_FOOTBALL_KEY");
const BASE_URL = "https://v3.football.api-sports.io";
const LEAGUE_ID = 1;
const SEASON = 2026;
const CACHE_KEY = "api_football_results_cache";

const LIVE_CACHE_TTL_MS = Number(Deno.env.get("RESULTS_LIVE_CACHE_TTL_MS") || 10 * 60 * 1000);
const IDLE_CACHE_TTL_MS = Number(Deno.env.get("RESULTS_IDLE_CACHE_TTL_MS") || 60 * 60 * 1000);
const AUX_CACHE_TTL_MS = Number(Deno.env.get("RESULTS_AUX_CACHE_TTL_MS") || 6 * 60 * 60 * 1000);
const MAX_EVENT_FETCHES_PER_REFRESH = Number(Deno.env.get("RESULTS_MAX_EVENT_FETCHES") || 20);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const TEAM_ALIAS: Record<string, string> = {
  "Korea Republic": "South Korea",
  "Korea South": "South Korea",
  "Cote D Ivoire": "Ivory Coast",
  "Cote d'Ivoire": "Ivory Coast",
  "Côte d'Ivoire": "Ivory Coast",
  Curacao: "Curaçao",
  "Cape Verde Islands": "Cape Verde",
  "United States": "USA",
  "Saudi-Arabia": "Saudi Arabia",
};

const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function normalizeTeamName(apiName: string | null | undefined) {
  if (!apiName) return apiName;
  return TEAM_ALIAS[apiName] || apiName;
}

async function apiFetch(endpoint: string, params: Record<string, string | number> = {}) {
  if (!API_KEY) throw new Error("API_FOOTBALL_KEY is not configured.");
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": API_KEY },
  });

  if (!res.ok) throw new Error(`API-Football ${res.status}: ${res.statusText}`);

  const body = await res.json();
  if (body.errors && Object.keys(body.errors).length) {
    throw new Error(`API-Football: ${Object.values(body.errors).join(", ")}`);
  }
  return body.response;
}

function getMatchWinner(match: any) {
  if (!match || match.homeGoals == null || match.awayGoals == null) return null;
  if (match.homeGoals > match.awayGoals) return match.homeTeam;
  if (match.awayGoals > match.homeGoals) return match.awayTeam;
  if (match.status === "PEN" && match.homePenaltyGoals != null && match.awayPenaltyGoals != null) {
    if (match.homePenaltyGoals > match.awayPenaltyGoals) return match.homeTeam;
    if (match.awayPenaltyGoals > match.homePenaltyGoals) return match.awayTeam;
  }
  return null;
}

function getMatchLoser(match: any) {
  const winner = getMatchWinner(match);
  if (!winner) return null;
  if (winner === match.homeTeam) return match.awayTeam;
  if (winner === match.awayTeam) return match.homeTeam;
  return null;
}

function englandWonMatch(match: any) {
  return match?.isFinished && getMatchWinner(match) === "England";
}

function mapRoundToEnglandProgress(round: string, wonLast: boolean) {
  const value = (round || "").toLowerCase();
  const isThird = value.includes("3rd") || value.includes("third place");
  const isFinal = value.includes("final") && !value.includes("semi") && !isThird;
  if (isFinal) return wonLast ? "Winners" : "Final";
  if (value.includes("semi")) return "Semi-finals";
  if (value.includes("quarter")) return "Quarter-finals";
  if (value.includes("16") || value.includes("1/8") || value.includes("eighth")) return "Round of 16";
  if (value.includes("32")) return "Round of 32";
  if (value.includes("group")) return "Group stage";
  return null;
}

function computeEnglandProgress(matchMap: Record<string, any>) {
  const englandFinished = Object.values(matchMap).filter(
    (match) => (match.homeTeam === "England" || match.awayTeam === "England") && match.isFinished,
  );
  if (!englandFinished.length) return null;
  englandFinished.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const last = englandFinished[0];
  return mapRoundToEnglandProgress(last.round, englandWonMatch(last));
}

function parseStandings(standingsData: any[]) {
  const groupStandings: Record<string, string[]> = {};
  if (standingsData?.[0]?.league?.standings) {
    for (const groupArr of standingsData[0].league.standings) {
      if (!groupArr.length) continue;
      const groupLetter = (groupArr[0].group || "").replace("Group ", "").trim();
      if (groupLetter) {
        groupStandings[groupLetter] = groupArr.map((row: any) => normalizeTeamName(row.team?.name));
      }
    }
  }
  return groupStandings;
}

function parseTopScorers(scorersData: any[]) {
  return (scorersData || []).map((scorer) => ({
    team: normalizeTeamName(scorer.statistics?.[0]?.team?.name),
    player: scorer.player?.name,
    goals: scorer.statistics?.[0]?.goals?.total || 0,
    key: `${normalizeTeamName(scorer.statistics?.[0]?.team?.name)}|${scorer.player?.name}`,
  }));
}

function buildTournamentResults(matchMap: Record<string, any>) {
  const tournamentResults = { winner: null as string | null, runnerUp: null as string | null, third: null as string | null };
  for (const match of Object.values(matchMap)) {
    if (!match.isFinished) continue;
    const round = match.round.toLowerCase();

    if (round.includes("final") && !round.includes("semi") && !round.includes("quarter") && !round.includes("3rd") && !round.includes("third")) {
      const winner = getMatchWinner(match);
      const loser = getMatchLoser(match);
      if (winner && loser) {
        tournamentResults.winner = winner;
        tournamentResults.runnerUp = loser;
      }
    }

    if (round.includes("3rd") || round.includes("third")) {
      tournamentResults.third = getMatchWinner(match);
    }
  }
  return tournamentResults;
}

function buildStats(matchMap: Record<string, any>) {
  const allFinished = Object.values(matchMap).filter((match) => match.isFinished);
  let totalGoals = 0;
  let groupGoals = 0;
  const teamGoals: Record<string, number> = {};
  const teamCleanSheets: Record<string, number> = {};
  let redCards = 0;
  let penaltyShootouts = 0;
  let hatTricks = 0;
  let extraTimeFinalsCount = 0;

  for (const match of allFinished) {
    const homeGoals = match.homeGoals || 0;
    const awayGoals = match.awayGoals || 0;
    totalGoals += homeGoals + awayGoals;

    const isGroup = match.round.toLowerCase().includes("group");
    if (isGroup) groupGoals += homeGoals + awayGoals;

    teamGoals[match.homeTeam] = (teamGoals[match.homeTeam] || 0) + homeGoals;
    teamGoals[match.awayTeam] = (teamGoals[match.awayTeam] || 0) + awayGoals;

    if (awayGoals === 0) teamCleanSheets[match.homeTeam] = (teamCleanSheets[match.homeTeam] || 0) + 1;
    if (homeGoals === 0) teamCleanSheets[match.awayTeam] = (teamCleanSheets[match.awayTeam] || 0) + 1;

    if (match.status === "PEN") penaltyShootouts += 1;
    if (match.status === "AET" || match.status === "PEN") {
      const round = match.round.toLowerCase();
      if (round.includes("final") || round.includes("semi") || round.includes("3rd") || round.includes("third")) {
        extraTimeFinalsCount += 1;
      }
    }

    const scorerCounts: Record<string, number> = {};
    for (const scorer of match.scorers || []) {
      scorerCounts[scorer] = (scorerCounts[scorer] || 0) + 1;
    }
    for (const count of Object.values(scorerCounts)) {
      if (count >= 3) hatTricks += 1;
    }
  }

  const topScoringTeam = Object.entries(teamGoals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const mostCleanSheets = Object.entries(teamCleanSheets).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    totalGoals,
    groupGoals,
    topScoringTeam,
    mostCleanSheets,
    penaltyShootouts,
    redCards,
    hatTricks,
    extraTimeFinalsCount,
  };
}

async function readCache(supabase: any) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", CACHE_KEY)
    .maybeSingle();

  if (error) {
    console.warn("Could not read football results cache:", error.message);
    return null;
  }

  try {
    return data?.value ? JSON.parse(data.value) : null;
  } catch {
    return null;
  }
}

async function writeCache(supabase: any, results: Record<string, unknown>) {
  const { error } = await supabase
    .from("app_settings")
    .upsert({
      key: CACHE_KEY,
      value: JSON.stringify(results),
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

  if (error) console.warn("Could not write football results cache:", error.message);
}

async function fetchGoalEvents(fixtureId: number) {
  const events = await apiFetch("/fixtures/events", { fixture: fixtureId, type: "Goal" }).catch(() => []);
  const scorers: string[] = [];
  for (const event of events || []) {
    if (event.detail === "Missed Penalty" || event.detail === "Own Goal") continue;
    const team = normalizeTeamName(event.team?.name);
    const player = event.player?.name;
    if (team && player) scorers.push(`${team}|${player}`);
  }
  return scorers;
}

async function fetchFreshResults(cached: any) {
  const now = Date.now();
  const cachedMatchesByFixtureId = new Map<number, any>();
  for (const match of Object.values(cached?.matches || {}) as any[]) {
    if (typeof match?.fixtureId === "number") cachedMatchesByFixtureId.set(match.fixtureId, match);
  }

  const fixtures = await apiFetch("/fixtures", { league: LEAGUE_ID, season: SEASON });
  const shouldRefreshAux =
    !cached ||
    !cached.auxFetchedAt ||
    now - Number(cached.auxFetchedAt) > AUX_CACHE_TTL_MS ||
    !cached.standings ||
    !cached.topScorers;

  const [standingsData, scorersData] = shouldRefreshAux
    ? await Promise.all([
        apiFetch("/standings", { league: LEAGUE_ID, season: SEASON }).catch(() => []),
        apiFetch("/players/topscorers", { league: LEAGUE_ID, season: SEASON }).catch(() => []),
      ])
    : [null, null];

  let hasLive = false;
  const matchMap: Record<string, any> = {};
  const eventFetchIds: number[] = [];

  for (const fixture of fixtures) {
    const status = fixture.fixture?.status?.short || "NS";
    const homeTeam = normalizeTeamName(fixture.teams?.home?.name);
    const awayTeam = normalizeTeamName(fixture.teams?.away?.name);
    if (!homeTeam || !awayTeam) continue;

    const isLive = LIVE_STATUSES.has(status);
    const isFinished = FINISHED_STATUSES.has(status);
    if (isLive) hasLive = true;

    const fixtureId = fixture.fixture.id;
    const cachedMatch = cachedMatchesByFixtureId.get(fixtureId);
    const cachedScorers = Array.isArray(cachedMatch?.scorers) ? cachedMatch.scorers : [];
    const shouldFetchEvents =
      isLive ||
      (isFinished && cachedMatch?.scorersFetched !== true && eventFetchIds.length < MAX_EVENT_FETCHES_PER_REFRESH);

    if (shouldFetchEvents) eventFetchIds.push(fixtureId);

    matchMap[`${homeTeam}-${awayTeam}`] = {
      fixtureId,
      date: fixture.fixture.date,
      status,
      statusLong: fixture.fixture?.status?.long || status,
      minute: fixture.fixture?.status?.elapsed || null,
      homeTeam,
      awayTeam,
      homeGoals: fixture.goals?.home ?? null,
      awayGoals: fixture.goals?.away ?? null,
      homePenaltyGoals: fixture.score?.penalty?.home ?? null,
      awayPenaltyGoals: fixture.score?.penalty?.away ?? null,
      round: fixture.league?.round || "",
      isLive,
      isFinished,
      scorers: cachedScorers,
      scorersFetched: cachedMatch?.scorersFetched === true,
    };
  }

  for (const fixtureId of eventFetchIds) {
    const entry = Object.values(matchMap).find((match) => match.fixtureId === fixtureId);
    if (!entry) continue;
    entry.scorers = await fetchGoalEvents(fixtureId);
    entry.scorersFetched = !entry.isLive;
  }

  const auxFetchedAt = shouldRefreshAux ? now : cached.auxFetchedAt;
  const results = {
    matches: matchMap,
    standings: shouldRefreshAux ? parseStandings(standingsData || []) : cached.standings,
    topScorers: shouldRefreshAux ? parseTopScorers(scorersData || []) : cached.topScorers,
    tournamentResults: buildTournamentResults(matchMap),
    englandProgress: computeEnglandProgress(matchMap),
    stats: buildStats(matchMap),
    hasLive,
    fetchedAt: now,
    auxFetchedAt,
    eventFetchesThisRefresh: eventFetchIds.length,
    cache: { hit: false, ttlMs: hasLive ? LIVE_CACHE_TTL_MS : IDLE_CACHE_TTL_MS },
  };

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const serviceKey = getSupabaseServiceKey();
    if (!serviceKey) return json({ error: "Supabase service key is not configured." }, 500);
    if (!API_KEY) return json({ error: "API_FOOTBALL_KEY is not configured." }, 500);

    const supabase = createClient(supabaseUrl, serviceKey);
    const cached = await readCache(supabase);
    const now = Date.now();
    const cachedAt = Number(cached?.fetchedAt || 0);
    const ttl = cached?.hasLive ? LIVE_CACHE_TTL_MS : IDLE_CACHE_TTL_MS;

    if (cached && cachedAt && now - cachedAt <= ttl) {
      return json({
        ...cached,
        cache: { hit: true, ttlMs: ttl },
      });
    }

    const results = await fetchFreshResults(cached);
    await writeCache(supabase, results);
    return json(results);
  } catch (err) {
    console.error("football-results error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
