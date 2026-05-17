const ONE_HOUR_MS = 60 * 60 * 1000;

/** Fallback opener (UTC). Override with VITE_FIRST_MATCH_KICKOFF_ISO or live fixtures from the API. */
export const FALLBACK_FIRST_KICKOFF_ISO = "2026-06-11T22:00:00.000Z";
export const FALLBACK_ENTRY_DEADLINE_ISO = "2026-06-11T21:00:00.000Z";
const FALLBACK_FIRST_KICKOFF_MS = Date.parse(FALLBACK_FIRST_KICKOFF_ISO);

function parseIsoMs(value) {
  if (!value || typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function readSetting(settings, camelKey, snakeKey) {
  if (!settings || typeof settings !== "object") return null;
  return settings[camelKey] ?? settings[snakeKey] ?? null;
}

function getConfiguredEntryDeadlineMs(settings) {
  return (
    parseIsoMs(readSetting(settings, "entryDeadlineIso", "entry_deadline_iso")) ??
    parseIsoMs(import.meta.env.VITE_ENTRY_DEADLINE_ISO)
  );
}

function getConfiguredFirstKickoffMs(settings) {
  return (
    parseIsoMs(readSetting(settings, "firstKickoffIso", "first_match_kickoff_iso")) ??
    parseIsoMs(import.meta.env.VITE_FIRST_MATCH_KICKOFF_ISO)
  );
}

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

export function getFirstKickoffMs(results, settings = null) {
  const configuredKickoff = getConfiguredFirstKickoffMs(settings);
  if (configuredKickoff != null) return configuredKickoff;

  const configuredDeadline = getConfiguredEntryDeadlineMs(settings);
  if (configuredDeadline != null) return configuredDeadline + ONE_HOUR_MS;

  const fromFixtures = getEarliestFixtureKickoffMs(results?.matches);
  if (fromFixtures != null) return fromFixtures;
  return FALLBACK_FIRST_KICKOFF_MS;
}

/** Submissions close 1 hour before the first tournament match. */
export function getSubmissionDeadlineMs(results, settings = null) {
  return getConfiguredEntryDeadlineMs(settings) ?? (getFirstKickoffMs(results, settings) - ONE_HOUR_MS);
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
