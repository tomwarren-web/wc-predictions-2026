const ONE_HOUR_MS = 60 * 60 * 1000;

/** Fallback opener (UTC). Override with VITE_FIRST_MATCH_KICKOFF_ISO or live fixtures from the API. */
const FALLBACK_FIRST_KICKOFF_MS = Date.parse("2026-06-11T22:00:00.000Z");

export function getEarliestFixtureKickoffMs(matchesMap) {
  if (!matchesMap || typeof matchesMap !== "object") return null;
  let min = Infinity;
  for (const m of Object.values(matchesMap)) {
    if (m?.date) {
      const t = new Date(m.date).getTime();
      if (!Number.isNaN(t) && t < min) min = t;
    }
  }
  return min === Infinity ? null : min;
}

export function getFirstKickoffMs(results) {
  const envIso = import.meta.env.VITE_FIRST_MATCH_KICKOFF_ISO;
  if (envIso) {
    const t = Date.parse(envIso);
    if (!Number.isNaN(t)) return t;
  }
  const fromFixtures = getEarliestFixtureKickoffMs(results?.matches);
  if (fromFixtures != null) return fromFixtures;
  return FALLBACK_FIRST_KICKOFF_MS;
}

/** Submissions close 1 hour before the first tournament match. */
export function getSubmissionDeadlineMs(results) {
  return getFirstKickoffMs(results) - ONE_HOUR_MS;
}

export function formatDeadlineLocal(deadlineMs) {
  return new Date(deadlineMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Human-readable countdown until deadline; null if time is up. */
export function formatCountdown(msUntil) {
  if (msUntil <= 0) return null;
  const sec = Math.floor(msUntil / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  parts.push(`${h}h`, `${String(m).padStart(2, "0")}m`, `${String(s).padStart(2, "0")}s`);
  return parts.join(" ");
}
