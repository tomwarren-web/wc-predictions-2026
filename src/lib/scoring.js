import { matchPlayerName } from "./api-football";

// Points constants — match the RulesScreen display
const PTS = {
  CORRECT_RESULT: 3,
  EXACT_SCORE: 5,
  ANYTIME_SCORER: 3,
  GROUP_POSITION: 3,
  TOURNAMENT_WINNER: 10,
  TOURNAMENT_RUNNER_UP: 10,
  TOURNAMENT_THIRD: 10,
  GOLDEN_BOOT: 10,
  GOLDEN_GLOVE: 10,
  BEST_YOUNG: 10,
  HIGHEST_SCORING_TEAM: 10,
  ENGLAND_PROGRESS: 10,
  STAT_EXACT: 10,
  STAT_WITHIN_3: 10,
};

function awardMatches(actual, prediction) {
  if (!actual || !prediction) return false;
  if (typeof actual === "string") {
    if (actual === prediction) return true;
    const actualPlayer = actual.includes("|") ? actual.split("|").slice(1).join("|") : actual;
    return matchPlayerName(actualPlayer, prediction);
  }
  if (typeof actual === "object") {
    if (typeof actual.key === "string" && awardMatches(actual.key, prediction)) return true;
    if (typeof actual.value === "string" && awardMatches(actual.value, prediction)) return true;
    return matchPlayerName(actual.player || actual.name, prediction);
  }
  return false;
}

/**
 * Score a single match prediction against an actual result.
 */
export function scoreMatch(prediction, result) {
  if (!prediction || !result || result.homeGoals === null || result.awayGoals === null) {
    return { points: 0, breakdown: [] };
  }
  if (!result.isFinished && !result.isLive) {
    return { points: 0, breakdown: [] };
  }

  const predH = Number(prediction.home);
  const predA = Number(prediction.away);
  const actH = result.homeGoals;
  const actA = result.awayGoals;

  if (isNaN(predH) || isNaN(predA)) {
    return { points: 0, breakdown: [] };
  }

  let points = 0;
  const breakdown = [];

  // Correct result (W/D/L)
  const predOutcome = predH > predA ? "H" : predH < predA ? "A" : "D";
  const actOutcome = actH > actA ? "H" : actH < actA ? "A" : "D";

  if (predOutcome === actOutcome) {
    points += PTS.CORRECT_RESULT;
    breakdown.push({ label: "Correct result", pts: PTS.CORRECT_RESULT });
  }

  // Exact score
  if (predH === actH && predA === actA) {
    points += PTS.EXACT_SCORE;
    breakdown.push({ label: "Exact score", pts: PTS.EXACT_SCORE });
  }

  // Anytime scorer
  if (prediction.scorer && result.scorers?.length) {
    const matched = result.scorers.some((s) =>
      matchPlayerName(s.split("|")[1], prediction.scorer),
    );
    if (matched) {
      points += PTS.ANYTIME_SCORER;
      breakdown.push({ label: "Anytime scorer", pts: PTS.ANYTIME_SCORER });
    }
  }

  return { points, breakdown };
}

/**
 * Score group standings predictions for one group.
 */
export function scoreGroupStandings(predicted, actual) {
  if (!predicted?.length || !actual?.length) {
    return { points: 0, breakdown: [] };
  }

  let points = 0;
  const breakdown = [];

  for (let i = 0; i < Math.min(predicted.length, actual.length); i += 1) {
    if (predicted[i] && predicted[i] === actual[i]) {
      points += PTS.GROUP_POSITION;
      breakdown.push({ label: `${predicted[i]} group position ${i + 1}`, pts: PTS.GROUP_POSITION });
    }
  }

  return { points, breakdown };
}

/**
 * Score outright tournament predictions.
 */
