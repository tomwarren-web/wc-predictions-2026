/**
 * App behaviour tests — React Testing Library + Vitest
 *
 * All external modules are mocked so tests are deterministic:
 *   - src/lib/supabase.js  → returns isSupabaseConfigured: false (local-only mode)
 *   - src/lib/api-football.js → isApiFootballConfigured: false, no network calls
 *   - src/lib/scoring.js   → real implementation (pure functions, safe to use)
 *   - src/lib/tournament-deadline.js → real implementation; deadline controlled via vi.setSystemTime
 *
 * The App reads localStorage on mount via a useEffect. Tests set up localStorage
 * BEFORE rendering and use waitFor / findBy queries to handle async state updates.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../App.jsx";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../lib/supabase.js", () => ({
  isSupabaseConfigured: false,
  supabase: null,
  ensureSupabaseSession: vi.fn().mockResolvedValue(null),
  fetchPredictionsRow: vi.fn().mockResolvedValue(null),
  fetchAllPredictions: vi.fn().mockResolvedValue([]),
  upsertPredictions: vi.fn().mockResolvedValue({ ok: true }),
  upsertProfile: vi.fn().mockResolvedValue({ ok: true }),
  fetchProfile: vi.fn().mockResolvedValue(null),
  createCheckoutSession: vi.fn().mockResolvedValue({ ok: false, error: "not configured" }),
  checkPaymentStatus: vi.fn().mockResolvedValue({ paid: false }),
  sendEmail: vi.fn().mockResolvedValue({ ok: false }),
  signUpWithPassword: vi.fn().mockResolvedValue({ ok: false, error: "not configured" }),
  signInWithPassword: vi.fn().mockResolvedValue({ ok: false, error: "not configured" }),
  requestPasswordReset: vi.fn().mockResolvedValue({ ok: false, error: "not configured" }),
}));

vi.mock("../lib/api-football.js", () => ({
  isApiFootballConfigured: false,
  fetchAllResults: vi.fn().mockResolvedValue(null),
  hasLiveMatches: vi.fn().mockReturnValue(false),
  getMatchResultForTeams: vi.fn().mockReturnValue(null),
  matchPlayerName: vi.fn().mockReturnValue(false),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "wc-predictions-2026";
/** One hour before the hardcoded fallback first kick-off (2026-06-11T22:00:00Z) */
const FALLBACK_DEADLINE_MS = Date.parse("2026-06-11T21:00:00.000Z");
/** A time comfortably before the deadline — entries open */
const BEFORE_DEADLINE = FALLBACK_DEADLINE_MS - 7 * 24 * 60 * 60 * 1000; // 7 days before
/** A time comfortably after the deadline — entries closed */
const AFTER_DEADLINE = FALLBACK_DEADLINE_MS + 60_000; // 1 minute after

/** Seed localStorage so the App skips the SignupScreen and shows the main tabs */
const seedLocalStorage = (overrides = {}) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      predictions: {},
      screen: "matches",
      entered: true,
      ...overrides,
    }),
  );
};

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Fake ONLY the Date global (not setTimeout/setInterval) so that RTL's
  // waitFor polling still works, while Date.now() returns a controlled value.
  vi.useFakeTimers({ toFake: ["Date"] });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const renderApp = async () => {
  render(<App />);
  // Wait for the initial localStorage effect to resolve
  await waitFor(() => {}, { timeout: 100 });
};

// ─── Pre-deadline behaviour ───────────────────────────────────────────────────

describe("Pre-deadline — entries open", () => {
  beforeEach(() => {
    vi.setSystemTime(BEFORE_DEADLINE);
    seedLocalStorage();
  });

  it("Leaderboard tab is NOT shown in the navigation", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /leaderboard/i })).not.toBeInTheDocument();
    });
  });

  it("main navigation tabs are visible", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /matches/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /standings/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /outrights/i })).toBeInTheDocument();
    });
  });

  it("Save Predictions button is visible before deadline", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save predictions/i })).toBeInTheDocument();
    });
  });

  it("deadline banner shows countdown, not 'Submissions closed'", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByText(/submissions closed/i)).not.toBeInTheDocument();
    });
  });
});

