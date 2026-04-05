import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getEarliestFixtureKickoffMs,
  getFirstKickoffMs,
  getSubmissionDeadlineMs,
  formatCountdown,
  formatDeadlineLocal,
} from "../tournament-deadline.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
/** Hardcoded fallback from the module */
const FALLBACK_KICKOFF_MS = Date.parse("2026-06-11T22:00:00.000Z");
const FALLBACK_DEADLINE_MS = FALLBACK_KICKOFF_MS - ONE_HOUR_MS; // 2026-06-11T21:00:00.000Z

beforeEach(() => {
  vi.useFakeTimers();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ─── getEarliestFixtureKickoffMs ─────────────────────────────────────────────

describe("getEarliestFixtureKickoffMs", () => {
  it("returns null for null input", () => {
    expect(getEarliestFixtureKickoffMs(null)).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(getEarliestFixtureKickoffMs({})).toBeNull();
  });

  it("returns the earliest date across all matches", () => {
    const matches = {
      "A-B": { date: "2026-06-15T20:00:00Z" },
      "C-D": { date: "2026-06-11T22:00:00Z" },
      "E-F": { date: "2026-06-20T18:00:00Z" },
    };
    expect(getEarliestFixtureKickoffMs(matches)).toBe(Date.parse("2026-06-11T22:00:00Z"));
  });

  it("skips entries with no date field", () => {
    const matches = {
      "A-B": { date: "2026-06-15T20:00:00Z" },
      "C-D": {},
    };
    expect(getEarliestFixtureKickoffMs(matches)).toBe(Date.parse("2026-06-15T20:00:00Z"));
  });

  it("skips entries with invalid date strings", () => {
    const matches = {
      "A-B": { date: "2026-06-15T20:00:00Z" },
      "C-D": { date: "not-a-date" },
    };
    expect(getEarliestFixtureKickoffMs(matches)).toBe(Date.parse("2026-06-15T20:00:00Z"));
  });
});

// ─── getFirstKickoffMs ───────────────────────────────────────────────────────

describe("getFirstKickoffMs", () => {
  it("uses VITE_FIRST_MATCH_KICKOFF_ISO env var when valid", () => {
    vi.stubEnv("VITE_FIRST_MATCH_KICKOFF_ISO", "2026-06-10T18:00:00.000Z");
    expect(getFirstKickoffMs(null)).toBe(Date.parse("2026-06-10T18:00:00.000Z"));
  });

  it("ignores an invalid VITE_FIRST_MATCH_KICKOFF_ISO and falls through", () => {
    vi.stubEnv("VITE_FIRST_MATCH_KICKOFF_ISO", "not-a-date");
    // Should fall through to fixture dates or fallback
    expect(getFirstKickoffMs(null)).toBe(FALLBACK_KICKOFF_MS);
  });

  it("uses earliest fixture date from results.matches when env not set", () => {
    vi.stubEnv("VITE_FIRST_MATCH_KICKOFF_ISO", "");
    const results = {
      matches: { "Mexico-South Africa": { date: "2026-06-11T22:00:00Z" } },
    };
    expect(getFirstKickoffMs(results)).toBe(Date.parse("2026-06-11T22:00:00Z"));
  });

  it("falls back to hardcoded date when env not set and no results", () => {
    expect(getFirstKickoffMs(null)).toBe(FALLBACK_KICKOFF_MS);
  });

  it("falls back to hardcoded date when results.matches is empty", () => {
    expect(getFirstKickoffMs({ matches: {} })).toBe(FALLBACK_KICKOFF_MS);
  });

  it("env var takes priority over results.matches", () => {
    vi.stubEnv("VITE_FIRST_MATCH_KICKOFF_ISO", "2026-06-09T12:00:00Z");
    const results = {
      matches: { "A-B": { date: "2026-06-11T22:00:00Z" } },
    };
    expect(getFirstKickoffMs(results)).toBe(Date.parse("2026-06-09T12:00:00Z"));
  });
});

// ─── getSubmissionDeadlineMs ─────────────────────────────────────────────────

describe("getSubmissionDeadlineMs", () => {
  it("is exactly one hour before the first kick-off", () => {
    vi.stubEnv("VITE_FIRST_MATCH_KICKOFF_ISO", "2026-06-11T22:00:00.000Z");
    expect(getSubmissionDeadlineMs(null)).toBe(FALLBACK_DEADLINE_MS);
  });

  it("uses fallback when no env or results", () => {
    expect(getSubmissionDeadlineMs(null)).toBe(FALLBACK_DEADLINE_MS);
  });

  it("is one hour before a custom env kickoff", () => {
    const kickoffIso = "2026-06-10T18:00:00.000Z";
    vi.stubEnv("VITE_FIRST_MATCH_KICKOFF_ISO", kickoffIso);
    const expectedDeadline = Date.parse(kickoffIso) - ONE_HOUR_MS;
    expect(getSubmissionDeadlineMs(null)).toBe(expectedDeadline);
  });
});

// ─── submissionClosed boundary (simulating App.jsx behaviour) ────────────────

describe("submissionClosed boundary", () => {
  const deadline = FALLBACK_DEADLINE_MS;

  it("is OPEN when now is 1ms before the deadline", () => {
    vi.setSystemTime(deadline - 1);
    const closed = Date.now() >= deadline;
    expect(closed).toBe(false);
  });

  it("is CLOSED at exactly the deadline", () => {
    vi.setSystemTime(deadline);
    const closed = Date.now() >= deadline;
    expect(closed).toBe(true);
  });

  it("is CLOSED 1ms after the deadline", () => {
    vi.setSystemTime(deadline + 1);
    const closed = Date.now() >= deadline;
    expect(closed).toBe(true);
  });

  it("is OPEN well before the deadline", () => {
    vi.setSystemTime(Date.parse("2026-01-01T00:00:00Z"));
    const closed = Date.now() >= deadline;
    expect(closed).toBe(false);
  });

  it("is CLOSED well after the deadline", () => {
    vi.setSystemTime(Date.parse("2026-07-20T00:00:00Z"));
    const closed = Date.now() >= deadline;
    expect(closed).toBe(true);
  });
});

// ─── formatCountdown ─────────────────────────────────────────────────────────

describe("formatCountdown", () => {
  it("returns null for 0ms", () => {
    expect(formatCountdown(0)).toBeNull();
  });

  it("returns null for negative ms", () => {
    expect(formatCountdown(-5000)).toBeNull();
  });

  it("formats seconds only", () => {
    const r = formatCountdown(45_000); // 45s
    expect(r).toBe("0h 00m 45s");
  });

  it("formats minutes and seconds", () => {
    const r = formatCountdown(2 * 60 * 1000 + 30 * 1000); // 2m 30s
    expect(r).toBe("0h 02m 30s");
  });

  it("formats hours", () => {
    const r = formatCountdown(2 * 60 * 60 * 1000); // 2h
    expect(r).toBe("2h 00m 00s");
  });

  it("formats days, hours, minutes, seconds", () => {
    const ms = 3 * 86400_000 + 4 * 3600_000 + 5 * 60_000 + 6_000;
    const r = formatCountdown(ms);
    expect(r).toBe("3d 4h 05m 06s");
  });

  it("does not show days when less than 1 day", () => {
    const ms = 23 * 3600_000;
    const r = formatCountdown(ms);
    expect(r).not.toContain("d");
  });
});

// ─── formatDeadlineLocal ─────────────────────────────────────────────────────

describe("formatDeadlineLocal", () => {
  it("returns a non-empty string for a valid timestamp", () => {
    const r = formatDeadlineLocal(FALLBACK_DEADLINE_MS);
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(0);
  });

  it("contains the year 2026", () => {
    const r = formatDeadlineLocal(FALLBACK_DEADLINE_MS);
    expect(r).toContain("2026");
  });
});
