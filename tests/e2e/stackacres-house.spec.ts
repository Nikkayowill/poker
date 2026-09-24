import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The player's house and Ray are two separate taps. Ray opens only his own
 * dialogue, never the kitchen. Also checks the barn's Livestock tab shows the
 * locked pens greyed.
 *
 * The house, the barn and the workshop are WALK-IN interiors: a tap on the
 * building walks the farmer through its door (scene.ts's `tapAt` treats a tag
 * that matches an exit as a door), and the menu is opened by tapping the
 * counter once inside. Prop coordinates in area.json are centre-x, bottom-y,
 * which is how the outside tap and the inside tap below are worked out.
 */

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    npcPoint: (name: string) => { x: number; y: number } | null;
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    setClock: (hour: number | null) => void;
  };
}

/** The buildings on the Homestead, and the counter inside each one. */
const HOUSE = { door: { x: 481, y: 280 }, counter: { x: 128, y: 75 } };
const BARN = { door: { x: 640, y: 278 }, counter: { x: 280, y: 75 } };
/** Long enough for the walk plus the door dissolve. */
const WALK_MS = 4_000;

test.use({ viewport: { width: 932, height: 430 } });

async function openStackAcres(context: BrowserContext, page: Page) {
  const { profile } = (await (await context.request.post("/api/profile")).json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  expect(
    (await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: the welcome would show, and the test would say so.
    }
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __stackacres?: unknown }).__stackacres));
  // The camera eases onto the farmer after boot; a tap before it lands can miss.
  await page.waitForTimeout(1500);
}

async function tapWorld(page: Page, at: { x: number; y: number }) {
  const point = await page.evaluate(
    (target) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.clientPointFor(target.x, target.y),
    at,
  );
  await page.mouse.click(point.x, point.y);
}

/** Through the door, then up to the counter. */
async function enter(page: Page, building: typeof HOUSE) {
  await tapWorld(page, building.door);
  await page.waitForTimeout(WALK_MS);
  await tapWorld(page, building.counter);
  await page.waitForTimeout(WALK_MS);
}

test("Ray never opens the kitchen, and the counter inside the house does", async ({ context, page }) => {
  await openStackAcres(context, page);

  // Ray, out on the Homestead, opens his own bubble and nothing else. Ray keeps a routine (lib/stackacres-td/npc-schedules.ts): at 8 he is tending the greenhouse, out on the Homestead.
  await page.evaluate(() => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.setClock(8));
  // A frame or two for him to be put where his day has got to.
  await page.waitForTimeout(500);
  const ray = await page.evaluate(() =>
    (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.npcPoint("ray"),
  );
  if (!ray) throw new Error("Ray isn't on the Homestead");
  await tapWorld(page, ray);
  await expect(page.getByRole("dialog", { name: /Ray/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Your House" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Kitchen" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Ray keeps a routine and can be well out on the yard by the time the farmer reaches him
  // (unlike his old fixed spot), which leaves `enter`'s fixed walk budgets too short for
  // whatever ground he happens to have covered getting there. Back at the spawn, `enter`'s
  // timings hold regardless of where the day has Ray standing.
  await page.evaluate(() => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.placeFarmer("homestead", { x: 496, y: 344 }));
  await enter(page, HOUSE);
  const house = page.getByRole("dialog", { name: "Your House" });
  await expect(house).toBeVisible();
  for (const tab of ["Cook", "Eat", "Cellar", "Farm Kitchen"]) {
    await expect(house.getByRole("tab", { name: tab })).toBeVisible();
  }
  await house.getByRole("button", { name: "Close" }).click();
  await expect(house).toBeHidden();
});

test("the barn's Livestock tab shows the sheep and cattle pens greyed until their land is cleared", async ({ context, page }) => {
  await openStackAcres(context, page);

  await enter(page, BARN);
  const store = page.getByRole("dialog", { name: "Supply store" });
  await expect(store).toBeVisible();
  await store.getByRole("tab", { name: "Livestock" }).click();

  await expect(store.getByText("Hen Coop")).toBeVisible();
  await expect(store.locator(".sa-locked-pen", { hasText: "Sheep Pen" })).toBeVisible();
  await expect(store.locator(".sa-locked-pen", { hasText: "Cattle Pen" })).toBeVisible();

  await store.getByRole("button", { name: "Unlock The Fold" }).click();
  await expect(page.getByText("Uncleared land")).toBeVisible();
});
