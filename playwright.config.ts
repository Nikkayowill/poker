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
  /**
   * One worker, and it has to be stated: `fullyParallel: false` only serialises
   * tests *within* a file. Files still run concurrently, one per worker, and
   * the default worker count is half the machine's cores — six here. So the
   * suite was running six spec files at once against a single shared dev
   * server holding all game and profile state in memory, which is exactly the
   * state this config's own comment above says it deletes: `admin.spec.ts`
   * bulk-deletes profiles while other specs are mid-hand, and `quick-play`
   * matches two specs onto one table.
   *
   * The symptom was a rotating cast of failures — five on one run, seven on
   * the next, barely overlapping, most of them dying in under 300ms because
   * their fixture had been deleted rather than because anything they assert
   * was wrong. Serialising costs a few minutes and buys a suite whose result
   * means something.
   */
  workers: 1,
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
      // Both key names, always. Blanking only one would let a developer who
      // has migrated their shell to the other name run the whole E2E suite
      // against a real project.
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
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
