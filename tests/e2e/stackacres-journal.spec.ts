import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The Journal: the one sheet that answers "what now, and why does it matter",
 * and the land-clearing sheet that has to price its timber the same way.
 *
 * Three blocks. The top line is the reactive one, so it is checked against a
 * farm state the test sets up rather than against a fixed string: a brand new
 * farm with Gold and no Wood has to be told about the Wood, and the same line
 * has to be on the chip without opening anything.
 */

test.use({ viewport: { width: 932, height: 430 } });

async function openStackAcres(context: BrowserContext, page: Page) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as {
    profile: { id: string; goldBalance: number };
  };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  expect(
    (await context.request.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: 20_000 - profile.goldBalance } })).ok(),
  ).toBe(true);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);
}

test("the chip's line and the sheet's line are the same line", async ({ context, page }) => {
  await openStackAcres(context, page);

  const chip = page.locator(".sa-goal");
  const line = (await chip.locator(".sa-goal-line").innerText()).trim();
  expect(line).toContain("Mill");
  expect(line).toContain("Wood");

  await chip.click();
  const sheet = page.getByRole("dialog", { name: "The Journal" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".sa-journal-now-line")).toContainText(line);
});

test("the sheet says what filled up while the player was away", async ({ context, page }) => {
  await openStackAcres(context, page);
  await page.locator(".sa-goal").click();
  const sheet = page.getByRole("dialog", { name: "The Journal" });
  await expect(sheet).toBeVisible();

  // A farm with nothing built still has things regrowing, which is the whole
  // point: the return loop starts on day one, not at the Farm Kitchen.
  const waiting = sheet.locator(".sa-journal-waiting > li");
  await expect(waiting.filter({ hasText: "The trees" })).toContainText("4 of 4 ready");
  await expect(waiting.filter({ hasText: "The bushes" })).toContainText("4 of 4 ready");
  await expect(waiting.filter({ hasText: "The Mine" })).toContainText("of 3 ready");
});

test("the sheet shows both tracks: the buildings and the reach", async ({ context, page }) => {
  await openStackAcres(context, page);
  await page.locator(".sa-goal").click();
  const sheet = page.getByRole("dialog", { name: "The Journal" });
  await expect(sheet).toBeVisible();

  // The production track: all six chapters, and the Mill's real cost, where
  // it goes up, where the Wood comes from and what it opens.
  for (const title of ["Bread", "Stew", "Fresh Greens", "Feed the Herd", "Jars and Pickles", "Harvest Feast"]) {
    await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
  }
  // Chapter 1's first step. Filtering on the word "Mill" would also catch
  // chapter 4's blurb, which starts "Mill corn into cattle feed".
  const mill = sheet.locator(".sa-goals-list > li").first().locator("ul > li").first();
  await expect(mill).toContainText("in the Workshop");
  await expect(mill).toContainText("0 / 15 Wood");
  await expect(mill).toContainText("Chop the trees around the farm");
  await expect(mill).toContainText("Opens Corn and Green Bean seeds");

  // The expansion track, which had no surface at all before this sheet.
  await expect(sheet).toContainText("Standing 1 of 6");
  for (const flag of [
    "Break ground in the Crop Fields",
    "Fill an order for the town",
    "Clear the Fold",
    "Raise the Greenhouse",
    "Clear the Cattle Pasture",
  ]) {
    await expect(sheet.locator(".sa-journal-reach")).toContainText(flag);
  }
  await expect(sheet.locator(".sa-journal-reach")).toContainText("Brings Knight Arthur");
  // Land costs timber now as well as Gold, so the ladder names both.
  await expect(sheet.locator(".sa-journal-reach")).toContainText("45,000 Gold + 30 Wood");
  await expect(sheet.locator(".sa-journal-foot")).toContainText("Chef Pierre");
});

test("clearing land names its timber, and will not offer a clear without it", async ({ context, page }) => {
  await openStackAcres(context, page);

  // The Fold's gate, on the Homestead's eastern edge. Prop coordinates are
  // centre-x, bottom-y (public/stackacres-td/areas/homestead/area.json).
  await page.evaluate(
    () =>
      (
        window as unknown as { __stackacres: { scene: { placeFarmer: (a: string, at: { x: number; y: number }) => void } } }
      ).__stackacres.scene.placeFarmer("homestead", { x: 640, y: 380 }),
  );
  await page.waitForTimeout(600);
  const point = await page.evaluate(
    () =>
      (
        window as unknown as { __stackacres: { scene: { clientPointFor: (x: number, y: number) => { x: number; y: number } } } }
      ).__stackacres.scene.clientPointFor(660, 350),
  );
  await page.mouse.click(point.x, point.y);

  const sheet = page.getByRole("dialog", { name: /Clear The Fold/ });
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(sheet.locator(".sa-clear-materials")).toContainText("0 / 30 Wood");
  await expect(sheet.locator(".sa-clear-materials")).toContainText("Chop the trees around the farm");
  // No timber, so no button -- the sheet never offers a clear the route
  // would then refuse.
  await expect(sheet.getByRole("button", { name: "Not yet" })).toBeDisabled();
});
