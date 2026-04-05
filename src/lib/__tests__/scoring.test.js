import { describe, it, expect } from "vitest";
import { scoreMatch, scoreGroupStandings, scoreOutrights, scorePredictions } from "../scoring.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal finished result object */
const finishedResult = (homeGoals, awayGoals, scorers = []) => ({
  homeGoals,
  awayGoals,
  isFinished: true,
  isLive: false,
  scorers,
});

const liveResult = (homeGoals, awayGoals, scorers = []) => ({
  homeGoals,
  awayGoals,
  isFinished: false,
  isLive: true,
  scorers,
});

const notStartedResult = () => ({
  homeGoals: null,
  awayGoals: null,
  isFinished: false,
  isLive: false,
  scorers: [],
});

// ─── scoreMatch ──────────────────────────────────────────────────────────────

describe("scoreMatch", () => {
  it("returns 0 points when prediction is null", () => {
    const r = scoreMatch(null, finishedResult(2, 1));
    expect(r.points).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });

  it("returns 0 points when result is null", () => {
    const r = scoreMatch({ home: 2, away: 1 }, null);
    expect(r.points).toBe(0);
  });

  it("returns 0 points when match has not started (null goals)", () => {
    const r = scoreMatch({ home: 1, away: 0 }, notStartedResult());
    expect(r.points).toBe(0);
  });

  it("returns 0 points when match is not finished and not live", () => {
    const r = scoreMatch(
      { home: 1, away: 0 },
      { homeGoals: 1, awayGoals: 0, isFinished: false, isLive: false, scorers: [] },
    );
    expect(r.points).toBe(0);
  });

  it("returns 0 points when prediction scores are empty strings", () => {
    const r = scoreMatch({ home: "", away: "" }, finishedResult(1, 0));
    expect(r.points).toBe(0);
  });

  it("+3 for correct result (home win predicted and actual)", () => {
    const r = scoreMatch({ home: 2, away: 0 }, finishedResult(3, 1));
    expect(r.points).toBe(3);
    expect(r.breakdown).toContainEqual(expect.objectContaining({ label: "Correct result" }));
  });

  it("+3 for correct result (draw)", () => {
    const r = scoreMatch({ home: 1, away: 1 }, finishedResult(0, 0));
    expect(r.points).toBe(3);
  });

  it("+3 for correct result (away win)", () => {
    const r = scoreMatch({ home: 0, away: 2 }, finishedResult(0, 1));
    expect(r.points).toBe(3);
  });

  it("0 points for wrong result", () => {
    const r = scoreMatch({ home: 2, away: 0 }, finishedResult(0, 1));
    expect(r.points).toBe(0);
  });

  it("+8 for exact score (correct result +3 included)", () => {
    const r = scoreMatch({ home: 2, away: 1 }, finishedResult(2, 1));
    expect(r.points).toBe(8); // 3 (correct result) + 5 (exact score)
    expect(r.breakdown.map((b) => b.label)).toContain("Correct result");
    expect(r.breakdown.map((b) => b.label)).toContain("Exact score");
  });

  it("+5 exact score on top of +3 result (draw 0-0)", () => {
    const r = scoreMatch({ home: 0, away: 0 }, finishedResult(0, 0));
    expect(r.points).toBe(8);
  });

  it("+4 for correct anytime scorer", () => {
    // scorer stored as "Team|Player" in the prediction; scorers in result as ["Team|Player"]
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Harry Kane"]),
    );
    expect(r.points).toBe(4 + 3 + 5); // scorer + correct result + exact score = 12
  });

  it("+4 scorer matched despite accent difference (Kane vs Kane)", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Harry Kane"]),
    );
    expect(r.points).toBeGreaterThanOrEqual(4);
  });

  it("0 scorer points when player did not score", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Bukayo Saka"]),
    );
    // correct result + exact score only
    expect(r.points).toBe(8);
  });

  it("0 scorer points when result has no scorers array", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      { ...finishedResult(1, 0), scorers: undefined },
    );
    expect(r.points).toBe(8);
  });

  it("all three correct gives 12 points", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Harry Kane"]),
    );
    expect(r.points).toBe(12);
    expect(r.breakdown).toHaveLength(3);
  });

  it("works with live match (isLive = true)", () => {
    const r = scoreMatch({ home: 1, away: 0 }, liveResult(1, 0));
    expect(r.points).toBe(8);
  });
});

