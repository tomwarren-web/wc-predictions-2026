import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const API_KEY = Deno.env.get("API_FOOTBALL_KEY") || Deno.env.get("VITE_API_FOOTBALL_KEY");
const FOOTBALL_DATA_TOKEN = Deno.env.get("FOOTBALL_DATA_TOKEN") || Deno.env.get("FOOTBALL_DATA_ORG_TOKEN");
const FOOTBALL_DATA_BASE_URL = "https://api.football-data.org/v4";
const FOOTBALL_DATA_COMPETITION = Deno.env.get("FOOTBALL_DATA_COMPETITION") || "WC";
const BASE_URL = "https://v3.football.api-sports.io";
const LEAGUE_ID = 1;
const SEASON = 2026;
const CACHE_KEY = "football_results_cache_v2";
const RATE_LIMIT_KEY = "football_data_rate_limit_v1";

const LIVE_CACHE_TTL_MS = Number(Deno.env.get("RESULTS_LIVE_CACHE_TTL_MS") || 10 * 60 * 1000);
const IDLE_CACHE_TTL_MS = Number(Deno.env.get("RESULTS_IDLE_CACHE_TTL_MS") || 60 * 60 * 1000);
const AUX_CACHE_TTL_MS = Number(Deno.env.get("RESULTS_AUX_CACHE_TTL_MS") || 6 * 60 * 60 * 1000);
const MAX_EVENT_FETCHES_PER_REFRESH = Number(Deno.env.get("RESULTS_MAX_EVENT_FETCHES") || 20);
const MIN_FOOTBALL_DATA_REQUESTS_AVAILABLE = Number(Deno.env.get("MIN_FOOTBALL_DATA_REQUESTS_AVAILABLE") || 5);

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
  Czechia: "Czech Republic",
  "Cape Verde Islands": "Cape Verde",
  "Bosnia and Herzegovina": "Bosnia-Herzegovina",
  "Congo DR": "DR Congo",
  "DR Congo": "DR Congo",
  "United States": "USA",
  "United States of America": "USA",
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

