export function parseFootballDataScorers(
  match: any,
  normalizeTeamName: (name: string | null | undefined) => string | null | undefined = (name) => name,
) {
  const scorers: string[] = [];
  for (const goal of match?.goals || []) {
    if (String(goal?.type || "").toUpperCase() === "OWN") continue;
    const team = normalizeTeamName(goal?.team?.name);
    const player = goal?.scorer?.name;
    if (team && player) scorers.push(`${team}|${player}`);
  }
  return scorers;
}

export function deriveGoalsFromEvents(
  match: any,
  homeTeam: string,
  awayTeam: string,
  normalizeTeamName: (name: string | null | undefined) => string | null | undefined = (name) => name,
) {
  let homeGoals = 0;
  let awayGoals = 0;
  let found = false;
  for (const goal of match?.goals || []) {
    if (String(goal?.type || "").toUpperCase() === "OWN") continue;
    const team = normalizeTeamName(goal?.team?.name);
    if (team === homeTeam) {
      homeGoals += 1;
      found = true;
    } else if (team === awayTeam) {
      awayGoals += 1;
      found = true;
    }
  }
  if (!found) return null;
  return { homeGoals, awayGoals, homePenaltyGoals: null, awayPenaltyGoals: null };
}

export function deriveGoalsFromScorers(scorers: string[], homeTeam: string, awayTeam: string) {
  let homeGoals = 0;
  let awayGoals = 0;
  for (const scorer of scorers) {
    const team = scorer.split("|")[0];
    if (team === homeTeam) homeGoals += 1;
    else if (team === awayTeam) awayGoals += 1;
  }
  if (homeGoals === 0 && awayGoals === 0) return null;
  return { homeGoals, awayGoals, homePenaltyGoals: null, awayPenaltyGoals: null };
}
