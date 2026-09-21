import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "./fixtures";

/**
 * The tool belt and the free camera under a thumb, on a phone held sideways.
 *
 * WHY THIS EXISTS AS AN E2E. Everything here is the browser's own gesture
 * plumbing: pointer capture on a canvas, `touch-action`, a two-finger pinch, and
 * a key held down while another thumb walks. None of it is visible to `tsc`,
 * `eslint` or a jsdom test -- jsdom has no layout at all, so the drag arithmetic
 * there would be comparing zeroes. What the belt DECIDES is held to its values
 * in lib/stackacres/toolbelt.test.ts and the camera's arithmetic in
 * lib/stackacres-td/camera.test.ts; this spec answers what neither can: with real
 * fingers, does a drag pan instead of walking, does a pinch land back on a
 * whole-number zoom, and does the seed wheel pick a crop on a plain tap.
 *
 * It replaced stackacres-gel-dock-touch.spec.ts, which drove the drag-a-token-
 * into-a-circle gesture the belt removed.
 */

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    isWalking: () => boolean;
    cameraState: () => { zoom: number; following: boolean; centre: { x: number; y: number } };
  };
}

/** The Old Fields' south gate, and a bare bed square just inside the fence above it. */
const OLD_FIELDS_GATE = { x: 352, y: 596 };
const BARE_BED = { x: 352, y: 520 };

const ADMIN_SECRET = "playwright-admin-secret";
/** A phone held sideways: short, wide, and the shape the farm is played in. */
const LANDSCAPE_PHONE = { width: 844, height: 390 };

async function admitFarmer(context: BrowserContext, admin: APIRequestContext, gold: number) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };
  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) {
    const topped = await admin.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta } });
    expect(topped.ok()).toBe(true);
  }
  return profile.id;
}

/** Ray's welcome gates every canvas tap while it is up, and a snapshot refetch
 *  can bring it straight back after it is dismissed -- so this runs immediately
 *  before whichever tap matters, not once on load. */
async function dismissRay(page: Page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const welcome = page.locator(".profile-overlay .sa-cta");
    if ((await welcome.count()) === 0) return;
    await welcome.first().click();
    await page.waitForTimeout(300);
  }
}

/**
 * The one console error this suite tolerates, and only until the Playwright
 * config stops serving 127.0.0.1.
 *
 * `lib/server/request-origin.ts` refuses a POST whose Origin is not one it
 * knows, and the config's `http://127.0.0.1` is not, so every action sent from
 * inside the page is answered 403 here. It is the harness, not the farm: the
 * same action sent over `context.request` (no Origin header) is accepted, which
 * is how this file's own setup gets anything done. A fix for the config is in
 * flight on its own branch; when it lands this filter comes out and the specs
 * can assert on a confirmed round trip instead of an optimistic one.
 */
const HARNESS_ORIGIN_403 = /403 \(Forbidden\)/;

async function openFarm(context: BrowserContext) {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  // Same reason as stackacres-game-feel.spec.ts: the play gate awaits
  // `HTMLAudioElement.play()`, which never settles with no audio device.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });
  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await dismissRay(page);
  await installProbe(page);
  return { page, errors };
}

/**
 * Installed into the page (not called from Node) so every `page.evaluate` body
 * below is self-contained: an evaluate closure is serialised and run in the
 * browser, where nothing from this file's scope exists.
 */
async function installProbe(page: Page) {
  await page.evaluate(() => {
    const win = window as unknown as {
      __stackacres: TopdownHandle;
      __probe: () => {
        zoom: number;
        following: boolean;
        centre: { x: number; y: number };
        walking: boolean;
        beds: number;
      };
    };
    win.__probe = () => {
      const scene = win.__stackacres.scene as TopdownHandle["scene"] & { soilTiles: () => unknown[] };
      const camera = scene.cameraState();
      return { ...camera, walking: scene.isWalking(), beds: scene.soilTiles().length };
    };
  });
}

const probe = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __probe: () => {
            zoom: number;
            following: boolean;
            centre: { x: number; y: number };
            walking: boolean;
            beds: number;
          };
        }
      ).__probe(),
  );

