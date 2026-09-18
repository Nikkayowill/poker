import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Hoe, sow and water one bed back to back on a slow server, and the ground has
 * to answer each press straight away.
 *
 * Every farm request here is held for SERVER_DELAY_MS before it reaches the
 * route. Watering a seed that was sown a moment ago used to paint nothing until
 * the hoe, the sowing and the watering had each come back in turn, because the
 * guess was only made after the sowing landed and by then it was aimed at a
 * crop the render did not know about. The seed itself waited for the hoe the
 * same way.
 */

interface SceneUnit {
  id: string;
  stock: string;
  seed?: boolean;
  state: string;
}

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    isWalking: () => boolean;
    soilTiles: () => unknown[];
  };
}

const OLD_FIELDS_GATE = { x: 352, y: 596 };
const BARE_BED = { x: 352, y: 520 };
/** The bed tile BARE_BED sits on. */
const BED_TILE = { tx: 0, ty: 14 };
const ADMIN_SECRET = "playwright-admin-secret";
const LANDSCAPE_PHONE = { width: 844, height: 390 };
/** Longer than any press below is allowed to take to show up. */
const SERVER_DELAY_MS = 4_000;
const INSTANT_MS = 600;

async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };
  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);
  const topped = await admin.post("/api/admin/gold/adjust", {
    data: { profileId: profile.id, delta: 400_000 - profile.goldBalance },
  });
  expect(topped.ok()).toBe(true);
}

async function dismissRay(page: Page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const welcome = page.locator(".profile-overlay .sa-cta");
    if ((await welcome.count()) === 0) return;
    await welcome.first().click();
    await page.waitForTimeout(300);
  }
}

/** The crops the scene is drawing right now. `units` is private to the scene's
 *  class, not to the page, so it reads fine from here. */
const carrots = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __stackacres: { scene: { units: SceneUnit[] } } }).__stackacres.scene.units.filter(
      (unit) => unit.stock === "carrot",
    ),
  );

type Browser = Parameters<Parameters<typeof test>[2]>[0]["browser"];

const farmAction = async (context: BrowserContext, data: Record<string, unknown>) => {
  const response = await context.request.post("/api/stackacres/actions", { data });
  expect(response.ok(), `setup ${String(data.action)} failed`).toBe(true);
};

/**
 * A farmer with the Crop Fields open and seed in the barn, standing on
 * BARE_BED, with every farm action from the page held for SERVER_DELAY_MS.
 * `before` runs over the API first, un-delayed, for anything the farm should
 * already have when the page opens.
 */
async function openSlowFarm(browser: Browser, before: (context: BrowserContext) => Promise<void> = async () => {}) {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: LANDSCAPE_PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  const unlocked = await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } });
  expect(unlocked.ok()).toBe(true);
  await admitFarmer(farmerContext, adminContext.request);
  for (let bird = 0; bird < 2; bird += 1) await farmAction(farmerContext, { action: "stock", stock: "hen" });
  await farmAction(farmerContext, { action: "unlock-crop-fields" });
  await farmAction(farmerContext, { action: "buy-soil", tier: "dirt", quantity: 4 });
  await farmAction(farmerContext, { action: "buy-seed", crop: "carrot", quantity: 2 });
  await before(farmerContext);

  const page = await farmerContext.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });
  await page.goto("/games/stackacres");
  await page.locator(".sa-play-screen").click({ timeout: 15_000 });
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await dismissRay(page);

  // Only the farm's actions are slowed, and each is sent on from here without
  // the page's Origin, which the harness's 127.0.0.1 would otherwise get 403
  // for (see stackacres-toolbelt-touch.spec.ts).
  const answered: string[] = [];
  await page.route("**/api/stackacres/actions", async (route) => {
    const request = route.request();
    await new Promise((resolve) => setTimeout(resolve, SERVER_DELAY_MS));
    const headers = { ...request.headers() };
    delete headers.origin;
    const response = await farmerContext.request.post(request.url(), {
      headers,
      data: request.postData() ?? "",
    });
    answered.push(`${JSON.parse(request.postData() ?? "{}").action}:${response.status()}`);
    await route.fulfill({ response });
  });

  await page.evaluate(
    (gate) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.placeFarmer("oldfields", gate),
    OLD_FIELDS_GATE,
  );
  await page.waitForTimeout(300);
  const bedPoint = await page.evaluate(
    (bed) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.clientPointFor(bed.x, bed.y),
    BARE_BED,
  );
  await dismissRay(page);
  await page.touchscreen.tap(bedPoint.x, bedPoint.y);
  await page.waitForFunction(
    () => !(window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.isWalking(),
    null,
    { timeout: 15_000 },
  );

  const close = async () => {
    for (const open of farmerContext.pages()) await open.unrouteAll({ behavior: "ignoreErrors" });
    await farmerContext.close();
    await adminContext.close();
  };
  return { page, answered, close, slots: page.locator(".sa-belt-slot"), useKey: page.locator(".sa-use-key") };
}