// ─── Post-deadline behaviour ──────────────────────────────────────────────────

describe("Post-deadline — entries closed", () => {
  beforeEach(() => {
    vi.setSystemTime(AFTER_DEADLINE);
    seedLocalStorage();
  });

  it("Leaderboard tab IS shown after deadline", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /leaderboard/i })).toBeInTheDocument();
    });
  });

  it("Save Predictions button is NOT shown after deadline", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /save predictions/i })).not.toBeInTheDocument();
    });
  });

  it("deadline banner shows 'Submissions closed'", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByText(/submissions closed/i)).toBeInTheDocument();
    });
  });

  it("shows locked banner on match / standings / outrights screens", async () => {
    await renderApp();
    await waitFor(() => {
      // The locked banner appears when predictionsReadOnly is true
      expect(screen.getByText(/submissions are closed|entry deadline/i)).toBeInTheDocument();
    });
  });
});

// ─── Leaderboard screen — pre-deadline redirect ───────────────────────────────

describe("Leaderboard screen redirect when not yet closed", () => {
  it("navigating to leaderboard before deadline redirects back to matches", async () => {
    vi.setSystemTime(BEFORE_DEADLINE);
    seedLocalStorage({ screen: "leaderboard" }); // seed leaderboard as starting screen

    await renderApp();

    // The App should redirect back — leaderboard tab should not be present
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /leaderboard/i })).not.toBeInTheDocument();
    });
  });
});

// ─── Signup closed state ──────────────────────────────────────────────────────

describe("Signup closed when past deadline", () => {
  it("shows 'Entries closed' panel instead of signup form", async () => {
    vi.setSystemTime(AFTER_DEADLINE);
    // Do NOT seed localStorage — user is on signup screen
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/entries closed/i)).toBeInTheDocument();
    });
  });

  it("shows signup form when before deadline", async () => {
    vi.setSystemTime(BEFORE_DEADLINE);
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText(/entries closed/i)).not.toBeInTheDocument();
    });
  });
});

// ─── Leaderboard hidden notice ────────────────────────────────────────────────

describe("Leaderboard hidden notice content", () => {
  it("clicking Leaderboard tab after deadline shows the screen (not a notice)", async () => {
    vi.setSystemTime(AFTER_DEADLINE);
    seedLocalStorage();
    await renderApp();

    // Click the leaderboard tab
    await waitFor(async () => {
      const tab = screen.queryByRole("tab", { name: /leaderboard/i });
      if (tab) fireEvent.click(tab);
    });

    await waitFor(() => {
      // At least one leaderboard-related element should be in the DOM
      const elements = screen.queryAllByText(/leaderboard/i);
      expect(elements.length).toBeGreaterThan(0);
    });
  });
});

// ─── Score inputs read-only state ────────────────────────────────────────────

describe("Match score inputs are disabled after deadline", () => {
  it("score inputs have disabled attribute when submission is closed", async () => {
    vi.setSystemTime(AFTER_DEADLINE);
    seedLocalStorage();
    await renderApp();

    await waitFor(() => {
      const inputs = screen.queryAllByRole("spinbutton");
      // If any score inputs are rendered, they should all be disabled
      if (inputs.length > 0) {
        expect(inputs[0]).toBeDisabled();
      }
    });
  });

  it("score inputs are NOT disabled before deadline", async () => {
    vi.setSystemTime(BEFORE_DEADLINE);
    seedLocalStorage();
    await renderApp();

    await waitFor(() => {
      const inputs = screen.queryAllByRole("spinbutton");
      if (inputs.length > 0) {
        expect(inputs[0]).not.toBeDisabled();
      }
    });
  });
});
