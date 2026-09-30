import { expect, test, type BrowserContext, type Page } from "./fixtures";

/** Chapters as a player sees them: the Journal chip and Ray's card when a chapter is done.
 *  The sheet itself is tests/e2e/stackacres-journal.spec.ts. */

interface Handle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
  };
}

/** The house is a walk-in interior: tap the building to go through the door,
 *  then tap the kitchen counter inside. See tests/e2e/stackacres-house.spec.ts. */
const HOUSE_DOOR = { x: 481, y: 280 };
const HOUSE_COUNTER = { x: 56, y: 60 };
const WALK_MS = 4_000;

test.use({ viewport: { width: 932, height: 430 } });

async function openStackAcres(context: BrowserContext, page: Page) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string; goldBalance: number } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect((await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok()).toBe(true);
  expect((await context.request.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: 20_000 - profile.goldBalance } })).ok()).toBe(true);
  await page.addInitScript(() => window.localStorage.setItem("sa-ray-welcomed", "1"));
  await enterFarm(page);
}

async function enterFarm(page: Page) {
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  await page.waitForTimeout(1500);
}

async function tapWorld(page: Page, at: { x: number; y: number }) {
  const point = await page.evaluate(
    (target) => (window as unknown as { __stackacres: Handle }).__stackacres.scene.clientPointFor(target.x, target.y),
    at,
  );
  await page.mouse.click(point.x, point.y);
}

async function openHouse(page: Page) {
  await tapWorld(page, HOUSE_DOOR);
  await page.waitForTimeout(WALK_MS);
  await tapWorld(page, HOUSE_COUNTER);
  await page.waitForTimeout(WALK_MS);
  const house = page.getByRole("dialog", { name: "Your House" });
  await expect(house).toBeVisible();
  return house;
}

/** At this viewport height the HUD is in its tight-landscape tier, so the
 *  Journal chip lives behind the "More" drawer instead of sitting inline. */
async function openMore(page: Page) {
  await page.getByRole("button", { name: "More" }).click();
}

test("a new farm shows chapter 1 on the chip, with the Mill's own shortfall", async ({ context, page }) => {
  await openStackAcres(context, page);
  await openMore(page);

  // The chip is a compact badge now (icon + "1/6"), same standing-badge
  // posture as the Forge and Crossbreeding Bed -- the chapter/step detail
  // that used to sit in its own text is in its title and the sheet it opens.
  const chip = page.getByTitle(/^Chapter 1/);
  await expect(chip).toContainText("1/6");
  await expect(chip).toHaveAttribute("title", /Chapter 1/);
  await expect(chip).toHaveAttribute("title", /Bread/);

  await chip.click();
  const sheet = page.getByRole("dialog", { name: "The Journal" });
  await expect(sheet).toBeVisible();
  // The sheet numbers each chapter rather than spelling out "Chapter N" --
  // the word itself only lives in the chip's title, already checked above.
  await expect(sheet.getByRole("heading", { name: "Bread" })).toBeVisible();
  // 20,000 Gold and no Wood, so the line names the thing actually missing.
  await expect(sheet).toContainText("Mill");
  await expect(sheet).toContainText("Wood");
});

test("building the Stew Pot finishes chapter 2 with Ray's card, once", async ({ context, page }) => {
  await openStackAcres(context, page);
  const house = await openHouse(page);

  await house.locator(".sa-kitchen-card", { hasText: "Stew Pot" }).getByRole("button", { name: /Build/ }).click();

  const card = page.getByRole("dialog", { name: "Stew" });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("CHAPTER 2 DONE");
  await expect(card).toContainText("Opens Potato, Carrot and Onion seeds");
  await expect(card).toContainText("Next up, chapter 1: Bread");
  await card.getByRole("button", { name: "Thanks, Ray" }).click();
  await expect(card).toBeHidden();
  await house.getByRole("button", { name: "Close" }).click();

  // Built out of order, so the goal is still the first unfinished chapter.
  await openMore(page);
  await expect(page.getByTitle(/^Chapter 1/)).toContainText("1/6");

  await enterFarm(page);
  await expect(page.getByRole("dialog", { name: "Stew" })).toHaveCount(0);
});