function parseHeaderInt(headers: Headers, name: string) {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function footballDataFetch(supabase: any, endpoint: string, params: Record<string, string | number> = {}) {
  if (!FOOTBALL_DATA_TOKEN) throw new Error("FOOTBALL_DATA_TOKEN is not configured.");
  const url = new URL(`${FOOTBALL_DATA_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const res = await fetch(url.toString(), {
    headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN },
  });

  const requestsAvailable = parseHeaderInt(res.headers, "X-RequestsAvailable");
  const resetSeconds = parseHeaderInt(res.headers, "X-RequestCounter-Reset");
  const resetAt = resetSeconds == null ? null : Date.now() + resetSeconds * 1000;

  if (res.status === 429) {
    await writeFootballDataRateLimit(supabase, {
      throttledUntil: resetAt ?? Date.now() + 60_000,
      requestsAvailable: 0,
      resetSeconds,
      reason: "429",
      updatedAt: Date.now(),
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org ${res.status}: ${body || res.statusText}`);
  }

  const body = await res.json();

  if (requestsAvailable != null && requestsAvailable <= MIN_FOOTBALL_DATA_REQUESTS_AVAILABLE) {
    await writeFootballDataRateLimit(supabase, {
      throttledUntil: resetAt ?? Date.now() + 60_000,
      requestsAvailable,
      resetSeconds,
      reason: "low_remaining",
      updatedAt: Date.now(),
    });
  }

  return body;
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

function footballDataStatus(match: any) {
  const status = String(match?.status || "").toUpperCase();
  const isLive = status === "IN_PLAY" || status === "PAUSED" || status === "LIVE";
  const isFinished = status === "FINISHED";
  return { status, isLive, isFinished };
}

function footballDataGoals(match: any) {
  const score = match?.score || {};
  const fullTime = score.fullTime || {};
  const regularTime = score.regularTime || {};
  return {
    homeGoals: fullTime.home ?? regularTime.home ?? score.home ?? null,
    awayGoals: fullTime.away ?? regularTime.away ?? score.away ?? null,
    homePenaltyGoals: score.penalties?.home ?? null,
    awayPenaltyGoals: score.penalties?.away ?? null,
  };
}

function parseFootballDataStandings(standingsData: any) {
  const groupStandings: Record<string, string[]> = {};
  for (const standing of standingsData?.standings || []) {
    const groupName = String(standing.group || "").replace("GROUP_", "").replace("Group ", "").trim();
    if (!groupName || !Array.isArray(standing.table)) continue;
    groupStandings[groupName] = standing.table.map((row: any) => normalizeTeamName(row.team?.shortName || row.team?.name));
  }
  return groupStandings;
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

async function readFootballDataRateLimit(supabase: any) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", RATE_LIMIT_KEY)
    .maybeSingle();

  if (error) {
    console.warn("Could not read football-data.org rate limit state:", error.message);
    return null;
  }

  try {
    return data?.value ? JSON.parse(data.value) : null;
  } catch {
    return null;
  }
}

async function writeFootballDataRateLimit(supabase: any, state: Record<string, unknown>) {
  const { error } = await supabase
    .from("app_settings")
    .upsert({
      key: RATE_LIMIT_KEY,
      value: JSON.stringify(state),
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

  if (error) console.warn("Could not write football-data.org rate limit state:", error.message);
}

function isFootballDataThrottled(state: any, now: number) {
  return typeof state?.throttledUntil === "number" && state.throttledUntil > now;
}

function withStaleCacheMetadata(cached: any, reason: string, extra: Record<string, unknown> = {}) {
  return {
    ...cached,
    cache: {
      ...(cached?.cache || {}),
      hit: true,
      stale: true,
      reason,
      ...extra,
    },
  };
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

async function fetchFootballDataResults(supabase: any, cached: any) {
  const now = Date.now();
  const matchesData = await footballDataFetch(supabase, `/competitions/${FOOTBALL_DATA_COMPETITION}/matches`, { season: SEASON });
  const shouldRefreshAux =
    !cached ||
    !cached.auxFetchedAt ||
    now - Number(cached.auxFetchedAt) > AUX_CACHE_TTL_MS ||
    !cached.standings ||
    !cached.topScorers;

  const standingsData = shouldRefreshAux
    ? await footballDataFetch(supabase, `/competitions/${FOOTBALL_DATA_COMPETITION}/standings`, { season: SEASON }).catch(() => null)
    : null;

  let hasLive = false;
  const matchMap: Record<string, any> = {};

  for (const match of matchesData?.matches || []) {
    const homeTeam = normalizeTeamName(match.homeTeam?.shortName || match.homeTeam?.name);
    const awayTeam = normalizeTeamName(match.awayTeam?.shortName || match.awayTeam?.name);
    if (!homeTeam || !awayTeam) continue;

    const { status, isLive, isFinished } = footballDataStatus(match);
    const goals = footballDataGoals(match);
    if (isLive) hasLive = true;

    matchMap[`${homeTeam}-${awayTeam}`] = {
      fixtureId: match.id,
      date: match.utcDate,
      status,
      statusLong: status,
      minute: null,
      homeTeam,
      awayTeam,
      ...goals,
      round: match.stage || match.group || "",
      isLive,
      isFinished,
      scorers: [],
      scorersFetched: true,
      provider: "football-data.org",
    };
  }

  const auxFetchedAt = shouldRefreshAux ? now : cached.auxFetchedAt;
  return {
    matches: matchMap,
    standings: shouldRefreshAux ? parseFootballDataStandings(standingsData) : cached.standings,
    topScorers: shouldRefreshAux ? [] : cached.topScorers,
    tournamentResults: buildTournamentResults(matchMap),
    englandProgress: computeEnglandProgress(matchMap),
    stats: buildStats(matchMap),
    hasLive,
    fetchedAt: now,
    auxFetchedAt,
    eventFetchesThisRefresh: 0,
    provider: "football-data.org",
    cache: { hit: false, ttlMs: hasLive ? LIVE_CACHE_TTL_MS : IDLE_CACHE_TTL_MS },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const serviceKey = getSupabaseServiceKey();
    if (!serviceKey) return json({ error: "Supabase service key is not configured." }, 500);
    if (!FOOTBALL_DATA_TOKEN && !API_KEY) {
      return json({ error: "FOOTBALL_DATA_TOKEN or API_FOOTBALL_KEY is not configured." }, 500);
    }

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

    const rateLimitState = FOOTBALL_DATA_TOKEN ? await readFootballDataRateLimit(supabase) : null;
    if (FOOTBALL_DATA_TOKEN && cached && isFootballDataThrottled(rateLimitState, now)) {
      return json(withStaleCacheMetadata(cached, "football-data-rate-limit", {
        throttledUntil: rateLimitState.throttledUntil,
        requestsAvailable: rateLimitState.requestsAvailable,
      }));
    }

    let results;
    try {
      results = FOOTBALL_DATA_TOKEN
        ? await fetchFootballDataResults(supabase, cached)
        : await fetchFreshResults(cached);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (FOOTBALL_DATA_TOKEN && cached && /429|rate|thrott/i.test(message)) {
        return json(withStaleCacheMetadata(cached, "football-data-rate-limit-error", { error: message }));
      }
      throw err;
    }

    await writeCache(supabase, results);
    return json(results);
  } catch (err) {
    console.error("football-results error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
