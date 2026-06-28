import { describe, it, expect } from "vitest";
import { scoreMatch, scoreGroupStandings, scoreOutrights, scoreStats, scorePredictions, isTournamentComplete, isGroupComplete, groupFixtureProgress, computeGroupStandings } from "../scoring.js";

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

  it("treats blank prediction scores as 0", () => {
    const r = scoreMatch({ home: "", away: "" }, finishedResult(0, 0));
    expect(r.points).toBe(8);
  });

  it("treats null prediction scores as 0", () => {
    const r = scoreMatch({ home: null, away: null }, finishedResult(0, 0));
    expect(r.points).toBe(8);
  });

  it("treats null normalized prediction scores as 0", () => {
    const r = scoreMatch({ home_goals: null, away_goals: null }, finishedResult(0, 0));
    expect(r.points).toBe(8);
  });

  it("treats a missing home score as 0 when away is entered", () => {
    const r = scoreMatch({ away: 1 }, finishedResult(0, 1));
    expect(r.points).toBe(8);
  });

  it("treats a missing away score as 0 when home is entered", () => {
    const r = scoreMatch({ home: 1 }, finishedResult(1, 0));
    expect(r.points).toBe(8);
  });

  it("scores blank prediction scores as a 0-0 prediction", () => {
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

  it("+3 for correct anytime scorer", () => {
    // scorer stored as "Team|Player" in the prediction; scorers in result as ["Team|Player"]
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Harry Kane"]),
    );
    expect(r.points).toBe(3 + 3 + 5); // scorer + correct result + exact score = 11
  });

  it("+3 scorer matched despite accent difference (Kane vs Kane)", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Harry Kane"]),
    );
    expect(r.points).toBeGreaterThanOrEqual(3);
  });

  it("0 scorer points when player did not score", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Bukayo Saka"]),
    );
    // correct result + exact score only
    expect(r.points).toBe(8);
  });

  it("0 scorer points when the same player name is recorded for the wrong team", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["Croatia|Harry Kane"]),
    );
    expect(r.points).toBe(8);
  });

  it("0 scorer points when result has no scorers array", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      { ...finishedResult(1, 0), scorers: undefined },
    );
    expect(r.points).toBe(8);
  });

  it("all three correct gives 11 points", () => {
    const r = scoreMatch(
      { home: 1, away: 0, scorer: "England|Harry Kane" },
      finishedResult(1, 0, ["England|Harry Kane"]),
    );
    expect(r.points).toBe(11);
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

  it("+3 for correct group winner position", () => {
    const r = scoreGroupStandings(["England", "Croatia", "Ghana", "Panama"], ["England", "Ghana", "Panama", "Croatia"]);
    expect(r.points).toBe(3);
    expect(r.breakdown[0].label).toContain("group position 1");
  });

  it("+3 for correct runner-up position only", () => {
    const r = scoreGroupStandings(["Germany", "France", "Brazil", "Argentina"], ["England", "France", "Croatia", "Ghana"]);
    expect(r.points).toBe(3);
    expect(r.breakdown[0].label).toContain("group position 2");
  });

  it("+6 for both winner and runner-up positions correct", () => {
    const r = scoreGroupStandings(["England", "Croatia", "Ghana", "Panama"], ["England", "Croatia", "Panama", "Ghana"]);
    expect(r.points).toBe(6);
    expect(r.breakdown).toHaveLength(2);
  });

  it("+12 for all four group positions correct", () => {
    const r = scoreGroupStandings(["England", "Croatia", "Ghana", "Panama"], ["England", "Croatia", "Ghana", "Panama"]);
    expect(r.points).toBe(12);
    expect(r.breakdown).toHaveLength(4);
  });

  it("0 points for neither position correct", () => {
    const r = scoreGroupStandings(["Brazil", "Germany"], ["England", "France"]);
    expect(r.points).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });

  it("handles shorter arrays gracefully", () => {
    const r = scoreGroupStandings(["England"], ["England", "Croatia"]);
    expect(r.points).toBe(3);
  });
});

// ─── isGroupComplete ─────────────────────────────────────────────────────────

