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
