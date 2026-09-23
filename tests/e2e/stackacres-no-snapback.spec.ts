import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "./fixtures";

/**
 * Harvesting and hoeing on a slow server, where the answers come back in the
 * order the requests went out and each one was read before the next write.
 *
 * Two things used to go wrong. A crop that had ripened on screen since the last
 * answer was still "working" in the list the harvest guess read, so the pull
 * played and the crop stayed in the ground until the server answered. And an
 * answer that was read before a sibling's write painted the whole farm over the
 * screen, so a bed hoed a moment ago flicked back to grass until its own answer
 * put it back.
 */

interface SceneUnit {
  id: string;
  stock: string;
  state: string;
}

interface TopdownHandle {
  scene: {
    units: SceneUnit[];
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    isWalking: () => boolean;
    soilTiles: () => { tx: number; ty: number }[];
  };
}

// Same squares as stackacres-instant-water.spec.ts: out in the Crop Fields,
// with the farmer starting just below BARE_BED.
const CROP_FIELDS_GATE = { x: 456, y: 536 };
const BARE_BED = { x: 456, y: 504 };
const BED_TILE = { tx: -4, ty: 9 };
const ADMIN_SECRET = "playwright-admin-secret";
const LANDSCAPE_PHONE = { width: 844, height: 390 };
/** Long, because every step of this harness is slow on a busy machine and the
 *  checks below need the answers still out while they run. Under the 12s a
 *  single attempt gets (lib/stackacres/action-retry.ts), or the page retries. */
const SERVER_DELAY_MS = 9_000;
/** A tap walks him the last step to the crop first, so a pick gets longer than a
 *  Use press, but still well inside the held answer. */
const BEFORE_ANSWER_MS = 6_000;
/** A carrot's cycle from its first water, plus slack for a slow harness. */
const CARROT_RIPENS_MS = 15_000 + 3_000;

