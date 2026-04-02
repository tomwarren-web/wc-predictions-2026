const API_KEY = import.meta.env.VITE_API_FOOTBALL_KEY;
const BASE_URL = "https://v3.football.api-sports.io";
const LEAGUE_ID = 1; // FIFA World Cup
const SEASON = 2026;

export const isApiFootballConfigured = Boolean(API_KEY);

// API-Football team names → our internal TEAMS constant names
const TEAM_ALIAS = {
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

function normalizeTeamName(apiName) {
  if (!apiName) return apiName;
  return TEAM_ALIAS[apiName] || apiName;
}

function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePlayerName(name) {
  return stripAccents(name || "").toLowerCase().trim();
}

/**
 * Look up API result for a fixture keyed as `home-away` in our app.
 * If the API lists teams in reverse order, goals are swapped to align with (home, away).
 */
export function getMatchResultForTeams(matchesMap, home, away) {
  if (!matchesMap) return null;
  const forward = `${home}-${away}`;
  const rev = `${away}-${home}`;
  if (matchesMap[forward]) return matchesMap[forward];
  const r = matchesMap[rev];
  if (!r) return null;
  return {
    ...r,
    homeTeam: home,
    awayTeam: away,
    homeGoals: r.awayGoals,
    awayGoals: r.homeGoals,
  };
}

export function matchPlayerName(apiPlayer, predictionScorer) {
  if (!apiPlayer || !predictionScorer) return false;
  const predParts = predictionScorer.split("|");
  if (predParts.length < 2) return false;
  const predName = normalizePlayerName(predParts[1]);
  const apiNorm = normalizePlayerName(apiPlayer);

  if (predName === apiNorm) return true;

  // Handle "Firstname Lastname" vs "F. Lastname" or partial matches
  const predTokens = predName.split(/\s+/);
  const apiTokens = apiNorm.split(/\s+/);
  const predLast = predTokens[predTokens.length - 1];
  const apiLast = apiTokens[apiTokens.length - 1];
  if (predLast === apiLast && predTokens.length > 1 && apiTokens.length > 1) {
    return true;
  }

  return false;
}

// Cache with per-key TTLs
const CACHE_PREFIX = "wc-apifb-";

function getCached(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ data, ts: Date.now() }),
    );
  } catch {
    /* quota exceeded — ignore */
  }
}

