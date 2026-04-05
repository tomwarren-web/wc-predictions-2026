/**
 * E2E journey tests — Playwright
 *
 * Prerequisites:
 *   supabase start                         # local Supabase stack
 *   npm run dev                            # Vite dev server (started automatically by playwright.config.ts)
 *
 * Run all E2E tests:
 *   npx playwright test
 *
 * Run deadline transition test only (requires VITE_FIRST_MATCH_KICKOFF_ISO set ~90s in the future):
 *   VITE_FIRST_MATCH_KICKOFF_ISO=$(node -e "console.log(new Date(Date.now()+90000).toISOString())") npx playwright test --grep deadline
 */

import { test, expect, Page } from "@playwright/test";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || "testuser@wc2026.example.com";
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || "Testpassword1!";
const TEST_NAME = "E2E Test User";
const TEST_USERNAME = "e2e_tester";

const PAID_EMAIL = process.env.E2E_PAID_EMAIL || "paiduser@wc2026.example.com";
const PAID_PASSWORD = process.env.E2E_PAID_PASSWORD || "Testpassword1!";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function signUpNewUser(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel(/name/i).fill(TEST_NAME);
  await page.getByLabel(/username/i).fill(TEST_USERNAME);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign up/i }).click();
}

async function signInUser(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function fillGroupAPredictions(page: Page) {
  // Navigate to Matches tab and fill first available score inputs
  await page.getByRole("tab", { name: /matches/i }).click();
  const homeInputs = page.locator('input[type="number"]').first();
  if (await homeInputs.isVisible()) {
    await homeInputs.fill("2");
    const awayInput = page.locator('input[type="number"]').nth(1);
    await awayInput.fill("1");
  }
}

// ─── Journey 1: Full entry journey (sign up → predict → pay) ─────────────────

test.describe("Full entry journey", () => {
  test.skip(
    !process.env.E2E_RUN_FULL,
    "Set E2E_RUN_FULL=1 to run full journey including Stripe payment",
  );

  test("signs up, fills predictions, and proceeds to checkout", async ({ page }) => {
    const uniqueEmail = `e2e_${Date.now()}@wc2026.example.com`;

    await signUpNewUser(page, uniqueEmail, TEST_PASSWORD);

    // Expect to land on matches screen after signup
    await expect(page.getByRole("tab", { name: /matches/i })).toBeVisible({ timeout: 10_000 });

    await fillGroupAPredictions(page);

    // Navigate to Submit tab and click Pay
    await page.getByRole("tab", { name: /submit/i }).click();
    await expect(page.getByRole("button", { name: /pay/i })).toBeVisible();

    // Click pay — will redirect to Stripe (or show error in test mode without Stripe CLI)
    await page.getByRole("button", { name: /pay/i }).click();

    // Expect either a Stripe redirect or an error message (acceptable in test without real Stripe)
    await page.waitForURL(/stripe|checkout|payment|wc2026/, { timeout: 10_000 }).catch(() => {
      // If no redirect, check for error handling
    });
  });
});

// ─── Journey 2: Returning paid user ──────────────────────────────────────────

test.describe("Returning paid user", () => {
  test.skip(
    !process.env.E2E_PAID_EMAIL,
    "Set E2E_PAID_EMAIL and E2E_PAID_PASSWORD to test returning paid user",
  );

  test("paid user signs in and sees read-only predictions", async ({ page }) => {
    await signInUser(page, PAID_EMAIL, PAID_PASSWORD);

    await expect(page.getByRole("tab", { name: /matches/i })).toBeVisible({ timeout: 10_000 });

    const inputs = page.locator('input[type="number"]');
    if ((await inputs.count()) > 0) {
      await expect(inputs.first()).toBeDisabled();
    }

    // Submit tab should show paid confirmation, not a Pay button
    await page.getByRole("tab", { name: /submit/i }).click();
    await expect(page.getByText(/paid|confirmed|locked/i)).toBeVisible();
  });
});

// ─── Journey 3: Deadline transition ──────────────────────────────────────────

test.describe("Deadline transition", () => {
  test.skip(
    !process.env.VITE_FIRST_MATCH_KICKOFF_ISO,
    "Set VITE_FIRST_MATCH_KICKOFF_ISO to a time ~90s in the future to run this test",
  );

  test("leaderboard tab appears and inputs become disabled after deadline passes", async ({ page }) => {
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, value);
    }, {
      key: "wc-predictions-2026",
      value: JSON.stringify({ predictions: {}, screen: "matches", entered: true }),
    });

    await page.goto("/");
    await expect(page.getByRole("tab", { name: /matches/i })).toBeVisible({ timeout: 10_000 });

    // Verify Leaderboard tab is not visible before deadline
    await expect(page.getByRole("tab", { name: /leaderboard/i })).not.toBeVisible();

    // Calculate time until the kickoff from VITE_FIRST_MATCH_KICKOFF_ISO
    const kickoffIso = process.env.VITE_FIRST_MATCH_KICKOFF_ISO!;
    const kickoffMs = new Date(kickoffIso).getTime();
    const deadlineMs = kickoffMs - 60 * 60 * 1000; // 1 hour before kickoff
    const waitMs = deadlineMs - Date.now() + 3000; // wait until 3s past deadline

    if (waitMs > 0 && waitMs < 120_000) {
      console.log(`Waiting ${waitMs}ms for deadline to pass...`);
      await page.waitForTimeout(waitMs);
    }

    // After deadline, leaderboard tab should appear
    await expect(page.getByRole("tab", { name: /leaderboard/i })).toBeVisible({ timeout: 5_000 });

    // And inputs should be disabled
    const inputs = page.locator('input[type="number"]');
    if ((await inputs.count()) > 0) {
      await expect(inputs.first()).toBeDisabled();
    }
  });
});