export function scoreOutrights(preds, results) {
  if (!results) return { points: 0, breakdown: [] };

  let points = 0;
  const breakdown = [];
  const { tournamentResults, topScorers } = results;

  if (preds.winner && tournamentResults?.winner === preds.winner) {
    points += PTS.TOURNAMENT_WINNER;
    breakdown.push({ label: "Tournament winner", pts: PTS.TOURNAMENT_WINNER });
  }

  if (preds.runner_up && tournamentResults?.runnerUp === preds.runner_up) {
    points += PTS.TOURNAMENT_RUNNER_UP;
    breakdown.push({ label: "Tournament runner-up", pts: PTS.TOURNAMENT_RUNNER_UP });
  }

  if (preds.third && tournamentResults?.third === preds.third) {
    points += PTS.TOURNAMENT_THIRD;
    breakdown.push({ label: "3rd place", pts: PTS.TOURNAMENT_THIRD });
  }

  // Golden Boot — check if predicted player is the tournament top scorer
  if (preds.golden_boot && topScorers?.length) {
    const topGoals = topScorers[0]?.goals;
    const topPlayer = topScorers.find(
      (s) => s.goals === topGoals && matchPlayerName(s.player, preds.golden_boot),
    );
    if (topPlayer) {
      points += PTS.GOLDEN_BOOT;
      breakdown.push({ label: "Golden Boot", pts: PTS.GOLDEN_BOOT });
    }
  }

  const awards = results.awards || {};
  const goldenGlove =
    tournamentResults?.goldenGlove ??
    tournamentResults?.golden_glove ??
    awards.goldenGlove ??
    awards.golden_glove;
  if (preds.golden_glove && awardMatches(goldenGlove, preds.golden_glove)) {
    points += PTS.GOLDEN_GLOVE;
    breakdown.push({ label: "Golden Glove", pts: PTS.GOLDEN_GLOVE });
  }

  const bestYoung =
    tournamentResults?.bestYoung ??
    tournamentResults?.best_young ??
    awards.bestYoung ??
    awards.best_young;
  if (preds.best_young && awardMatches(bestYoung, preds.best_young)) {
    points += PTS.BEST_YOUNG;
    breakdown.push({ label: "Best Young Player", pts: PTS.BEST_YOUNG });
  }

  if (preds.top_scoring_team && results.stats?.topScoringTeam === preds.top_scoring_team) {
    points += PTS.HIGHEST_SCORING_TEAM;
    breakdown.push({ label: "Highest scoring team", pts: PTS.HIGHEST_SCORING_TEAM });
  }

  if (
    preds.england_progress &&
    results.englandProgress &&
    preds.england_progress === results.englandProgress
  ) {
    points += PTS.ENGLAND_PROGRESS;
    breakdown.push({ label: "England progress", pts: PTS.ENGLAND_PROGRESS });
  }

  const actualTotalGoals = results.stats?.totalGoals;
  const predGoals = Number(preds.total_goals);
  if (!isNaN(predGoals) && actualTotalGoals !== null && actualTotalGoals !== undefined) {
    const diff = Math.abs(predGoals - actualTotalGoals);
    if (diff === 0) {
      points += PTS.STAT_EXACT;
      breakdown.push({ label: "Total goals exact", pts: PTS.STAT_EXACT });
    } else if (diff <= 3) {
      points += PTS.STAT_WITHIN_3;
      breakdown.push({ label: "Total goals within ±3", pts: PTS.STAT_WITHIN_3 });
    }
  }

  return { points, breakdown };
}

/**
 * Calculate total score for a full set of predictions against results.
 */
export function scorePredictions(preds, results) {
  if (!preds || !results) {
    return { total: 0, matchPoints: 0, standingsPoints: 0, outrightPoints: 0, statsPoints: 0, breakdown: [] };
  }

  let matchPoints = 0;
  let matchBreakdown = [];

  // Score each match
  for (const [key, result] of Object.entries(results.matches || {})) {
    const pred = preds[key];
    if (!pred) continue;
    const { points, breakdown } = scoreMatch(pred, result);
    matchPoints += points;
    matchBreakdown = matchBreakdown.concat(breakdown);
  }

  // Score group standings
  let standingsPoints = 0;
  let standingsBreakdown = [];
  const groups = "ABCDEFGHIJKL".split("");
  for (const g of groups) {
    const predicted = preds[`standings_${g}`];
    const actual = results.standings?.[g];
    if (!predicted || !actual) continue;
    const { points, breakdown } = scoreGroupStandings(predicted, actual);
    standingsPoints += points;
    standingsBreakdown = standingsBreakdown.concat(breakdown);
  }

  // Score outrights (includes total tournament goals for points + leaderboard tiebreaker)
  const { points: outrightPoints, breakdown: outrightBreakdown } = scoreOutrights(preds, results);

  const total = matchPoints + standingsPoints + outrightPoints;

  return {
    total,
    matchPoints,
    standingsPoints,
    outrightPoints,
    statsPoints: 0,
    breakdown: [
      ...matchBreakdown,
      ...standingsBreakdown,
      ...outrightBreakdown,
    ],
  };
}
