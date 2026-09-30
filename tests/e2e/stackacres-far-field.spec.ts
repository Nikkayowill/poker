import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The Far Field's way in, walked in the real engine: through the gap in the Homestead's east treeline, across the
 * yard from the City's bridge, and back out over its west edge. lib/stackacres-td/empire-area.test.ts pins the
 * same exits in the map data.
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

/** Whether the Far Field's ground is held in memory. */
const farFieldLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as Handle).__stackacres.scene.textures.exists("ground:empire:0"));

test("the Homestead's east gate leads to the Far Field, and its west edge leads back", async ({ context, page }) => {
  await openFarm(context, page);
  expect(await farFieldLoaded(page)).toBe(false);

  await place(page, "homestead", { x: 976, y: 480 });
  await tapMap(page, 1020, 480);
  await arrived(page, "empire");
  await expect(page.locator(".sa-place-tag")).toHaveText("The Far Field");
  expect(await farFieldLoaded(page)).toBe(true);

  await tapMap(page, 4, 240);
  await arrived(page, "homestead");
  expect(await farFieldLoaded(page)).toBe(false);
  // Back just inside the gate he went out by.
  const pos = await page.evaluate(() => ({ ...(window as unknown as Handle).__stackacres.scene.pos }));
  expect(Math.abs(pos.x - 984)).toBeLessThan(32);
  expect(Math.abs(pos.y - 480)).toBeLessThan(32);
});
