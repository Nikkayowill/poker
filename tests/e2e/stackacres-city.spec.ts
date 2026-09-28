import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The City's two ways in, walked in the real engine: over the Homestead's west bridge and back, and in through
 * the grocery's front doors on the square and back out. lib/stackacres-td/city-area.test.ts pins the same
 * exits in the map data; this checks the scene actually takes the farmer through them.
 */

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    setClock: (hour: number | null) => void;
    areaName: string;
    pos: { x: number; y: number };
  };
}

type Handle = { __stackacres: TopdownHandle };

async function openFarm(context: BrowserContext, page: Page) {
  const profileResponse = await context.request.post("/api/profile");
  expect(profileResponse.ok()).toBe(true);
  const { profile } = (await profileResponse.json()) as { profile: { id: string } };
  expect((await context.request.post("/api/admin/session", { data: { secret: "playwright-admin-secret" } })).ok()).toBe(true);
  const access = await context.request.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } });
  expect(access.ok()).toBe(true);
  // The first-visit tour would sit over the map; it is its own spec's business.
  expect((await context.request.post("/api/profile/onboarding")).ok()).toBe(true);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: Ray's welcome would show, and no tap here goes near it.
    }
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.setClock(11));
}

async function place(page: Page, area: string, at: { x: number; y: number }) {
  await page.evaluate(({ area, at }) => (window as unknown as Handle).__stackacres.scene.placeFarmer(area, at), { area, at });
  await page.waitForTimeout(300);
}

async function tapMap(page: Page, x: number, y: number) {
  const at = await page.evaluate((p) => (window as unknown as Handle).__stackacres.scene.clientPointFor(p.x, p.y), { x, y });
  await page.mouse.click(at.x, at.y);
}

const area = (page: Page) => page.evaluate(() => (window as unknown as Handle).__stackacres.scene.areaName);

test("the Homestead's west bridge leads to the City, and the road east leads back", async ({ context, page }) => {
  await openFarm(context, page);

  await place(page, "homestead", { x: 56, y: 464 });
  await tapMap(page, 4, 464);
  await expect.poll(() => area(page), { timeout: 10_000 }).toBe("city");
  await expect(page.locator(".sa-place-tag")).toHaveText("The City");

  await tapMap(page, 956, 456);
  await expect.poll(() => area(page), { timeout: 10_000 }).toBe("homestead");
});

test("the grocery's front doors lead in from the square and back out onto it", async ({ context, page }) => {
  await openFarm(context, page);

  await place(page, "city", { x: 494, y: 384 });
  await tapMap(page, 494, 352);
  await expect.poll(() => area(page), { timeout: 10_000 }).toBe("grocery");

  await tapMap(page, 224, 284);
  await expect.poll(() => area(page), { timeout: 10_000 }).toBe("city");
  // Out on the step in front of the doors he went in by, not somewhere else on the map.
  const pos = await page.evaluate(() => ({ ...(window as unknown as Handle).__stackacres.scene.pos }));
  expect(Math.abs(pos.x - 498)).toBeLessThan(32);
  expect(Math.abs(pos.y - 378)).toBeLessThan(32);
});
