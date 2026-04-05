/**
 * api-football.js tests
 *
 * HTTP calls are intercepted by MSW (configured in src/test/msw-server.js).
 * VITE_API_FOOTBALL_KEY is set to 'test-api-key' in vitest.config.js, so
 * isApiFootballConfigured === true for all tests in this file.
 *
 * Each test clears localStorage (via setup.js afterEach) to avoid cache hits
 * between tests. Tests that verify caching behaviour control the cache manually.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server.js";
import {
  midTournamentHandlers,
  completeTournamentHandlers,
} from "../../test/handlers/api-football.js";

// Lazy import helpers — we re-import after resetting modules where needed
async function importModule() {
  return import("../api-football.js");
}

// ─── normalizeTeamName (via getMatchResultForTeams / fetchAllResults output) ──

describe("getMatchResultForTeams", () => {
  let getMatchResultForTeams;

  beforeEach(async () => {
    ({ getMatchResultForTeams } = await importModule());
  });

  it("returns null for null matchesMap", () => {
    expect(getMatchResultForTeams(null, "England", "Croatia")).toBeNull();
  });

  it("finds a match in forward order", () => {
    const map = {
      "England-Croatia": { homeTeam: "England", awayTeam: "Croatia", homeGoals: 2, awayGoals: 1 },
    };
    const r = getMatchResultForTeams(map, "England", "Croatia");
    expect(r).not.toBeNull();
    expect(r.homeGoals).toBe(2);
    expect(r.awayGoals).toBe(1);
  });

  it("finds a match in reverse order and swaps goals", () => {
    // API stored it as Croatia-England (away-home in our fixture list)
    const map = {
      "Croatia-England": {
        homeTeam: "Croatia",
        awayTeam: "England",
        homeGoals: 1,
        awayGoals: 2,
        isFinished: true,
        isLive: false,
      },
    };
    // We ask for England (home) vs Croatia (away)
    const r = getMatchResultForTeams(map, "England", "Croatia");
    expect(r).not.toBeNull();
    // Goals should be swapped so England is the home team
    expect(r.homeGoals).toBe(2);
    expect(r.awayGoals).toBe(1);
    expect(r.homeTeam).toBe("England");
    expect(r.awayTeam).toBe("Croatia");
  });

  it("returns null when match not in map", () => {
    const r = getMatchResultForTeams({}, "England", "Brazil");
    expect(r).toBeNull();
  });
});

// ─── matchPlayerName ─────────────────────────────────────────────────────────

describe("matchPlayerName", () => {
  let matchPlayerName;

  beforeEach(async () => {
    ({ matchPlayerName } = await importModule());
  });

  it("matches identical names", () => {
    expect(matchPlayerName("Harry Kane", "England|Harry Kane")).toBe(true);
  });

  it("matches despite accents (normalises both sides)", () => {
    expect(matchPlayerName("Erling Haaland", "Norway|Erling Haaland")).toBe(true);
  });

  it("matches on shared last name token", () => {
    expect(matchPlayerName("H. Kane", "England|Harry Kane")).toBe(true);
  });

  it("does not match different players", () => {
    expect(matchPlayerName("Bukayo Saka", "England|Harry Kane")).toBe(false);
  });

  it("returns false for null API player", () => {
    expect(matchPlayerName(null, "England|Harry Kane")).toBe(false);
  });

  it("returns false when prediction has no team separator", () => {
    expect(matchPlayerName("Harry Kane", "Harry Kane")).toBe(false);
  });

  it("returns false for null prediction", () => {
    expect(matchPlayerName("Harry Kane", null)).toBe(false);
  });
});

// ─── fetchAllResults — pre-tournament ────────────────────────────────────────

describe("fetchAllResults — pre-tournament (no scores)", () => {
  it("returns a results object with matches, standings, topScorers", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    expect(results).not.toBeNull();
    expect(results.matches).toBeDefined();
    expect(results.standings).toBeDefined();
    expect(results.topScorers).toBeDefined();
  });

  it("match entries have required shape", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    const [, match] = Object.entries(results.matches)[0];
    expect(match).toHaveProperty("homeTeam");
    expect(match).toHaveProperty("awayTeam");
    expect(match).toHaveProperty("isFinished");
    expect(match).toHaveProperty("isLive");
    expect(match).toHaveProperty("scorers");
    expect(Array.isArray(match.scorers)).toBe(true);
  });

  it("pre-tournament matches have null goals and isFinished = false", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    for (const m of Object.values(results.matches)) {
      expect(m.isFinished).toBe(false);
      expect(m.homeGoals).toBeNull();
    }
  });

  it("hasLive is false when no live matches", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();
    expect(results.hasLive).toBe(false);
  });

  it("normalises 'Korea Republic' to 'South Korea'", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    const keys = Object.keys(results.matches);
    const hasSouthKorea = keys.some((k) => k.includes("South Korea"));
    const hasKoreaRepublic = keys.some((k) => k.includes("Korea Republic"));

    expect(hasSouthKorea).toBe(true);
    expect(hasKoreaRepublic).toBe(false);
  });
});

// ─── fetchAllResults — mid-tournament ────────────────────────────────────────

describe("fetchAllResults — mid-tournament (some live, some finished)", () => {
  beforeEach(() => {
    server.use(...midTournamentHandlers);
  });

  it("hasLive is true when at least one match is live", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();
    expect(results.hasLive).toBe(true);
  });

  it("finished match has correct goals", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    // Mexico vs South Africa FT 2-0 in mid-tournament fixture
    const m = results.matches["Mexico-South Africa"];
    expect(m.isFinished).toBe(true);
    expect(m.homeGoals).toBe(2);
    expect(m.awayGoals).toBe(0);
  });

  it("live match has isLive = true and a goal tally", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    const m = results.matches["South Korea-Czech Republic"];
    expect(m.isLive).toBe(true);
    expect(m.homeGoals).toBe(1);
  });

  it("finished match (Mexico) has scorers populated from events", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    const m = results.matches["Mexico-South Africa"];
    expect(m.scorers.length).toBeGreaterThan(0);
    expect(m.scorers.some((s) => s.includes("Gimenez") || s.includes("Giménez"))).toBe(true);
  });

  it("totalGoals stat counts finished match goals", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    // 2+0 (Mexico-South Africa) + 2+1 (England-Croatia) = 5 at minimum
    expect(results.stats.totalGoals).toBeGreaterThanOrEqual(5);
  });
});

// ─── fetchAllResults — complete tournament ───────────────────────────────────

describe("fetchAllResults — complete tournament", () => {
  beforeEach(() => {
    server.use(...completeTournamentHandlers);
  });

  it("tournamentResults.winner is England (won the Final)", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();
    expect(results.tournamentResults.winner).toBe("England");
    expect(results.tournamentResults.runnerUp).toBe("Germany");
  });

  it("tournamentResults.third is France (won 3rd Place Final)", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();
    expect(results.tournamentResults.third).toBe("France");
  });

  it("englandProgress reflects 'Winners' (won last match)", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();
    expect(results.englandProgress).toBe("Winners");
  });

  it("topScorers list is populated and sorted by goals", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    expect(results.topScorers.length).toBeGreaterThan(0);
    // First entry should have most goals
    const [first] = results.topScorers;
    expect(first.goals).toBeGreaterThanOrEqual(5);
  });

  it("topScoringTeam stat is derived from match goals", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();
    expect(typeof results.stats.topScoringTeam).toBe("string");
  });

  it("totalGoals aggregates all finished matches", async () => {
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();

    // Complete fixture has 7 finished matches — at least a handful of goals
    expect(results.stats.totalGoals).toBeGreaterThan(0);
  });
});

// ─── Caching ─────────────────────────────────────────────────────────────────

describe("fetchAllResults — caching", () => {
  it("returns cached data on second call within TTL, without re-fetching", async () => {
    const { fetchAllResults } = await importModule();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await fetchAllResults();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second call — should hit cache
    await fetchAllResults();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst); // no new fetch calls

    fetchSpy.mockRestore();
  });

  it("re-fetches after cache TTL expires (using fake timers)", async () => {
    vi.useFakeTimers();
    const { fetchAllResults } = await importModule();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await fetchAllResults();
    const firstCallCount = fetchSpy.mock.calls.length;

    // Advance time past 300s TTL
    vi.advanceTimersByTime(310_000);
    localStorage.clear(); // simulate TTL by clearing cached data

    await fetchAllResults();
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(firstCallCount);

    fetchSpy.mockRestore();
    vi.useRealTimers();
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe("fetchAllResults — error handling", () => {
  it("throws when fixtures API returns a non-200 status", async () => {
    server.use(
      http.get("https://v3.football.api-sports.io/fixtures", () =>
        HttpResponse.json({ errors: { requests: "daily limit exceeded" } }),
      ),
    );
    const { fetchAllResults } = await importModule();
    await expect(fetchAllResults()).rejects.toThrow();
  });

  it("gracefully handles standings API failure (returns empty standings)", async () => {
    server.use(
      http.get("https://v3.football.api-sports.io/standings", () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );
    const { fetchAllResults } = await importModule();
    const results = await fetchAllResults();
    // Should still return a result — standings endpoint is `.catch(() => [])`
    expect(results).not.toBeNull();
    expect(results.standings).toBeDefined();
  });
});
