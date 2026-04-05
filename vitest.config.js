import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Only pick up tests under src/ — exclude Playwright E2E (e2e/) and Deno
    // edge function tests (supabase/functions/) which have their own runners.
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    globals: true,
    testTimeout: 15_000,
    // Provide a test API key so isApiFootballConfigured = true in api-football tests.
    // Supabase vars intentionally omitted so supabase.js stays unconfigured by default.
    env: {
      VITE_API_FOOTBALL_KEY: "test-api-key",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.js"],
      exclude: ["src/lib/__tests__/**", "src/lib/__fixtures__/**"],
    },
  },
});
