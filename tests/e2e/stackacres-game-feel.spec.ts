import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "./fixtures";

/**
 * The top-down map, in a real engine: a real tap walks the farmer, he holds
 * still on screen while the ground moves under him, and his action animations
 * play. Phaser is the one place tsc, eslint and the unit suite see nothing, so
 * this is what catches a scene that typechecks and then throws on the first tap.
 *
 * The on-screen check is the regression for the walk shake: Phaser's rounding
 * floored the camera and the farmer separately, so he jumped a pixel against
 * the screen as he walked (see `placeCamera` in components/arcade/stackacres-td/scene.ts).
 */

const ADMIN_SECRET = "playwright-admin-secret";
const LANDSCAPE_PHONE = { width: 844, height: 390 };

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    isWalking: () => boolean;
    farmerAction: (action: "water" | "harvest" | "plant") => void;
    currentPlace: () => string;
    pos: { x: number; y: number };
    areaName: string;
    player: { x: number; y: number; anims: { currentAnim: { key: string } | null } };
    cameras: { main: { scrollX: number; scrollY: number } };
  };
  game: { events: { on: (event: string, fn: () => void) => void; off: (event: string, fn: () => void) => void } };
}

type Handle = { __stackacres: TopdownHandle };

async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string } };
  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);
}

/** A landscape phone on the farm with the map up, Ray's welcome out of the way, and page errors collected. */
async function openFarm(browser: Browser): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({
    viewport: LANDSCAPE_PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  const close = async () => {
    await farmerContext.close();
    await adminContext.close();
  };
  const unlocked = await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } });
  expect(unlocked.ok()).toBe(true);
  await admitFarmer(farmerContext, adminContext.request);

  const page = await farmerContext.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  // The play gate awaits `HTMLAudioElement.play()`, which never settles with no audio device.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Blocked storage: Ray's welcome just shows, and the dismiss below handles it.
    }
  });

  await page.goto("/games/stackacres");
  await page.getByRole("button", { name: "Play", exact: true }).click({ timeout: 15_000 });
  await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const welcome = page.locator(".profile-overlay .sa-cta");
    if ((await welcome.count()) === 0) break;
    await welcome.first().click();
    await page.waitForTimeout(300);
  }
  return { page, errors, close };
}

/** How many times a series turns back on itself, ignoring sub-pixel noise. */
function reversals(values: number[]): number {
  let heading = 0;
  let turns = 0;
  for (let i = 1; i < values.length; i += 1) {
    const step = values[i] - values[i - 1];
    if (Math.abs(step) < 0.01) continue;
    const way = Math.sign(step);
    if (heading !== 0 && way !== heading) turns += 1;
    heading = way;
  }
  return turns;
}

