import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The City's two ways in, walked in the real engine: over the Homestead's west bridge and back, and in through
 * the grocery's front doors on the square and back out. lib/stackacres-td/city-area.test.ts pins the same
 * exits in the map data; this checks the scene actually takes the farmer through them.
 */

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
    setClock: (hour: number | null) => void;
    areaName: string;
    travelling: boolean;
    pos: { x: number; y: number };
    textures: { exists: (key: string) => boolean };
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

/** Waits until he's in `name` and the door's dissolve is over, since taps are ignored until then. */
async function arrived(page: Page, name: string) {
  const settled = () =>
    page.evaluate(() => {
      const { scene } = (window as unknown as Handle).__stackacres;
      return scene.travelling ? "" : scene.areaName;
    });
  await expect.poll(settled, { timeout: 10_000 }).toBe(name);
}

/** Whether the City's ground and one of its townsfolk are held in memory. */
const cityLoaded = (page: Page) =>
  page.evaluate(() => {
    const { textures } = (window as unknown as Handle).__stackacres.scene;
    return textures.exists("ground:city:0") && textures.exists("mabel");
  });

test("the Homestead's west bridge leads to the City, and the road east leads back", async ({ context, page }) => {
  await openFarm(context, page);
  // The City's pictures load on the way in and go on the way out, rather than with the game.
  expect(await cityLoaded(page)).toBe(false);

  await place(page, "homestead", { x: 56, y: 464 });
  await tapMap(page, 4, 464);
  await arrived(page, "city");
  await expect(page.locator(".sa-place-tag")).toHaveText("The City");
  expect(await cityLoaded(page)).toBe(true);

  await tapMap(page, 956, 456);
  await arrived(page, "homestead");
  expect(await cityLoaded(page)).toBe(false);
});

test("the grocery's front doors lead in from the square and back out onto it", async ({ context, page }) => {
  await openFarm(context, page);

  await place(page, "city", { x: 494, y: 384 });
  await tapMap(page, 494, 352);
  await arrived(page, "grocery");

  await tapMap(page, 224, 284);
  await arrived(page, "city");
  // Out on the step in front of the doors he went in by, not somewhere else on the map.
  const pos = await page.evaluate(() => ({ ...(window as unknown as Handle).__stackacres.scene.pos }));
  expect(Math.abs(pos.x - 498)).toBeLessThan(32);
  expect(Math.abs(pos.y - 378)).toBeLessThan(32);
});