async function apiFetch(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": API_KEY },
  });

  if (!res.ok) {
    throw new Error(`API-Football ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(
      `API-Football: ${Object.values(json.errors).join(", ")}`,
    );
  }
  return json.response;
}

// Status codes that mean the match is currently in play
const LIVE_STATUSES = new Set([
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "SUSP",
  "INT",
  "LIVE",
]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

let _hasLive = false;
export function hasLiveMatches() {
  return _hasLive;
}

function englandWonMatch(m) {
  if (!m.isFinished || m.homeGoals == null || m.awayGoals == null) return false;
  const engHome = m.homeTeam === "England";
  if (m.homeGoals > m.awayGoals) return engHome;
  if (m.awayGoals > m.homeGoals) return !engHome;
  return false;
}

/** Map API round string + whether England won their last match to progress labels (must match UI options). */
function mapRoundToEnglandProgress(round, wonLast) {
  const r = (round || "").toLowerCase();
  const isThird = r.includes("3rd") || r.includes("third place");
  const isFinal = r.includes("final") && !r.includes("semi") && !isThird;
  if (isFinal) return wonLast ? "Winners" : "Final";
  if (r.includes("semi")) return "Semi-finals";
  if (r.includes("quarter")) return "Quarter-finals";
  if (r.includes("16") || r.includes("1/8") || r.includes("eighth")) return "Round of 16";
  if (r.includes("32")) return "Round of 32";
  if (r.includes("group")) return "Group stage";
  return null;
}

/** Furthest stage England reached, from their chronologically last finished match. */
function computeEnglandProgress(matchMap) {
  const englandFinished = Object.values(matchMap).filter(
    (m) =>
      (m.homeTeam === "England" || m.awayTeam === "England") && m.isFinished,
  );
  if (!englandFinished.length) return null;
  englandFinished.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const last = englandFinished[0];
  return mapRoundToEnglandProgress(last.round, englandWonMatch(last));
}

/**
 * Fetch all WC 2026 fixtures with scores.
 * Returns: { matches, standings, topScorers, tournamentResults }
 */
export async function fetchAllResults() {
  if (!isApiFootballConfigured) return null;

  // Use shorter cache for live matches, longer otherwise
  const cacheTTL = _hasLive ? 60_000 : 300_000;
  const cached = getCached("results", cacheTTL);
  if (cached) return cached;

  const [fixtures, standingsData, scorersData] = await Promise.all([
    apiFetch("/fixtures", { league: LEAGUE_ID, season: SEASON }),
    apiFetch("/standings", { league: LEAGUE_ID, season: SEASON }).catch(
      () => [],
    ),
    apiFetch("/players/topscorers", {
      league: LEAGUE_ID,
      season: SEASON,
    }).catch(() => []),
  ]);

  _hasLive = false;

  // Parse fixtures and collect IDs of finished/live for event fetching
  const matchMap = {};
  const liveOrFinishedIds = [];

  for (const fx of fixtures) {
    const status = fx.fixture?.status?.short || "NS";
    const homeTeam = normalizeTeamName(fx.teams?.home?.name);
    const awayTeam = normalizeTeamName(fx.teams?.away?.name);

    if (!homeTeam || !awayTeam) continue;

    const key = `${homeTeam}-${awayTeam}`;
    const isLive = LIVE_STATUSES.has(status);
    const isFinished = FINISHED_STATUSES.has(status);

    if (isLive) _hasLive = true;

    matchMap[key] = {
      fixtureId: fx.fixture.id,
      date: fx.fixture.date,
      status,
      statusLong: fx.fixture?.status?.long || status,
      minute: fx.fixture?.status?.elapsed || null,
      homeTeam,
      awayTeam,
      homeGoals: fx.goals?.home ?? null,
      awayGoals: fx.goals?.away ?? null,
      round: fx.league?.round || "",
      isLive,
      isFinished,
      scorers: [],
    };

    if (isLive || isFinished) {
      liveOrFinishedIds.push(fx.fixture.id);
    }
  }

  // Fetch events (goal scorers) for completed/live matches in batches of 20
  const batchSize = 20;
  for (let i = 0; i < liveOrFinishedIds.length; i += batchSize) {
    const batch = liveOrFinishedIds.slice(i, i + batchSize);
    const eventResults = await Promise.all(
      batch.map((id) =>
        apiFetch("/fixtures/events", { fixture: id, type: "Goal" }).catch(
          () => [],
        ),
      ),
    );

    for (let j = 0; j < batch.length; j++) {
      const fixtureId = batch[j];
      const events = eventResults[j] || [];
      const entry = Object.values(matchMap).find(
        (m) => m.fixtureId === fixtureId,
      );
      if (!entry) continue;

      for (const evt of events) {
        if (evt.detail === "Missed Penalty") continue;
        const team = normalizeTeamName(evt.team?.name);
        const player = evt.player?.name;
        if (team && player) {
          entry.scorers.push(`${team}|${player}`);
        }
      }
    }
  }

  // Parse standings → { A: ["Team1","Team2","Team3","Team4"], ... }
  const groupStandings = {};
  if (standingsData?.[0]?.league?.standings) {
    for (const groupArr of standingsData[0].league.standings) {
      if (!groupArr.length) continue;
      const groupLetter = (groupArr[0].group || "")
        .replace("Group ", "")
        .trim();
      if (groupLetter) {
        groupStandings[groupLetter] = groupArr.map((row) =>
          normalizeTeamName(row.team?.name),
        );
      }
    }
  }

  // Extract tournament results from knockout rounds
  const tournamentResults = { winner: null, runnerUp: null, third: null };
  for (const m of Object.values(matchMap)) {
    if (!m.isFinished) continue;
    const round = m.round.toLowerCase();

    if (round.includes("final") && !round.includes("semi") && !round.includes("quarter") && !round.includes("3rd") && !round.includes("third")) {
      if (m.homeGoals > m.awayGoals) {
        tournamentResults.winner = m.homeTeam;
        tournamentResults.runnerUp = m.awayTeam;
      } else if (m.awayGoals > m.homeGoals) {
        tournamentResults.winner = m.awayTeam;
        tournamentResults.runnerUp = m.homeTeam;
      }
    }

    if (round.includes("3rd") || round.includes("third")) {
      if (m.homeGoals > m.awayGoals) {
        tournamentResults.third = m.homeTeam;
      } else if (m.awayGoals > m.homeGoals) {
        tournamentResults.third = m.awayTeam;
      }
    }
  }

  // Top scorers → "Team|Player" for golden boot
  const topScorers = (scorersData || []).map((s) => ({
    team: normalizeTeamName(s.statistics?.[0]?.team?.name),
    player: s.player?.name,
    goals: s.statistics?.[0]?.goals?.total || 0,
    key: `${normalizeTeamName(s.statistics?.[0]?.team?.name)}|${s.player?.name}`,
  }));

  // Tournament-wide stats
  const allFinished = Object.values(matchMap).filter((m) => m.isFinished);
  let totalGoals = 0;
  let groupGoals = 0;
  const teamGoals = {};
  const teamCleanSheets = {};
  let redCards = 0;
  let penaltyShootouts = 0;
  let hatTricks = 0;
  let extraTimeFinalsCount = 0;

  for (const m of allFinished) {
    const hg = m.homeGoals || 0;
    const ag = m.awayGoals || 0;
    totalGoals += hg + ag;

    const isGroup = m.round.toLowerCase().includes("group");
    if (isGroup) groupGoals += hg + ag;

    teamGoals[m.homeTeam] = (teamGoals[m.homeTeam] || 0) + hg;
    teamGoals[m.awayTeam] = (teamGoals[m.awayTeam] || 0) + ag;

    if (ag === 0) teamCleanSheets[m.homeTeam] = (teamCleanSheets[m.homeTeam] || 0) + 1;
    if (hg === 0) teamCleanSheets[m.awayTeam] = (teamCleanSheets[m.awayTeam] || 0) + 1;

    if (m.status === "PEN") penaltyShootouts++;
    if (m.status === "AET" || m.status === "PEN") {
      const round = m.round.toLowerCase();
      if (round.includes("final") || round.includes("semi") || round.includes("3rd") || round.includes("third")) {
        extraTimeFinalsCount++;
      }
    }

    // Count hat-tricks from scorers
    const scorerCounts = {};
    for (const s of m.scorers) {
      scorerCounts[s] = (scorerCounts[s] || 0) + 1;
    }
    for (const count of Object.values(scorerCounts)) {
      if (count >= 3) hatTricks++;
    }
  }

  const topScoringTeam = Object.entries(teamGoals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const mostCleanSheets = Object.entries(teamCleanSheets).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const results = {
    matches: matchMap,
    standings: groupStandings,
    topScorers,
    tournamentResults,
    englandProgress: computeEnglandProgress(matchMap),
    stats: {
      totalGoals,
      groupGoals,
      topScoringTeam,
      mostCleanSheets,
      penaltyShootouts,
      redCards,
      hatTricks,
      extraTimeFinalsCount,
    },
    hasLive: _hasLive,
    fetchedAt: Date.now(),
  };

  setCache("results", results);
  return results;
}
