import { expect, test, type BrowserContext, type Page } from "./fixtures";

/**
 * The Town Square keeps hours: the four who buy and sell are out through the day and indoors at night, and a
 * stall nobody is minding says when it opens.
 */

interface TopdownHandle {
  scene: {
    placeFarmer: (area: string, at: { x: number; y: number }) => Promise<void>;
    setClock: (hour: number | null) => void;
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    npcSprites: Map<string, { sprite: { visible: boolean } }>;
    travelling: boolean;
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

const KEEPERS = ["cora", "hank", "iris", "gus"];
const NEIGHBOURS = ["mabel", "priya", "lena", "tomas", "sam", "felix", "ned", "olive", "hugo", "winnie", "tilly"];
const EVERYONE = [...KEEPERS, ...NEIGHBOURS];

const outAndAbout = (page: Page) =>
  page.evaluate((names) => {
    const { npcSprites } = (window as unknown as Handle).__stackacres.scene;
    return names.filter((name) => npcSprites.get(name)?.sprite.visible);
  }, EVERYONE);

async function inTown(page: Page, hour: number) {
  await page.evaluate((h) => (window as unknown as Handle).__stackacres.scene.setClock(h), hour);
  await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.placeFarmer("city", { x: 330, y: 540 }));
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__stackacres.scene.travelling), { timeout: 10_000 }).toBe(false);
  await page.waitForTimeout(500);
}

test("the whole square is out at midday and indoors at night", async ({ context, page }) => {
  await openFarm(context, page);

  await inTown(page, 10);
  expect(await outAndAbout(page)).toEqual(expect.arrayContaining(EVERYONE));

  await inTown(page, 2);
  expect(await outAndAbout(page)).toEqual([]);
});

test("a stall with nobody minding it says when it opens", async ({ context, page }) => {
  await openFarm(context, page);
  await inTown(page, 2);

  // The second stall, Cora's, from the pavement in front of it.
  const at = await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.clientPointFor(318, 470));
  await page.mouse.click(at.x, at.y);
  await expect(page.getByText("Closed. Back at 6 in the morning")).toBeVisible();
});
