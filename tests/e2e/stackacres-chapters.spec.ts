import { expect, test, type BrowserContext, type Page } from "./fixtures";

/** Chapters as a player sees them: the goal chip, the goals sheet and Ray's card when a chapter is done. */

interface Handle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
  };
}

const HOUSE = { x: 120, y: 120 };

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

async function openHouse(page: Page) {
  await page.evaluate((stand) => (window as unknown as { __stackacres: Handle }).__stackacres.scene.placeFarmer("homestead", stand), {
    x: HOUSE.x,
    y: HOUSE.y + 55,
  });
  await page.waitForTimeout(500);
  const point = await page.evaluate(
    (at) => (window as unknown as { __stackacres: Handle }).__stackacres.scene.clientPointFor(at.x, at.y),
    HOUSE,
  );
  await page.mouse.click(point.x, point.y);
  const house = page.getByRole("dialog", { name: "Your house" });
  await expect(house).toBeVisible();
  return house;
}

test("a new farm shows chapter 1 as the goal, and the goals sheet lists all six", async ({ context, page }) => {
  await openStackAcres(context, page);

  const chip = page.locator(".sa-goal");
  await expect(chip).toContainText("Chapter 1");
  await expect(chip).toContainText("Bread");
  await expect(chip).toContainText("Mill");

  await chip.click();
  const sheet = page.getByRole("dialog", { name: "Farm goals" });
  await expect(sheet).toBeVisible();
  for (const title of ["Bread", "Stew", "Fresh Greens", "Feed the Herd", "Jars and Pickles", "Harvest Feast"]) {
    await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
  }
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
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

  // Built out of order, so the goal is still the first unfinished chapter.
  await expect(page.locator(".sa-goal")).toContainText("Chapter 1");

  await enterFarm(page);
  await expect(page.getByRole("dialog", { name: "Stew" })).toHaveCount(0);
});