test("a tap walks the farmer without shaking, and his actions play", async ({ browser }) => {
  const { page, errors, close } = await openFarm(browser);
  try {
    // Open grass in the middle of the Homestead, then a real tap down and to the right of him.
    const start = { x: 236, y: 804 };
    await page.evaluate((at) => {
      (window as unknown as Handle).__stackacres.scene.placeFarmer("homestead", at);
    }, start);
    await page.waitForTimeout(300);
    const target = await page.evaluate(
      (at) => (window as unknown as Handle).__stackacres.scene.clientPointFor(at.x, at.y),
      { x: start.x + 80, y: start.y + 20 },
    );

    // Where he's drawn relative to the camera, every rendered frame of the walk.
    await page.evaluate(() => {
      const { scene, game } = (window as unknown as Handle).__stackacres;
      const offsets: { x: number; y: number }[] = [];
      (window as unknown as { __offsets: { x: number; y: number }[] }).__offsets = offsets;
      const sample = () => {
        if (!scene.isWalking()) return;
        const cam = scene.cameras.main;
        offsets.push({ x: scene.player.x - cam.scrollX, y: scene.player.y - cam.scrollY });
      };
      game.events.on("postrender", sample);
    });
    await page.touchscreen.tap(target.x, target.y);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __offsets: { x: number }[] }).__offsets.length)).toBeGreaterThan(0);
    await page.waitForFunction(() => !(window as unknown as Handle).__stackacres.scene.isWalking());

    const walk = await page.evaluate(() => ({
      offsets: [...(window as unknown as { __offsets: { x: number; y: number }[] }).__offsets],
      at: (window as unknown as Handle).__stackacres.scene.pos,
    }));
    expect(walk.at.x).toBeGreaterThan(start.x + 40);
    // He either holds still on screen while the ground moves under him, or he
    // crosses a view that already shows the whole farm and so has nothing left
    // to scroll -- the Homestead fits across a landscape phone at the 20x13
    // minimum view. Both are steady. The shake was a reversal: he slid back
    // against the screen every few frames, so that is what this counts.
    expect(reversals(walk.offsets.map((offset) => offset.x))).toBe(0);
    expect(reversals(walk.offsets.map((offset) => offset.y))).toBe(0);

    for (const [action, anim] of [
      ["water", "water"],
      ["harvest", "harvest"],
      ["plant", "chop"],
    ] as const) {
      const playing = await page.evaluate((a) => {
        const { scene } = (window as unknown as Handle).__stackacres;
        scene.farmerAction(a);
        return scene.player.anims.currentAnim?.key ?? null;
      }, action);
      expect(playing).toMatch(new RegExp(`^${anim}_(up|down|left|right)$`));
      await page.waitForTimeout(1_400);
    }

    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test("the thumb stick walks him, stops him when let go, and carries him between areas", async ({ browser }) => {
  const { page, errors, close } = await openFarm(browser);
  try {
    const stick = page.locator(".sa-joystick");
    await expect(stick).toBeVisible();
    const box = (await stick.boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Real touches, so the stick's pointer capture and the page's touch-action are exercised too.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x = centre.x, y = centre.y) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    const push = async (dx: number, dy: number) => {
      await touch("touchStart");
      for (let i = 1; i <= 5; i++) await touch("touchMove", centre.x + (dx * i) / 5, centre.y + (dy * i) / 5);
    };
    const scene = () =>
      page.evaluate(() => {
        const s = (window as unknown as Handle).__stackacres.scene;
        return { pos: { ...s.pos }, area: s.areaName, walking: s.isWalking(), anim: s.player.anims.currentAnim?.key ?? null };
      });
    // Which part of the one map he is standing on. The Crop Fields stopped being
    // a scene of their own, so "am I in the fields" is this rather than `area`.
    const place = () =>
      page.evaluate(() => (window as unknown as Handle).__stackacres.scene.currentPlace());

    // Open grass in the middle of the Homestead; push right.
    const start = { x: 236, y: 804 };
    await page.evaluate((at) => (window as unknown as Handle).__stackacres.scene.placeFarmer("homestead", at), start);
    await page.waitForTimeout(300);
    await push(50, 0);
    await page.waitForTimeout(700);
    const pushing = await scene();
    expect(pushing.walking).toBe(true);
    expect(pushing.anim).toBe("walk_right");
    // Phaser caps every frame at 16ms while the page lacks focus, as a headless one does, so game time runs slow here.
    expect(pushing.pos.x).toBeGreaterThan(start.x + 12);
    expect(pushing.pos.y).toBeCloseTo(start.y, 1);
    await page.screenshot({ path: test.info().outputPath("stick-held.png") });

    // Let go: he stops where he is.
    await touch("touchEnd");
    await page.waitForTimeout(150);
    const stopped = await scene();
    expect(stopped.walking).toBe(false);
    await page.waitForTimeout(300);
    expect((await scene()).pos).toEqual(stopped.pos);

    // Up the north lane and straight out to the Crop Fields. A fallen log used
    // to bar this until the land was bought for 15,000 Gold, and the fields
    // were a scene of their own behind it. They are the north half of this
    // same map now, so walking up the lane never loads anything: the farmer
    // simply ends up standing on the field.
    await page.evaluate((at) => (window as unknown as Handle).__stackacres.scene.placeFarmer("homestead", at), start);
    await page.waitForTimeout(200);
    await push(0, -50);
    await expect.poll(async () => await place(), { timeout: 5_000 }).toBe("cropfields");
    expect((await scene()).area).toBe("homestead");
    await touch("touchEnd");

    // And back down the same lane to the yard, still without a load.
    await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.placeFarmer("homestead", { x: 232, y: 592 }));
    await page.waitForTimeout(200);
    await push(0, 50);
    await expect.poll(async () => await place(), { timeout: 5_000 }).toBe("farmstead");
    expect((await scene()).area).toBe("homestead");
    await touch("touchEnd");

    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test("the barn and the workshop are walked into, and their menus open inside", async ({ browser }) => {
  const { page, errors, close } = await openFarm(browser);
  try {
    const scene = () =>
      page.evaluate(() => {
        const s = (window as unknown as Handle).__stackacres.scene;
        return { pos: { ...s.pos }, area: s.areaName, walking: s.isWalking() };
      });
    const tapMap = async (x: number, y: number) => {
      const at = await page.evaluate((p) => (window as unknown as Handle).__stackacres.scene.clientPointFor(p.x, p.y), { x, y });
      await page.touchscreen.tap(at.x, at.y);
    };

    // Tapping the barn walks him through its doors, and Ray's counter inside opens the store.
    await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.placeFarmer("homestead", { x: 360, y: 788 }));
    await page.waitForTimeout(300);
    // Watch the outgoing view's opacity frame by frame: going through a door dissolves, it doesn't cut.
    await page.evaluate(() => {
      const w = window as unknown as { __veil: number[]; __stackacres: { scene: { children: { list: { texture?: { key: string }; alpha: number }[] } } } };
      w.__veil = [];
      const sample = () => {
        const veil = w.__stackacres.scene.children.list.find((c) => c.texture?.key === "travel-grab");
        if (veil) w.__veil.push(veil.alpha);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await tapMap(360, 132);
    await expect.poll(async () => (await scene()).area, { timeout: 15_000 }).toBe("barn");
    // A doorway holds the farmer for the dissolve, and the room's name shows on the HUD while it clears.
    await expect(page.locator(".sa-place-tag")).toHaveText("Barn");
    await page.screenshot({ path: test.info().outputPath("barn-name-tag.png") });
    await page.waitForTimeout(600);
    const veil = await page.evaluate(() => (window as unknown as { __veil: number[] }).__veil);
    expect(veil.length).toBeGreaterThan(2);
    expect(veil.some((a) => a > 0.05 && a < 0.95)).toBe(true);
    expect(veil[veil.length - 1]).toBeLessThan(0.3);
    await page.screenshot({ path: test.info().outputPath("inside-barn.png") });
    await tapMap(280, 80);
    await expect(page.getByRole("dialog", { name: "Supply store" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("dialog", { name: "Supply store" }).getByRole("button", { name: "Close" }).click();

    // Out through the doorway, back in front of the barn: to the mat first, since the view follows him down.
    await tapMap(192, 150);
    await expect.poll(async () => (await scene()).walking, { timeout: 15_000 }).toBe(false);
    await page.waitForTimeout(300);
    await tapMap(192, 172);
    await expect.poll(async () => (await scene()).area, { timeout: 15_000 }).toBe("homestead");
    expect((await scene()).pos.y).toBeGreaterThan(160);

    // The workshop: in through its doors, and the workbench opens the recipes.
    await page.waitForTimeout(600);
    await tapMap(488, 132);
    await expect.poll(async () => (await scene()).area, { timeout: 15_000 }).toBe("workshop");
    await page.waitForTimeout(600);
    await page.screenshot({ path: test.info().outputPath("inside-workshop.png") });
    await tapMap(132, 90);
    await expect(page.locator(".sa-workshop")).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test("the house is walked into as a room that floats whole on screen, and its kitchen opens inside", async ({ browser }) => {
  const { page, errors, close } = await openFarm(browser);
  try {
    const scene = () =>
      page.evaluate(() => {
        const s = (window as unknown as Handle).__stackacres.scene;
        const cam = (s as unknown as { cameras: { main: { zoom: number; worldView: { width: number; height: number } } } }).cameras.main;
        return { pos: { ...s.pos }, area: s.areaName, walking: s.isWalking(), zoom: cam.zoom, view: { w: cam.worldView.width, h: cam.worldView.height } };
      });
    const tapMap = async (x: number, y: number) => {
      const at = await page.evaluate((p) => (window as unknown as Handle).__stackacres.scene.clientPointFor(p.x, p.y), { x, y });
      await page.touchscreen.tap(at.x, at.y);
    };

    // Tapping the house walks him in through its red door.
    await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.placeFarmer("homestead", { x: 120, y: 780 }));
    await page.waitForTimeout(1500); // the camera takes a moment to settle on him
    await tapMap(120, 132); // the house's lower wall by its door: its upper wall is above the top of the screen
    await expect.poll(async () => (await scene()).area, { timeout: 15_000 }).toBe("farmhouse");
    await page.waitForTimeout(700);
    await page.screenshot({ path: test.info().outputPath("inside-house.png") });

    // The room floats: a whole zoom, with all of it (20 x 11 tiles) in view rather than stretched or cropped.
    const inside = await scene();
    expect(Number.isInteger(inside.zoom)).toBe(true);
    expect(inside.view.w).toBeGreaterThanOrEqual(320);
    expect(inside.view.h).toBeGreaterThanOrEqual(176);

    // The kitchen run along the back wall opens the house panel.
    await tapMap(128, 80);
    await expect(page.getByRole("dialog", { name: "Your house" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("dialog", { name: "Your house" }).getByRole("button", { name: "Close" }).click();

    // Out through the doorway, back in front of the house.
    await tapMap(160, 150);
    await expect.poll(async () => (await scene()).walking, { timeout: 15_000 }).toBe(false);
    await page.waitForTimeout(300);
    await tapMap(160, 172);
    await expect.poll(async () => (await scene()).area, { timeout: 15_000 }).toBe("homestead");
    expect((await scene()).pos.y).toBeGreaterThan(160);

    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});
