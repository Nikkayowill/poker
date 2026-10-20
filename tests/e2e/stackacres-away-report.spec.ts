import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * "While you were away", from the outside.
 *
 * The server clock can't be moved from a browser, so the finished Mill is
 * injected into the farm read. The report's own arithmetic is covered in
 * lib/stackacres/away-report.test.ts; this only checks the popup shows on a
 * real return, stays away on a quick one, and closes.
 */

test.use({ viewport: { width: 932, height: 430 } });

const HOUR = 3_600_000;

async function openFarm(context: BrowserContext, page: Page, lastSeenMsAgo: number | null) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);

  await page.addInitScript((ago) => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
      if (ago !== null) window.localStorage.setItem("sa-last-seen", String(Date.now() - ago));
    } catch {
      // Blocked storage: the assertions below would say so.
    }
  }, lastSeenMsAgo);

  await page.route("**/api/stackacres", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as { machines?: unknown[] };
    body.machines = [
      ...(body.machines ?? []),
      {
        id: "e2e-mill",
        kind: "mill",
        status: "working",
        startedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
        readyAt: new Date(Date.now() - HOUR).toISOString(),
        recipeId: "flour",
        unitsProcessing: 1,
        autoFeedDay: null,
        autoFeeds: 0,
        standingRecipe: null,
        kitchenSince: null,
        done: true,
        progress: 1,
        autoFeedsLeft: null,
        canStart: false,
      },
    ];
    await route.fulfill({ response, json: body });
  });

  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
}

test("a player back after hours is told what finished while they were gone", async ({ context, page }) => {
  await openFarm(context, page, 5 * HOUR);
  const dialog = page.getByRole("dialog", { name: "While you were away" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText("about 5 hours");
  await expect(dialog).toContainText("The Feed Grinder finished Flour.");
  await dialog.getByRole("button", { name: "Back to work" }).click();
  await expect(dialog).toBeHidden();
});

test("a quick return gets no report", async ({ context, page }) => {
  await openFarm(context, page, 2 * 60_000);
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);
  await expect(page.getByRole("dialog", { name: "While you were away" })).toHaveCount(0);
});

test("a first visit gets no report", async ({ context, page }) => {
  await openFarm(context, page, null);
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);
  await expect(page.getByRole("dialog", { name: "While you were away" })).toHaveCount(0);
});