const handle = (page: Page) =>
  page.evaluate(() => {
    const scene = (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene;
    return { units: scene.units.map((u) => ({ id: u.id, stock: u.stock, state: u.state })), beds: scene.soilTiles() };
  });

const farmAction = async (context: BrowserContext, data: Record<string, unknown>) => {
  const response = await context.request.post("/api/stackacres/actions", { data });
  expect(response.ok(), `setup ${String(data.action)}: ${response.status()} ${await response.text()}`).toBe(true);
};

async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };
  expect((await admin.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok()).toBe(true);
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

type Browser = Parameters<Parameters<typeof test>[2]>[0]["browser"];

/** A farmer beside BARE_BED with a carrot seed sown on it, every farm action
 *  from the page held for SERVER_DELAY_MS. */
async function openSlowFarmWithCarrot(browser: Browser) {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: LANDSCAPE_PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  expect((await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
  await admitFarmer(farmerContext, adminContext.request);
  await farmAction(farmerContext, { action: "place-machine", kind: "stew_pot" });
  await farmAction(farmerContext, { action: "buy-seed", crop: "carrot", quantity: 2 });
  await farmAction(farmerContext, { action: "place-soil-tile", tx: BED_TILE.tx, ty: BED_TILE.ty });
  await farmAction(farmerContext, { action: "stock", stock: "carrot", tx: BED_TILE.tx, ty: BED_TILE.ty });
  const state = (await (await farmerContext.request.get("/api/stackacres")).json()) as { units: SceneUnit[] };
  const carrot = state.units.find((u) => u.stock === "carrot");
  expect(carrot, "setup carrot missing").toBeDefined();

  const page = await farmerContext.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await dismissRay(page);

  const answered: string[] = [];
  await page.route("**/api/stackacres/actions", async (route) => {
    const request = route.request();
    await new Promise((resolve) => setTimeout(resolve, SERVER_DELAY_MS));
    const headers = { ...request.headers() };
    delete headers.origin;
    const response = await farmerContext.request.post(request.url(), { headers, data: request.postData() ?? "" });
    answered.push(`${JSON.parse(request.postData() ?? "{}").action}:${response.status()}`);
    await route.fulfill({ response });
  });

  await page.evaluate(
    (gate) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.placeFarmer("homestead", gate),
    CROP_FIELDS_GATE,
  );
  await page.waitForTimeout(300);
  await dismissRay(page);

  const tap = async (at: { x: number; y: number }) => {
    const point = await page.evaluate(
      (p) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.clientPointFor(p.x, p.y),
      at,
    );
    await page.touchscreen.tap(point.x, point.y);
  };
  const tapAndArrive = async (at: { x: number; y: number }) => {
    await tap(at);
    await page.waitForFunction(
      () => !(window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.isWalking(),
      null,
      { timeout: 15_000 },
    );
  };

  const close = async () => {
    for (const open of farmerContext.pages()) await open.unrouteAll({ behavior: "ignoreErrors" });
    await farmerContext.close();
    await adminContext.close();
  };
  return {
    page,
    answered,
    close,
    carrotId: carrot!.id,
    tap,
    tapAndArrive,
    /** Waters the seed from the page, so the last answer the page holds was
     *  written as the crop started growing and says "working", then waits for
     *  it to ripen on the page's own clock. */
    waterAndRipen: async () => {
      await page.locator(".sa-belt-slot").nth(2).click();
      await tapAndArrive(BARE_BED);
      await expect.poll(() => answered.includes("water:200"), { timeout: SERVER_DELAY_MS * 3 }).toBe(true);
      await expect
        .poll(async () => (await handle(page)).units.find((u) => u.id === carrot!.id)?.state, {
          timeout: CARROT_RIPENS_MS,
          intervals: [250],
        })
        .toBe("ready");
      answered.length = 0;
    },
    slots: page.locator(".sa-belt-slot"),
  };
}

test("a crop that ripened on screen leaves the ground the moment it is picked", async ({ browser }) => {
  test.setTimeout(240_000);
  const farm = await openSlowFarmWithCarrot(browser);
  try {
    const { page, answered, slots, carrotId, tap, waterAndRipen } = farm;
    // Ripe by the page's own clock; the last answer the page had said "working".
    await waterAndRipen();

    // The hand, then a tap on the crop: he is already beside it.
    await slots.nth(0).click();
    await tap(BARE_BED);
    await expect
      .poll(async () => (await handle(page)).units.some((u) => u.id === carrotId), { timeout: BEFORE_ANSWER_MS, intervals: [50] })
      .toBe(false);
    expect(answered).toEqual([]);

    await expect.poll(() => answered, { timeout: SERVER_DELAY_MS * 3 }).toEqual(["collect:200"]);
    await page.waitForTimeout(500);
    expect((await handle(page)).units.some((u) => u.id === carrotId)).toBe(false);
  } finally {
    await farm.close();
  }
});

test("a bed hoed while an older answer is still out never flicks back to grass", async ({ browser }) => {
  test.setTimeout(240_000);
  const farm = await openSlowFarmWithCarrot(browser);
  try {
    const { page, answered, slots, tap, waterAndRipen } = farm;
    await waterAndRipen();

    // Pick the carrot: its answer is read on the server before the hoe below
    // is written, so it comes back without the new bed in it.
    const t0 = Date.now();
    const marks: string[] = [];
    const mark = (what: string) => marks.push(`${what} +${Date.now() - t0}ms answered=${answered.join("|")}`);
    await slots.nth(0).click();
    await tap(BARE_BED);
    await expect.poll(async () => (await handle(page)).units.length, { timeout: BEFORE_ANSWER_MS }).toBe(0);
    mark("picked");

    // Then hoe the square beside it.
    const before = (await handle(page)).beds.length;
    await slots.nth(1).click();
    mark("hoe in hand");
    await tap({ x: BARE_BED.x + 16, y: BARE_BED.y });
    mark("tapped");
    await expect
      .poll(async () => (await handle(page)).beds.length, { timeout: BEFORE_ANSWER_MS, intervals: [50] })
      .toBe(before + 1);
    mark("bed shown");
    // The pick's answer is still out, so it has yet to land on this bed.
    expect(answered, marks.join("\n")).toEqual([]);

    // Watch the beds through both answers: never fewer than that.
    let fewest = before + 1;
    while (answered.length < 2) {
      fewest = Math.min(fewest, (await handle(page)).beds.length);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500);
    fewest = Math.min(fewest, (await handle(page)).beds.length);
    expect(answered).toEqual(["collect:200", "place-soil-tile:200"]);
    expect(fewest).toBe(before + 1);
    expect((await handle(page)).beds.length).toBe(before + 1);
  } finally {
    await farm.close();
  }
});