test("a one-finger drag pans the map instead of walking the farmer, and a pinch lands on a whole zoom", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: LANDSCAPE_PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 400_000);

    const { page, errors } = await openFarm(farmerContext);
    const client = await page.context().newCDPSession(page);
    const touch = async (
      type: "touchStart" | "touchMove" | "touchEnd",
      points: { x: number; y: number }[],
    ) => {
      await client.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    };

    const before = await probe(page);
    // A drag well past the tap slop, across the middle of the map.
    const mid = { x: LANDSCAPE_PHONE.width / 2, y: LANDSCAPE_PHONE.height / 2 };
    await touch("touchStart", [mid]);
    for (let step = 1; step <= 10; step += 1) {
      await touch("touchMove", [{ x: mid.x - step * 8, y: mid.y - step * 4 }]);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    await page.waitForTimeout(200);

    const panned = await probe(page);
    // The camera came off the farmer and moved, and he never took a step:
    // before this, a drag on the canvas did nothing at all and only a tap moved him.
    expect(panned.following).toBe(false);
    expect(panned.walking).toBe(false);
    expect(Math.hypot(panned.centre.x - before.centre.x, panned.centre.y - before.centre.y)).toBeGreaterThan(4);

    // Two fingers spreading apart: the zoom may sit anywhere while they are down,
    // and has to settle back onto a whole number once they lift, which is what
    // keeps the art crisp (lib/stackacres-td/camera.ts).
    const left = { x: mid.x - 60, y: mid.y };
    const right = { x: mid.x + 60, y: mid.y };
    await touch("touchStart", [left, right]);
    for (let step = 1; step <= 10; step += 1) {
      await touch("touchMove", [
        { x: left.x - step * 6, y: left.y },
        { x: right.x + step * 6, y: right.y },
      ]);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    // The settle is eased, so give it a few frames to land.
    await page.waitForFunction(
      () => Number.isInteger((window as unknown as { __probe: () => { zoom: number } }).__probe().zoom),
      null,
      { timeout: 5_000 },
    );
    const settled = await probe(page);
    expect(Number.isInteger(settled.zoom)).toBe(true);
    expect(settled.zoom).toBeGreaterThanOrEqual(1);

    // Touching the thumb stick brings the camera home, which is the rule that
    // stops a panned-away player walking someone they cannot see.
    const stick = page.locator(".sa-joystick");
    await expect(stick).toBeVisible();
    const box = await stick.boundingBox();
    expect(box).not.toBeNull();
    // Off-centre on purpose: the stick has a dead zone (movement.ts's
    // `stickVector`), and a touch inside it is not a push, so it is not the
    // farmer moving either.
    await touch("touchStart", [{ x: box!.x + box!.width * 0.82, y: box!.y + box!.height / 2 }]);
    await page.waitForTimeout(600);
    await touch("touchEnd", []);
    await page.waitForFunction(
      () => (window as unknown as { __probe: () => { following: boolean } }).__probe().following,
      null,
      { timeout: 5_000 },
    );

    expect(errors).toEqual([]);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("the seed pouch opens the wheel and a plain tap picks the crop", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: LANDSCAPE_PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 400_000);

    // The wheel only has anything on it once the barn holds seed. Bought over
    // the API rather than through Ray's shop: getting there is setup, not what
    // this is testing.
    const bought = await farmerContext.request.post("/api/stackacres/actions", {
      data: { action: "buy-seed", crop: "carrot", quantity: 1 },
    });
    expect(bought.ok(), "could not buy carrot seed").toBe(true);

    const { page, errors } = await openFarm(farmerContext);

    const pouch = page.locator(".sa-belt-slot").last();
    await expect(pouch).toBeVisible();
    await pouch.click();

    const wheel = page.locator(".sa-seed-wheel");
    await expect(wheel).toBeVisible({ timeout: 10_000 });
    const carrot = wheel.locator(".sa-gel-token").first();
    await expect(carrot).toBeVisible();

    // A tap is the whole commitment now. The old dock made this token be
    // dragged into a circle pinned on the tapped tile.
    await carrot.click();
    await expect(wheel).toHaveCount(0);
    // The pouch is now the held slot and says what it sows.
    await expect(pouch).toHaveAttribute("aria-checked", "true");
    await expect(pouch).toHaveAttribute("aria-label", /carrot/i);

    expect(errors).toEqual([]);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("the hoe breaks ground under the farmer's feet from the Use key", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: LANDSCAPE_PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 400_000);

    // The Crop Fields are open ground now -- nothing is paid to get in, and
    // laying the first bed out there is itself what clears them. Soil is the
    // only thing this farm still has to buy.
    const soil = await farmerContext.request.post("/api/stackacres/actions", {
      data: { action: "buy-soil", tier: "dirt", quantity: 4 },
    });
    expect(soil.ok(), "could not buy soil").toBe(true);

    const { page, errors } = await openFarm(farmerContext);

    // Stand him on a bare bed square out in the Old Fields.
    await page.evaluate(
      (gate) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.placeFarmer("oldfields", gate),
      OLD_FIELDS_GATE,
    );
    await page.waitForTimeout(300);
    const bedPoint = await page.evaluate(
      (bed) =>
        (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.clientPointFor(bed.x, bed.y),
      BARE_BED,
    );
    await dismissRay(page);
    await page.touchscreen.tap(bedPoint.x, bedPoint.y);
    await page.waitForFunction(
      () => !(window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.isWalking(),
      null,
      { timeout: 15_000 },
    );

    // Pick up the hoe, then press Use. The bed appears under him with no menu
    // in between and nothing to drag.
    const hoe = page.locator(".sa-belt-slot").nth(1);
    await expect(hoe).toHaveAttribute("aria-label", /hoe/i);
    await hoe.click();
    await expect(hoe).toHaveAttribute("aria-checked", "true");

    const soilBefore = (await probe(page)).beds;
    // What the Use key is supposed to send. Watched on the wire rather than
    // through the farm's own state, because the harness 403s it (see
    // HARNESS_ORIGIN_403) and an optimistic bed would appear either way.
    const sent = page.waitForRequest(
      (request) =>
        request.url().includes("/api/stackacres/actions") &&
        request.method() === "POST" &&
        (request.postData() ?? "").includes("place-soil-tile"),
      { timeout: 10_000 },
    );
    await page.locator(".sa-use-key").click();
    await sent;
    // And the bed is on the ground the instant it is asked for, with no menu in
    // between and nothing to drag.
    await page.waitForFunction(
      (was) => (window as unknown as { __probe: () => { beds: number } }).__probe().beds > was,
      soilBefore,
      { timeout: 10_000 },
    );

    expect(errors.filter((line) => !HARNESS_ORIGIN_403.test(line))).toEqual([]);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