/** Waits until exactly one carrot matches, and no longer than INSTANT_MS. */
const expectCarrotSoon = (page: Page, match: (unit: SceneUnit) => boolean) =>
  expect
    .poll(async () => (await carrots(page)).filter(match).length, { timeout: INSTANT_MS, intervals: [50] })
    .toBe(1);

test("an established crop watered on a slow server turns the moment the can is used, and stays", async ({
  browser,
}) => {
  // Hoed and sown over the API, so the page opens on a seed that is already a
  // real row on the server: the plain case the original complaint was about.
  const farm = await openSlowFarm(browser, async (context) => {
    await farmAction(context, { action: "place-soil-tile", tx: BED_TILE.tx, ty: BED_TILE.ty, tier: "dirt" });
    await farmAction(context, { action: "stock", stock: "carrot", tx: BED_TILE.tx, ty: BED_TILE.ty });
  });
  try {
    const { page, answered, slots, useKey } = farm;
    const [planted] = await carrots(page);
    expect(planted, "the carrot sown over the API is not on the map").toBeDefined();
    expect(planted.id.startsWith("sa-optimistic")).toBe(false);
    expect(planted.seed).toBe(true);

    await slots.nth(2).click();
    await useKey.click();
    await expectCarrotSoon(page, (unit) => unit.id === planted.id && unit.seed === false);
    expect(answered).toEqual([]);

    // Through the held answer and out the other side, still watered.
    await expect.poll(() => answered, { timeout: SERVER_DELAY_MS * 3 }).toEqual(["water:200"]);
    await page.waitForTimeout(500);
    const settled = await carrots(page);
    expect(settled).toHaveLength(1);
    expect(settled[0].id).toBe(planted.id);
    expect(settled[0].seed).toBe(false);
    expect(settled[0].state).toBe("working");
  } finally {
    await farm.close();
  }
});

test("a bed hoed, sown and watered on a slow server changes the moment each press lands", async ({ browser }) => {
  const farm = await openSlowFarm(browser);
  try {
    const { page, answered, slots, useKey } = farm;

    // Hoe.
    await slots.nth(1).click();
    const beds = await page.evaluate(
      () => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.soilTiles().length,
    );
    await useKey.click();
    await page.waitForFunction(
      (was) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.soilTiles().length > was,
      beds,
      { timeout: INSTANT_MS },
    );

    // Sow, while the hoe is still out.
    await slots.nth(3).click();
    const wheel = page.locator(".sa-seed-wheel");
    await expect(wheel).toBeVisible();
    await wheel.locator(".sa-gel-token").first().click();
    await expect(wheel).toHaveCount(0);
    await useKey.click();
    await expectCarrotSoon(page, (unit) => unit.seed === true);

    // Water it, while the sowing it has to be aimed at is still out.
    await slots.nth(2).click();
    await useKey.click();
    await expectCarrotSoon(page, (unit) => unit.seed === false);
    // The sowing and the watering were both still held when the crop turned.
    // The hoe may have answered by now: clicking through the belt in this
    // harness can take longer than SERVER_DELAY_MS.
    expect(answered.filter((line) => !line.startsWith("place-soil-tile"))).toEqual([]);

    // And it stays watered once they all come back, now under the row the
    // server actually wrote.
    await expect
      .poll(() => answered.length, { timeout: SERVER_DELAY_MS * 5 })
      .toBeGreaterThanOrEqual(3);
    expect(answered).toEqual(
      expect.arrayContaining(["place-soil-tile:200", "stock:200", "water:200"]),
    );
    await page.waitForTimeout(500);
    const settled = await carrots(page);
    expect(settled).toHaveLength(1);
    expect(settled[0].id.startsWith("sa-optimistic")).toBe(false);
    expect(settled[0].seed).toBe(false);
    expect(settled[0].state).toBe("working");
  } finally {
    await farm.close();
  }
});