// ─── scoreGroupStandings ─────────────────────────────────────────────────────

describe("scoreGroupStandings", () => {
  it("returns 0 for empty arrays", () => {
    expect(scoreGroupStandings([], []).points).toBe(0);
    expect(scoreGroupStandings(null, null).points).toBe(0);
  });

  it("+6 for correct group winner", () => {
    const r = scoreGroupStandings(["England", "Croatia", "Ghana", "Panama"], ["England", "Ghana", "Croatia", "Panama"]);
    expect(r.points).toBe(6);
    expect(r.breakdown[0].label).toContain("group winner");
  });

  it("+4 for correct runner-up only", () => {
    const r = scoreGroupStandings(["Germany", "France", "Brazil", "Argentina"], ["England", "France", "Croatia", "Ghana"]);
    expect(r.points).toBe(4);
    expect(r.breakdown[0].label).toContain("group runner-up");
  });

  it("+10 for both winner and runner-up correct", () => {
    const r = scoreGroupStandings(["England", "Croatia", "Ghana", "Panama"], ["England", "Croatia", "Panama", "Ghana"]);
    expect(r.points).toBe(10);
    expect(r.breakdown).toHaveLength(2);
  });

  it("0 points for neither position correct", () => {
    const r = scoreGroupStandings(["Brazil", "Germany"], ["England", "France"]);
    expect(r.points).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });

  it("handles shorter arrays gracefully", () => {
    const r = scoreGroupStandings(["England"], ["England", "Croatia"]);
    expect(r.points).toBe(6);
  });
});

// ─── scoreOutrights ──────────────────────────────────────────────────────────

describe("scoreOutrights", () => {
  const baseResults = {
    tournamentResults: { winner: "England", runnerUp: "Germany", third: "France" },
    topScorers: [
      { player: "Erling Haaland", goals: 7, team: "Norway", key: "Norway|Erling Haaland" },
      { player: "Harry Kane", goals: 5, team: "England", key: "England|Harry Kane" },
    ],
    englandProgress: "Winners",
    stats: {
      totalGoals: 140,
      topScoringTeam: "Germany",
    },
  };

  it("returns 0 for null results", () => {
    expect(scoreOutrights({}, null).points).toBe(0);
  });

  it("+15 for correct tournament winner", () => {
    const r = scoreOutrights({ winner: "England" }, baseResults);
    expect(r.points).toBe(15);
  });

  it("+10 for correct runner-up", () => {
    const r = scoreOutrights({ runner_up: "Germany" }, baseResults);
    expect(r.points).toBe(10);
  });

  it("+7 for correct third place", () => {
    const r = scoreOutrights({ third: "France" }, baseResults);
    expect(r.points).toBe(7);
  });

  it("+10 for correct golden boot (top scorer)", () => {
    const r = scoreOutrights({ golden_boot: "Norway|Erling Haaland" }, baseResults);
    expect(r.points).toBe(10);
  });

  it("0 for golden boot prediction that is not the top scorer", () => {
    // Harry Kane has 5 goals, Haaland has 7 — Kane is not the top scorer
    const r = scoreOutrights({ golden_boot: "England|Harry Kane" }, baseResults);
    expect(r.points).toBe(0);
  });

  it("+8 for correct England progress", () => {
    const r = scoreOutrights({ england_progress: "Winners" }, baseResults);
    expect(r.points).toBe(8);
  });

  it("0 for wrong England progress", () => {
    const r = scoreOutrights({ england_progress: "Semi-finals" }, baseResults);
    expect(r.points).toBe(0);
  });

  it("+10 for exact total goals", () => {
    const r = scoreOutrights({ total_goals: 140 }, baseResults);
    expect(r.points).toBe(10);
  });

  it("+5 for total goals within ±3", () => {
    const r = scoreOutrights({ total_goals: 143 }, baseResults);
    expect(r.points).toBe(5);
  });

  it("+5 for total goals within ±3 (under)", () => {
    const r = scoreOutrights({ total_goals: 137 }, baseResults);
    expect(r.points).toBe(5);
  });

  it("0 for total goals more than 3 away", () => {
    const r = scoreOutrights({ total_goals: 144 }, baseResults);
    expect(r.points).toBe(0);
  });

  it("+10 for correct top scoring team", () => {
    const r = scoreOutrights({ top_scoring_team: "Germany" }, baseResults);
    expect(r.points).toBe(10);
  });

  it("0 for wrong top scoring team", () => {
    const r = scoreOutrights({ top_scoring_team: "Brazil" }, baseResults);
    expect(r.points).toBe(0);
  });

  it("golden glove and best young player are NOT scored (documented gap)", () => {
    const r = scoreOutrights(
      { golden_glove: "England|Jordan Pickford", best_young: "England|Jude Bellingham" },
      baseResults,
    );
    expect(r.points).toBe(0);
  });

  it("cumulative score across multiple correct outrights", () => {
    const preds = {
      winner: "England",           // +15
      runner_up: "Germany",        // +10
      golden_boot: "Norway|Erling Haaland", // +10
      england_progress: "Winners", // +8
      total_goals: 140,            // +10
    };
    const r = scoreOutrights(preds, baseResults);
    expect(r.points).toBe(53);
  });
});