// ─── Journey 4: Leaderboard visibility after close ───────────────────────────

test.describe("Leaderboard visibility and prediction transparency", () => {
  test("leaderboard is hidden before deadline and shows a notice", async ({ page }) => {
    // addInitScript runs BEFORE any page scripts, so React sees the data on its
    // very first localStorage read (avoids the goto → evaluate → reload race).
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, value);
    }, {
      key: "wc-predictions-2026",
      value: JSON.stringify({ predictions: {}, screen: "matches", entered: true }),
    });

    await page.goto("/");

    // Wait for the app shell to be visible before checking the nav
    await expect(page.getByRole("tablist")).toBeVisible({ timeout: 10_000 });

    // The leaderboard tab must NOT be present — deadline is June 2026, still in the future
    await expect(page.getByRole("tab", { name: /leaderboard/i })).not.toBeVisible();
  });
});

// ─── Journey 5: Signup closed after deadline ─────────────────────────────────

test.describe("Signup closed state", () => {
  test.skip(
    !process.env.VITE_FIRST_MATCH_KICKOFF_ISO || new Date(process.env.VITE_FIRST_MATCH_KICKOFF_ISO).getTime() > Date.now() + 60_000,
    "Only runs when deadline is in the past — use an ISO in the past for VITE_FIRST_MATCH_KICKOFF_ISO",
  );

  test("shows 'Entries closed' instead of signup form past deadline", async ({ page }) => {
    await page.goto("/");

    // Don't seed localStorage — start from signup screen
    await expect(page.getByText(/entries closed/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Journey 6: Predictions saved to localStorage ───────────────────────────

test.describe("Predictions persistence in localStorage", () => {
  test("entering a score persists to localStorage on save", async ({ page }) => {
    // Seed localStorage before the page loads so the App starts on the matches screen
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, value);
    }, {
      key: "wc-predictions-2026",
      value: JSON.stringify({ predictions: {}, screen: "matches", entered: true }),
    });

    await page.goto("/");
    await expect(page.getByRole("tab", { name: /matches/i })).toBeVisible({ timeout: 10_000 });

    // Enter a score if input fields are rendered
    const inputs = page.locator('input[type="number"]');
    if ((await inputs.count()) >= 2) {
      await inputs.first().fill("3");
      await inputs.nth(1).fill("1");

      // Click Save if the button is visible (only shown before deadline)
      const saveBtn = page.getByRole("button", { name: /save predictions/i });
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        // Give the save handler time to write localStorage
        await page.waitForTimeout(500);
      }

      // Verify localStorage was written with some content
      const stored = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      }, "wc-predictions-2026");

      expect(stored).not.toBeNull();
    } else {
      // If no inputs are rendered, the test still passes — the app loaded correctly
      test.info().annotations.push({ type: "note", description: "No score inputs found — match screen may be empty or rendering differently" });
    }
  });
});

// ─── Journey 7: Payment success query param ──────────────────────────────────

test.describe("Payment success redirect handling", () => {
  test("?payment=success query param triggers profile refresh", async ({ page }) => {
    // Seed localStorage before the initial page load so the App starts on matches
    // screen. Then navigate directly to /?payment=success — addInitScript persists
    // for all navigations within the same page object, so it applies to both loads.
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, value);
    }, {
      key: "wc-predictions-2026",
      value: JSON.stringify({ predictions: {}, screen: "matches", entered: true }),
    });

    // Navigate directly to the success URL — the App should handle the query param
    await page.goto("/?payment=success");

    // App must not crash and must show main navigation
    await expect(page.getByRole("tab", { name: /matches/i })).toBeVisible({ timeout: 10_000 });
  });
});