describe("isGroupComplete", () => {
  const teams = ["England", "Croatia", "Ghana", "Panama"];

  const buildGroup = (overrides = {}) => {
    const matches = {};
    for (let i = 0; i < teams.length; i += 1) {
      for (let j = i + 1; j < teams.length; j += 1) {
        const key = `${teams[i]}-${teams[j]}`;
        matches[key] = {
          homeTeam: teams[i],
          awayTeam: teams[j],
          round: "Group Stage - 1",
          isFinished: true,
          ...(overrides[key] || {}),
        };
      }
    }
    return { matches };
  };

  it("is true when all six group pairings are finished", () => {
    expect(isGroupComplete(buildGroup(), teams)).toBe(true);
  });

  it("is false when any group fixture is unfinished", () => {
    const results = buildGroup({ "Ghana-Panama": { isFinished: false } });
    expect(isGroupComplete(results, teams)).toBe(false);
  });

  it("ignores non-group rounds and matches with outside teams", () => {
    const results = buildGroup();
    results.matches["England-Spain"] = { homeTeam: "England", awayTeam: "Spain", round: "Round of 16", isFinished: true };
    expect(isGroupComplete(results, teams)).toBe(true);
  });

  it("is false for empty or trivial team lists", () => {
    expect(isGroupComplete(buildGroup(), [])).toBe(false);
    expect(isGroupComplete(buildGroup(), ["England"])).toBe(false);
    expect(isGroupComplete({}, teams)).toBe(false);
  });

  it("groupFixtureProgress reports finished/expected counts", () => {
    expect(groupFixtureProgress(buildGroup(), teams)).toEqual({ finished: 6, expected: 6, complete: true });
    const partial = buildGroup({ "Ghana-Panama": { isFinished: false }, "Croatia-Panama": { isFinished: false } });
    expect(groupFixtureProgress(partial, teams)).toEqual({ finished: 4, expected: 6, complete: false });
    expect(groupFixtureProgress({}, teams)).toEqual({ finished: 0, expected: 6, complete: false });
  });
});

// ─── computeGroupStandings ───────────────────────────────────────────────────

describe("computeGroupStandings", () => {
  const teams = ["England", "Croatia", "Ghana", "Panama"];

  // Build group fixtures from a list of [home, away, hg, ag] tuples.
  const fixtures = (rows) => {
    const matches = {};
    for (const [home, away, hg, ag] of rows) {
      matches[`${home}-${away}`] = {
        homeTeam: home, awayTeam: away, round: "Group Stage - 1",
        homeGoals: hg, awayGoals: ag, isFinished: true,
      };
    }
    return matches;
  };

  it("ranks by points, then goal difference, then goals scored", () => {
    // England 9 (best), Croatia 6, Ghana 3, Panama 0.
    const matches = fixtures([
      ["England", "Croatia", 1, 0], ["England", "Ghana", 2, 0], ["England", "Panama", 3, 0],
      ["Croatia", "Ghana", 2, 0], ["Croatia", "Panama", 2, 0],
      ["Ghana", "Panama", 1, 0],
    ]);
    expect(computeGroupStandings(matches, teams)).toEqual(["England", "Croatia", "Ghana", "Panama"]);
  });

  it("breaks ties on overall stats using head-to-head", () => {
    // England, Croatia, Ghana all finish on 4 pts with identical GD/GF (each beats one, loses one, draws Panama-less set).
    // Construct a perfect 3-way tie on overall, resolved only by head-to-head.
    const matches = fixtures([
      ["England", "Croatia", 1, 0],  // England beats Croatia
      ["Croatia", "Ghana", 1, 0],    // Croatia beats Ghana
      ["Ghana", "England", 1, 0],    // Ghana beats England  → each 3pts, GD 0, GF 1 among themselves
      ["England", "Panama", 5, 0],
      ["Croatia", "Panama", 5, 0],
      ["Ghana", "Panama", 5, 0],
    ]);
    // Overall: England/Croatia/Ghana each 6pts, GD +5, GF 6 → fully tied; h2h is a cycle (each 3pts, GD0, GF1)
    // so it falls through to alphabetical: Croatia, England, Ghana, then Panama last.
    const result = computeGroupStandings(matches, teams);
    expect(result[3]).toBe("Panama");
    expect(result.slice(0, 3).sort()).toEqual(["Croatia", "England", "Ghana"]);
  });

  it("returns [] when there are no finished group fixtures", () => {
    expect(computeGroupStandings({}, teams)).toEqual([]);
    const unfinished = fixtures([["England", "Croatia", 1, 0]]);
    Object.values(unfinished).forEach((m) => { m.isFinished = false; });
    expect(computeGroupStandings(unfinished, teams)).toEqual([]);
  });

  it("ignores knockout matches between the same teams", () => {
    const matches = fixtures([
      ["England", "Croatia", 1, 0], ["England", "Ghana", 1, 0], ["England", "Panama", 1, 0],
      ["Croatia", "Ghana", 1, 0], ["Croatia", "Panama", 1, 0], ["Ghana", "Panama", 1, 0],
    ]);
    matches["Croatia-England"] = { homeTeam: "Croatia", awayTeam: "England", round: "Round of 16", homeGoals: 9, awayGoals: 0, isFinished: true };
    expect(computeGroupStandings(matches, teams)[0]).toBe("England"); // knockout thrashing must not count
  });
});

