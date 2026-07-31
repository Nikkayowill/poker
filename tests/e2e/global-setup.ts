import type { FullConfig } from "@playwright/test";

/**
 * Refuses to run the suite against a database it is not allowed to destroy.
 *
 * This is not a theoretical guard. admin.spec.ts is called "admin uses an
 * HttpOnly session and bulk deletes a filtered profile group", and it does
 * exactly that. multiplayer.spec.ts creates tables and seats players. Pointed
 * at a server holding real credentials -- say, by reusing a `npm run dev`
 * already running with .env.local -- this suite would delete production
 * profiles and it would look like a passing test run while doing it.
 *
 * playwright.config.ts blanks the three Supabase variables so the app falls
 * back to its in-memory store, but that only covers the server *this config*
 * starts. Checking the env would therefore prove nothing about the server
 * actually being tested. So this asks the server itself, over HTTP, which
 * store it is using, and only proceeds if the answer is "memory".
 *
 * When the Supabase-backed project lands it will supply its own expectation
 * (persistence "supabase" against a 127.0.0.1 stack); the point of the check
 * is that a project must state what it expects rather than discover it.
 */
const EXPECTED_PERSISTENCE = "memory";
const TIMEOUT_MS = 60_000;
const POLL_MS = 250;

async function readHealth(baseURL: string): Promise<{ persistence?: string } | null> {
  try {
    const response = await fetch(new URL("/api/health", baseURL), {
      headers: { "Cache-Control": "no-store" },
    });
    // A 503 is a real answer -- "configured for a database I cannot reach" --
    // and its body still names the persistence mode, so it is not retried.
    return (await response.json()) as { persistence?: string };
  } catch {
    return null;
  }
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) throw new Error("No baseURL is configured; cannot verify the target database.");

  const deadline = Date.now() + TIMEOUT_MS;
  let health = await readHealth(baseURL);
  while (!health && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    health = await readHealth(baseURL);
  }

  if (!health) {
    throw new Error(
      `Could not reach ${baseURL}/api/health within ${TIMEOUT_MS / 1000}s, so the target `
      + "database could not be verified. Refusing to run a suite that deletes profiles.",
    );
  }

  if (health.persistence !== EXPECTED_PERSISTENCE) {
    throw new Error(
      [
        "",
        "  REFUSING TO RUN — wrong database.",
        "",
        `  Expected persistence "${EXPECTED_PERSISTENCE}", server at ${baseURL} reports "${health.persistence}".`,
        "",
        "  This suite bulk-deletes profiles and creates tables. Against a real",
        "  Supabase project it would destroy live data and still report green.",
        "",
        "  Most likely cause: it is talking to a `npm run dev` server started",
        "  separately, which loads .env.local and its service-role key. Stop that",
        "  server and let Playwright start its own.",
        "",
      ].join("\n"),
    );
  }
}