// ─── scorePredictions ────────────────────────────────────────────────────────

describe("scorePredictions", () => {
  const buildResults = () => ({
    matches: {
      "Mexico-South Africa": {
        homeGoals: 2,
        awayGoals: 0,
        isFinished: true,
        isLive: false,
        scorers: ["Mexico|Santiago Gimenez"],
      },
      "England-Croatia": {
        homeGoals: 2,
        awayGoals: 1,
        isFinished: true,
        isLive: false,
        scorers: ["England|Harry Kane"],
      },
    },
    standings: {
      A: ["Mexico", "South Korea", "South Africa", "Czech Republic"],
      L: ["England", "Croatia", "Ghana", "Panama"],
    },
    tournamentResults: { winner: "England", runnerUp: "Germany", third: "France" },
    topScorers: [{ player: "Erling Haaland", goals: 7, team: "Norway", key: "Norway|Erling Haaland" }],
    englandProgress: "Winners",
    stats: { totalGoals: 140, topScoringTeam: "Germany" },
  });

  it("returns all-zero object for null preds", () => {
    const r = scorePredictions(null, buildResults());
    expect(r.total).toBe(0);
    expect(r.matchPoints).toBe(0);
    expect(r.standingsPoints).toBe(0);
    expect(r.outrightPoints).toBe(0);
  });

  it("returns all-zero object for null results", () => {
    const r = scorePredictions({ winner: "England" }, null);
    expect(r.total).toBe(0);
  });

  it("aggregates match points correctly", () => {
    const preds = {
      "Mexico-South Africa": { home: 2, away: 0 }, // correct result + exact = 8
      "England-Croatia": { home: 1, away: 0 },      // correct result only = 3
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.matchPoints).toBe(11);
    expect(r.total).toBeGreaterThanOrEqual(11);
  });

  it("aggregates standings points correctly", () => {
    const preds = {
      "standings_A": ["Mexico", "South Korea", "South Africa", "Czech Republic"], // +10
      "standings_L": ["England", "Croatia", "Ghana", "Panama"],                   // +10
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.standingsPoints).toBe(20);
  });

  it("aggregates outright points correctly", () => {
    const preds = {
      winner: "England",       // +15
      england_progress: "Winners", // +8
      total_goals: 140,        // +10
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.outrightPoints).toBe(33);
  });

  it("total equals sum of match + standings + outright points", () => {
    const preds = {
      "Mexico-South Africa": { home: 2, away: 0 }, // 8
      "standings_A": ["Mexico", "South Korea", "South Africa", "Czech Republic"], // 10
      winner: "England", // 15
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.total).toBe(r.matchPoints + r.standingsPoints + r.outrightPoints);
  });

  it("handles predictions with no match keys gracefully", () => {
    const preds = { winner: "England", total_goals: 140 };
    expect(() => scorePredictions(preds, buildResults())).not.toThrow();
  });

  it("ignores match keys that have no result in results.matches", () => {
    const preds = { "Brazil-Argentina": { home: 1, away: 0 } };
    const r = scorePredictions(preds, buildResults());
    expect(r.matchPoints).toBe(0);
  });

  it("breakdown array contains entries from all categories", () => {
    const preds = {
      "Mexico-South Africa": { home: 2, away: 0 },
      "standings_A": ["Mexico", "South Korea", "South Africa", "Czech Republic"],
      winner: "England",
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.breakdown.length).toBeGreaterThan(0);
  });
});