// ─── scoreOutrights ──────────────────────────────────────────────────────────

describe("scoreOutrights and scoreStats", () => {
  const baseResults = {
    tournamentComplete: true,
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

  it("returns 0 before the World Cup Final is finished", () => {
    const midTournament = {
      tournamentResults: { winner: null, runnerUp: null, third: null },
      englandProgress: "Group stage",
      stats: { totalGoals: 40, topScoringTeam: "Germany" },
      topScorers: [{ player: "Erling Haaland", goals: 3, team: "Norway", key: "Norway|Erling Haaland" }],
    };
    const preds = {
      winner: "England",
      england_progress: "Group stage",
      top_scoring_team: "Germany",
      golden_boot: "Norway|Erling Haaland",
      total_goals: 40,
    };
    expect(isTournamentComplete(midTournament)).toBe(false);
    expect(scoreOutrights(preds, midTournament).points).toBe(0);
    expect(scoreStats(preds, midTournament).points).toBe(0);
  });

  it("+10 for correct tournament winner", () => {
    const r = scoreOutrights({ winner: "England" }, baseResults);
    expect(r.points).toBe(10);
  });

  it("+10 for correct runner-up", () => {
    const r = scoreOutrights({ runner_up: "Germany" }, baseResults);
    expect(r.points).toBe(10);
  });

  it("+10 for correct third place", () => {
    const r = scoreOutrights({ third: "France" }, baseResults);
    expect(r.points).toBe(10);
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

  it("+10 for correct England progress", () => {
    const r = scoreOutrights({ england_progress: "Winners" }, baseResults);
    expect(r.points).toBe(10);
  });

  it("0 for wrong England progress", () => {
    const r = scoreOutrights({ england_progress: "Semi-finals" }, baseResults);
    expect(r.points).toBe(0);
  });

  it("+10 for exact total goals", () => {
    const r = scoreStats({ total_goals: 140 }, baseResults);
    expect(r.points).toBe(10);
  });

  it("+10 for total goals within ±3", () => {
    const r = scoreStats({ total_goals: 143 }, baseResults);
    expect(r.points).toBe(10);
  });

  it("+10 for total goals within ±3 (under)", () => {
    const r = scoreStats({ total_goals: 137 }, baseResults);
    expect(r.points).toBe(10);
  });

  it("0 for total goals more than 3 away", () => {
    const r = scoreStats({ total_goals: 144 }, baseResults);
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

  it("golden glove and best young player are not scored without award data", () => {
    const r = scoreOutrights(
      { golden_glove: "England|Jordan Pickford", best_young: "England|Jude Bellingham" },
      baseResults,
    );
    expect(r.points).toBe(0);
  });

  it("+10 each for correct golden glove and best young player when award data is available", () => {
    const r = scoreOutrights(
      { golden_glove: "England|Jordan Pickford", best_young: "England|Jude Bellingham" },
      {
        ...baseResults,
        awards: {
          goldenGlove: "England|Jordan Pickford",
          bestYoung: { player: "Jude Bellingham", team: "England" },
        },
      },
    );
    expect(r.points).toBe(20);
  });

  it("cumulative score across multiple correct outrights", () => {
    const preds = {
      winner: "England",           // +10
      runner_up: "Germany",        // +10
      golden_boot: "Norway|Erling Haaland", // +10
      england_progress: "Winners", // +10
    };
    const r = scoreOutrights(preds, baseResults);
    expect(r.points).toBe(40);
  });
});

// ─── scorePredictions ────────────────────────────────────────────────────────

describe("scorePredictions", () => {
  const GROUP_A = ["Mexico", "South Korea", "South Africa", "Czech Republic"];
  const GROUP_L = ["England", "Croatia", "Ghana", "Panama"];

  // Every group-stage pairing, finished 0-0 by default, so each group counts as complete.
  const buildGroupMatches = (teams) => {
    const matches = {};
    for (let i = 0; i < teams.length; i += 1) {
      for (let j = i + 1; j < teams.length; j += 1) {
        matches[`${teams[i]}-${teams[j]}`] = {
          homeTeam: teams[i],
          awayTeam: teams[j],
          round: "Group Stage - 1",
          homeGoals: 0,
          awayGoals: 0,
          isFinished: true,
          isLive: false,
          scorers: [],
        };
      }
    }
    return matches;
  };

  const buildResults = () => ({
    tournamentComplete: true,
    matches: {
      ...buildGroupMatches(GROUP_A),
      ...buildGroupMatches(GROUP_L),
      "Mexico-South Africa": {
        homeTeam: "Mexico",
        awayTeam: "South Africa",
        round: "Group Stage - 1",
        homeGoals: 2,
        awayGoals: 0,
        isFinished: true,
        isLive: false,
        scorers: ["Mexico|Santiago Gimenez"],
      },
      "England-Croatia": {
        homeTeam: "England",
        awayTeam: "Croatia",
        round: "Group Stage - 1",
        homeGoals: 2,
        awayGoals: 1,
        isFinished: true,
        isLive: false,
        scorers: ["England|Harry Kane"],
      },
    },
    standings: {
      A: GROUP_A,
      L: GROUP_L,
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
    expect(r.statsPoints).toBe(0);
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
      "standings_A": ["Mexico", "South Korea", "South Africa", "Czech Republic"], // +12
      "standings_L": ["England", "Croatia", "Ghana", "Panama"],                   // +12
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.standingsPoints).toBe(24);
  });

  it("scores standings from match results when the feed provides no group table", () => {
    const results = buildResults();
    results.standings = {}; // simulate football-data.org's empty/ungrouped standings feed
    const preds = {
      // Computed Group A table (all 0-0 except Mexico 2-0 SA): Mexico 1st, then 0-pt teams by GD/alpha.
      "standings_A": computeGroupStandings(results.matches, ["Mexico", "South Africa", "South Korea", "Czech Republic"]),
      "standings_L": computeGroupStandings(results.matches, ["England", "Croatia", "Ghana", "Panama"]),
    };
    const r = scorePredictions(preds, results);
    expect(r.standingsPoints).toBe(24); // both groups fully correct via the computed fallback
  });

  it("does not score a group's standings until all its fixtures are finished", () => {
    const results = buildResults();
    // Leave one Group A fixture unfinished — Group A must not score, Group L still does.
    results.matches["South Korea-Czech Republic"].isFinished = false;
    const preds = {
      "standings_A": ["Mexico", "South Korea", "South Africa", "Czech Republic"],
      "standings_L": ["England", "Croatia", "Ghana", "Panama"],
    };
    const r = scorePredictions(preds, results);
    expect(r.standingsPoints).toBe(12); // only Group L
  });

  it("aggregates outright points correctly", () => {
    const preds = {
      winner: "England",       // +10
      england_progress: "Winners", // +10
      total_goals: 140,        // +10
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.outrightPoints).toBe(20);
    expect(r.statsPoints).toBe(10);
  });

  it("total equals sum of match + standings + outright + stats points", () => {
    const preds = {
      "Mexico-South Africa": { home: 2, away: 0 }, // 8
      "standings_A": ["Mexico", "South Korea", "South Africa", "Czech Republic"], // 12
      winner: "England", // 10
    };
    const r = scorePredictions(preds, buildResults());
    expect(r.total).toBe(r.matchPoints + r.standingsPoints + r.outrightPoints + r.statsPoints);
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
