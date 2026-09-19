import { expect, test } from "./fixtures";

/**
 * The player's house and Ray are two separate taps. The house opens the
 * house panel (the kitchen); Ray opens only his own dialogue, never the
 * kitchen. Also checks the barn's Livestock tab shows the locked pens greyed.
 */

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    npcPoint: (name: string) => { x: number; y: number } | null;
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
  };
}

/** Where the house and the barn stand on the Homestead (public/stackacres-td/areas/homestead/area.json). */
const HOUSE = { x: 120, y: 120 };
const BARN = { x: 360, y: 120 };

test.use({ viewport: { width: 932, height: 430 } });

async function openStackAcres(context: import("@playwright/test").BrowserContext, page: import("@playwright/test").Page) {
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

async function tapWorld(page: import("@playwright/test").Page, at: { x: number; y: number }, standAt: { x: number; y: number }) {
  await page.evaluate((stand) => {
    (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.placeFarmer("homestead", stand);
  }, standAt);
  // Read the screen point only once the camera has settled on him.
  await page.waitForTimeout(500);
  const point = await page.evaluate(
    (target) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.clientPointFor(target.x, target.y),
    at,
  );
  await page.mouse.click(point.x, point.y);
}

test("tapping the house opens your house, and tapping Ray never does", async ({ context, page }) => {
  await openStackAcres(context, page);

  await tapWorld(page, HOUSE, { x: HOUSE.x, y: HOUSE.y + 55 });
  const house = page.getByRole("dialog", { name: "Your house" });
  await expect(house).toBeVisible();
  for (const tab of ["Cook", "Eat", "Cellar", "Farm Kitchen"]) {
    await expect(house.getByRole("tab", { name: tab })).toBeVisible();
  }
  await house.getByRole("button", { name: "Close" }).click();
  await expect(house).toBeHidden();

  const ray = await page.evaluate(() =>
    (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.npcPoint("ray"),
  );
  if (!ray) throw new Error("Ray isn't on the Homestead");
  await tapWorld(page, ray, { x: ray.x + 32, y: ray.y + 24 });
  await expect(page.getByRole("dialog", { name: /Ray/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Your house" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Kitchen" })).toHaveCount(0);
});

test("the barn's Livestock tab shows the sheep and cattle pens greyed until their land is cleared", async ({ context, page }) => {
  await openStackAcres(context, page);

  await tapWorld(page, BARN, { x: BARN.x, y: BARN.y + 55 });
  const store = page.getByRole("dialog", { name: "Supply store" });
  await expect(store).toBeVisible();
  await store.getByRole("tab", { name: "Livestock" }).click();

  await expect(store.getByText("Hen Coop")).toBeVisible();
  await expect(store.locator(".sa-locked-pen", { hasText: "Sheep Pen" })).toBeVisible();
  await expect(store.locator(".sa-locked-pen", { hasText: "Cattle Pen" })).toBeVisible();

  await store.getByRole("button", { name: "Unlock The Fold" }).click();
  await expect(page.getByText("Uncleared land")).toBeVisible();
});
