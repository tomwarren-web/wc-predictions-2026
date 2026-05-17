import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../App.jsx";
import {
  ensureProfileFromAuthSession,
  fetchPredictionsRow,
  signInWithPassword,
  updatePassword,
} from "../lib/supabase.js";

const FALLBACK_DEADLINE_MS = Date.parse("2026-06-11T21:00:00.000Z");
const BEFORE_DEADLINE = FALLBACK_DEADLINE_MS - 7 * 24 * 60 * 60 * 1000;

vi.mock("../lib/supabase.js", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
  ensureSupabaseSession: vi.fn().mockResolvedValue({
    user: { id: "user-abc", email: "player@example.com" },
    access_token: "fake-token",
  }),
  fetchPredictionsRow: vi.fn().mockResolvedValue(null),
  fetchAllPredictions: vi.fn().mockResolvedValue([]),
  upsertPredictions: vi.fn().mockResolvedValue({ ok: true }),
  upsertProfile: vi.fn().mockResolvedValue({ ok: true }),
  fetchProfile: vi.fn().mockResolvedValue(null),
  fetchTournamentSettings: vi.fn().mockResolvedValue(null),
  createCheckoutSession: vi.fn().mockResolvedValue({ ok: false, error: "not configured" }),
  checkPaymentStatus: vi.fn().mockResolvedValue({ paid: false }),
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  signUpWithPassword: vi.fn().mockResolvedValue({ ok: false, error: "not configured" }),
  signInWithPassword: vi.fn().mockResolvedValue({ ok: true }),
  requestPasswordReset: vi.fn().mockResolvedValue({ ok: true }),
  updatePassword: vi.fn().mockResolvedValue({ ok: true }),
  ensureProfileFromAuthSession: vi.fn().mockResolvedValue({
    ok: false,
    profile: null,
    error: "profile still syncing",
  }),
}));

vi.mock("../lib/api-football.js", () => ({
  isApiFootballConfigured: false,
  fetchAllResults: vi.fn().mockResolvedValue(null),
  hasLiveMatches: vi.fn().mockReturnValue(false),
  getMatchResultForTeams: vi.fn().mockReturnValue(null),
  matchPlayerName: vi.fn().mockReturnValue(false),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BEFORE_DEADLINE);
  localStorage.clear();
  window.history.pushState({}, "", "/");
  signInWithPassword.mockResolvedValue({ ok: true });
  updatePassword.mockResolvedValue({ ok: true });
  fetchPredictionsRow.mockResolvedValue(null);
  ensureProfileFromAuthSession.mockResolvedValue({
    ok: false,
    profile: null,
    error: "profile still syncing",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sign-in navigation", () => {
  it("redirects to prediction tabs after a successful sign-in even if profile repair is still syncing", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /sign in/i }));
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "player@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /matches/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tab", { name: /standings/i })).toBeInTheDocument();
  });

  it("redirects as soon as auth succeeds even while prediction hydration is still loading", async () => {
    let resolvePredictions;
    fetchPredictionsRow.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolvePredictions = resolve;
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /sign in/i }));
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "player@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /matches/i })).toHaveAttribute("aria-selected", "true");
    });

    resolvePredictions(null);
  });

  it("shows a password reset form from the reset email link and updates the password", async () => {
    window.history.pushState({}, "", "/#access_token=fake-token&type=recovery");

    render(<App />);

    expect(await screen.findByRole("button", { name: /update password/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(updatePassword).toHaveBeenCalledWith("new-secure-password");
      expect(screen.getByRole("tab", { name: /matches/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(window.location.search).not.toContain("reset-password");
    expect(window.location.hash).toBe("");
  });
});
