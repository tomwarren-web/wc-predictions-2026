import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration.
 *
 * Prerequisites for E2E tests:
 *   1. Local Supabase stack running:  supabase start
 *   2. Stripe CLI in test mode (optional, for payment journey):  stripe listen ...
 *   3. Dev server started by Playwright via `webServer` below.
 *
 * Deadline simulation:
 *   Set VITE_FIRST_MATCH_KICKOFF_ISO to a time ~90 seconds in the future so the
 *   deadline-transition test can wait for it to pass in real time:
 *     VITE_FIRST_MATCH_KICKOFF_ISO=<ISO string> npx playwright test
 *
 * Environment variables expected (can be in .env.e2e or passed inline):
 *   VITE_SUPABASE_URL         – local Supabase URL (default: http://localhost:54321)
 *   VITE_SUPABASE_ANON_KEY    – local anon key from supabase start output
 *   VITE_API_FOOTBALL_KEY     – optional; E2E tests do NOT call the live API
 *   E2E_TEST_EMAIL            – test user email (seeded in local DB)
 *   E2E_TEST_PASSWORD         – test user password
 */

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "html",
  timeout: 60_000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "http://localhost:54321",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || "",
      VITE_FIRST_MATCH_KICKOFF_ISO: process.env.VITE_FIRST_MATCH_KICKOFF_ISO || "",
    },
  },
});
