import { expect, test, type BrowserContext, type Page } from "./fixtures";
import { OPENING_CARDS } from "../../lib/stackacres/opening";

/**
 * The opening a new farm gets once (lib/stackacres/opening.ts): black cards, the bus, Ray at the stop,
 * the walk up to the house, and the farmer handed back when Ray says so.
 *
 * Every other spec turns it off (NEXT_PUBLIC_STACKACRES_SKIP_OPENING in playwright.config.ts), so these
 * ask for it in the address with `?opening=1`.
 */

test.use({ viewport: { width: 932, height: 430 } });

const ADMIN_SECRET = "playwright-admin-secret";

async function admitFarmer(context: BrowserContext) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
}

async function openFarm(page: Page) {
  await page.goto("/games/stackacres?opening=1");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 30_000 });
  await expect(page.locator(".sa-opening-cards")).toBeVisible({ timeout: 30_000 });
}

/** A tap on the card. Cards move on by themselves too, so if the last one has gone by the time this lands there is
 *  nothing to tap and nothing to do: dispatched rather than clicked, which would wait on a button that left. */
async function tapCard(page: Page) {
  const cards = page.locator(".sa-opening-cards");
  if ((await cards.count()) > 0) await cards.dispatchEvent("click");
}

/** Taps through every card: the story cards, then the game's name. */
async function throughCards(page: Page) {
  for (let i = 0; i <= OPENING_CARDS.length; i++) await tapCard(page);
}

const farmerAt = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __stackacres: { scene: { farmerPoint: () => { x: number; y: number } } } }).__stackacres.scene.farmerPoint(),
  );

async function farm(page: Page) {
  return (await (await page.request.get("/api/stackacres")).json()) as { openingSeen: boolean; seedStock: Record<string, number> };
}

test("a new farm opens on the bus, and the farmer comes back when Ray says so", async ({ context, page }) => {
  test.setTimeout(240_000);
  await admitFarmer(context);
  expect((await farm(page).catch(() => ({ openingSeen: false }))).openingSeen).toBe(false);
  await openFarm(page);

  // Cards first; a tap moves to the next one.
  await expect(page.locator(".sa-opening-card")).toContainText("Ray worked these acres");
  await tapCard(page);
  await expect(page.locator(".sa-opening-card")).toContainText("letters");
  await tapCard(page);
  await tapCard(page);
  // The last card is the game's name, and it moves on to the scene by itself.
  await expect(page.getByRole("img", { name: "StackAcres" })).toBeVisible();

  // The scene: only the map shows, and Ray talks.
  await expect(page.locator(".sa-opening-scene")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".floor-bar")).toBeHidden();
  await expect(page.locator(".sa-opening-line")).toContainText("Got here in one piece", { timeout: 40_000 });

  // He is only watching: a tap on the map goes nowhere.
  const before = await farmerAt(page);
  await page.mouse.click(700, 300);
  await page.waitForTimeout(600);
  expect(await farmerAt(page)).toEqual(before);

  await expect(page.locator(".sa-opening-line")).toContainText("come find me in the city", { timeout: 90_000 });
  await expect(page.locator(".sa-opening")).toHaveCount(0, { timeout: 15_000 });

  // The farmer is his own again: the header is back, he is by the house and a tap walks him.
  await expect(page.locator(".floor-bar")).toBeVisible();
  const porch = await farmerAt(page);
  expect(Math.hypot(porch.x - 496, porch.y - 344)).toBeLessThan(40);
  await page.mouse.click(300, 300);
  await expect.poll(async () => Math.hypot((await farmerAt(page)).x - porch.x, (await farmerAt(page)).y - porch.y)).toBeGreaterThan(20);

  // Ray's seed pouch went with it, so this farm will not see the opening again.
  const view = await farm(page);
  expect(view.openingSeen).toBe(true);
  expect(view.seedStock.carrot).toBe(3);
});

test("skipping the cards hands over the seeds and goes straight to the farm", async ({ context, page }) => {
  await admitFarmer(context);
  await openFarm(page);
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator(".sa-opening")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".floor-bar")).toBeVisible();
  expect((await farm(page)).openingSeen).toBe(true);
});

test("skipping the scene jumps to the porch with the farmer in hand", async ({ context, page }) => {
  test.setTimeout(120_000);
  await admitFarmer(context);
  await openFarm(page);
  await throughCards(page);
  await expect(page.locator(".sa-opening-line")).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator(".sa-opening")).toHaveCount(0, { timeout: 15_000 });
  const at = await farmerAt(page);
  expect(Math.hypot(at.x - 496, at.y - 344)).toBeLessThan(40);
  const view = await farm(page);
  expect(view.openingSeen).toBe(true);
  expect(view.seedStock.carrot).toBe(3);
});

test("skipping while the bus is still coming in still hands the farmer back at the porch", async ({ context, page }) => {
  test.setTimeout(120_000);
  await admitFarmer(context);
  await openFarm(page);
  await throughCards(page);
  await expect(page.locator(".sa-opening-scene")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.locator(".sa-opening")).toHaveCount(0, { timeout: 15_000 });
  const at = await farmerAt(page);
  expect(Math.hypot(at.x - 496, at.y - 344)).toBeLessThan(40);
  expect((await farm(page)).openingSeen).toBe(true);
});

test("a phone turned over mid-scene ends the opening with the farm in the player's hands", async ({ context, page }) => {
  test.setTimeout(120_000);
  await admitFarmer(context);
  await openFarm(page);
  await throughCards(page);
  await expect(page.locator(".sa-opening-line")).toBeVisible({ timeout: 40_000 });

  // The map is thrown away in portrait and built again on the way back; the scene was on the old one.
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(page.getByText("The farm opens in landscape.")).toBeVisible();
  await page.setViewportSize({ width: 932, height: 430 });

  await expect(page.locator(".sa-opening")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".floor-bar")).toBeVisible();
  expect((await farm(page)).openingSeen).toBe(true);
});
