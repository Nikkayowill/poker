import { defineConfig, devices } from "@playwright/test";

const port = 3107;

export default defineConfig({
  testDir: "./tests/e2e",
  // Asks the running server which store it is using and aborts unless it is
  // the in-memory one. The env below only controls the server this config
  // starts, so it cannot vouch for a server started any other way -- and this
  // suite deletes profiles. See tests/e2e/global-setup.ts.
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      ADMIN_SECRET: "playwright-admin-secret",
      // Six seats driven over HTTP cannot beat a 15s clock that starts when
      // the hand is dealt, and the margin shrinks every time the suite grows.
      // Timeout behaviour is unit-tested with injected time; see engine.ts.
      RIVER_TURN_TIMEOUT_MS: "120000",
    },
  },
});
