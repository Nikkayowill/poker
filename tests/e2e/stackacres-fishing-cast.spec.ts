import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * A cast, end to end in a real engine: tapping the dock walks the farmer out
 * to the water, turns him side-on, and plays the swing, the wait, the bite and
 * whatever the gauge answered -- with his controls locked the whole way.
 *
 * Phaser is the one place tsc, eslint and the unit suite all see nothing
 * (lib/stackacres-td/fishing-cast.ts covers the numbers and the frame names;
 * nothing but a browser covers the sprite actually playing them), so this is
 * what catches a sequence that typechecks and then throws on the first tap.
 *
 * It replaced a drag-the-rod-out-of-a-shaking-circle overlay that was plain
 * DOM. There is no DOM left to assert on: the whole cast is on the canvas now.
 */

const ADMIN_SECRET = "playwright-admin-secret";
const LANDSCAPE_PHONE = { width: 844, height: 390 };
const GAUGE_SCENE_KEY = "stackacres-fishing";

/** The dock on the Homestead, and dry ground a short walk east of it. */
const DOCK = { x: 196, y: 421 };
const NEAR_DOCK = { x: 268, y: 424 };

interface TopdownHandle {
  scene: {
    clientPointFor: (x: number, y: number) => { x: number; y: number };
    placeFarmer: (area: string, at: { x: number; y: number }) => void;
    isWalking: () => boolean;
    endFishingCast: (outcome: "landed" | "escaped") => void;
    setUseHeld: (down: boolean) => void;
    pos: { x: number; y: number };
    facing: string;
    /** Private to the scene; read here because the phase IS what this spec is about. */
    cast: { phase: string; side: string } | null;
    player: { anims: { currentAnim: { key: string } | null }; frame: { name: string } };
  };
  game: {
    scene: {
      getScene: (key: string) => { giveUp: () => void } | null;
      /** A stopped gauge stays registered on the manager, so "is it up?" is
       *  this and never `getScene` -- see `launchFishingGauge`, which removes
       *  the stale one on the next cast. */
      isActive: (key: string) => boolean;
    };
  };
}

type Handle = { __stackacres: TopdownHandle };

const read = (page: Page) =>
  page.evaluate(() => {
    const { scene, game } = (window as unknown as Handle).__stackacres;
    return {
      phase: scene.cast?.phase ?? null,
      side: scene.cast?.side ?? null,
      facing: scene.facing,
      anim: scene.player.anims.currentAnim?.key ?? null,
      frame: scene.player.frame.name,
      pos: { ...scene.pos },
      walking: scene.isWalking(),
      gauge: game.scene.isActive("stackacres-fishing"),
    };
  });

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

/** Stands him beside the pond and taps the dock, as a finger would. */
async function castFromDock(page: Page) {
  await page.evaluate((at) => (window as unknown as Handle).__stackacres.scene.placeFarmer("homestead", at), NEAR_DOCK);
  await page.waitForTimeout(300);
  const target = await page.evaluate(
    (at) => (window as unknown as Handle).__stackacres.scene.clientPointFor(at.x, at.y),
    DOCK,
  );
  await page.touchscreen.tap(target.x, target.y);
  await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast !== null, null, { timeout: 15_000 });
}

test("a tap on the dock casts side-on, waits for a bite, and opens the gauge", async ({ browser }) => {
  const { page, errors, close } = await openFarm(browser);
  try {
    await castFromDock(page);

    // The swing, thrown at the water rather than at the camera.
    const swinging = await read(page);
    expect(swinging.phase).toBe("cast");
    expect(swinging.side).toBe("left");
    expect(swinging.facing).toBe("left");
    expect(swinging.anim).toBe("cast_left");
    // He walked to the dock's dry end, not onto the planks.
    expect(swinging.pos.x).toBeGreaterThan(DOCK.x);

    // Rod out, line in the water, nothing on it yet.
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast?.phase === "nibble", null, {
      timeout: 10_000,
    });
    const waiting = await read(page);
    expect(waiting.walking).toBe(false);
    // The last frame of the rig's own fishing tag, held.
    expect(waiting.frame).toBe("75");

    // The bite. The wait is rolled between 1.5s and 3.5s, so this is generous.
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast?.phase === "tension", null, {
      timeout: 15_000,
    });
    const fighting = await read(page);
    expect(fighting.anim).toBe("tension_left");
    // The shell heard the bite and put the gauge up over the map.
    await expect.poll(() => page.evaluate((key) => (window as unknown as Handle).__stackacres.game.scene.isActive(key), GAUGE_SCENE_KEY)).toBe(true);

    // The stick and the Use key stood down the moment the world took him:
    // both are refused for the whole cast, so leaving them lit would read as
    // the game having frozen.
    await expect(page.locator(".sa-joystick")).toHaveClass(/is-away/);
    await expect(page.locator(".sa-use-key")).toHaveClass(/is-away/);

    // And they come back the moment he has himself again.
    await page.evaluate((key) => (window as unknown as Handle).__stackacres.game.scene.getScene(key)?.giveUp(), GAUGE_SCENE_KEY);
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast === null, null, { timeout: 15_000 });
    await expect(page.locator(".sa-joystick")).not.toHaveClass(/is-away/);
    await expect(page.locator(".sa-use-key")).not.toHaveClass(/is-away/);

    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test("landing one lifts the catch, losing one snaps the rod back, and both give him his controls", async ({ browser }) => {
  const { page, errors, close } = await openFarm(browser);
  try {
    // Losing one is driven through the real gauge: `giveUp` is the same
    // one-way door a drained bar goes through, so this exercises the whole
    // chain -- gauge resolves, shell hears `onEscaped`, world snaps the rod.
    await castFromDock(page);
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast?.phase === "tension", null, {
      timeout: 15_000,
    });
    await page.evaluate((key) => (window as unknown as Handle).__stackacres.game.scene.getScene(key)?.giveUp(), GAUGE_SCENE_KEY);
    await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__stackacres.scene.cast?.phase ?? null)).toBe("snap");
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast === null, null, { timeout: 15_000 });
    // The gauge took itself down with it, so the map has its own taps back.
    await expect.poll(() => page.evaluate((key) => (window as unknown as Handle).__stackacres.game.scene.isActive(key), GAUGE_SCENE_KEY)).toBe(false);

    // Landing one is driven at the contract instead: winning the real gauge
    // means tracking a darting fish for a second, which is a coin flip to
    // automate. `endFishingCast` is exactly what the shell's own `onLanded`
    // calls, so the beat under test is the same one either way.
    await castFromDock(page);
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast?.phase === "tension", null, {
      timeout: 15_000,
    });
    const landing = await page.evaluate((key) => {
      const { scene, game } = (window as unknown as Handle).__stackacres;
      scene.endFishingCast("landed");
      const phase = scene.cast?.phase ?? null;
      const anim = scene.player.anims.currentAnim?.key ?? null;
      // Then take the gauge down the way a resolved fight does. It answers
      // `onEscaped`, which the world ignores: the reel already has him.
      game.scene.getScene(key)?.giveUp();
      return { phase, anim };
    }, GAUGE_SCENE_KEY);
    expect(landing.phase).toBe("reel");
    expect(landing.anim).toBe("reel_left");

    // The reel runs on into the lift, then hands him back.
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast === null, null, { timeout: 15_000 });
    expect((await read(page)).phase).toBeNull();

    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test("the stick and the belt are refused mid-cast, and a tap backs out of one", async ({ browser }) => {
  const { page, errors, close } = await openFarm(browser);
  try {
    await castFromDock(page);
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast?.phase === "nibble", null, {
      timeout: 10_000,
    });
    const waiting = await read(page);

    // The Use key does not work the ground he is standing on; it backs out instead.
    await page.evaluate(() => (window as unknown as Handle).__stackacres.scene.setUseHeld(true));
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast === null, null, { timeout: 10_000 });
    expect((await read(page)).pos).toEqual(waiting.pos);

    // And a plain tap does the same, without ever reaching the shell: a cast
    // backed out of before the bite never opens a gauge.
    await castFromDock(page);
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast?.phase === "nibble", null, {
      timeout: 10_000,
    });
    const away = await page.evaluate(
      (at) => (window as unknown as Handle).__stackacres.scene.clientPointFor(at.x, at.y),
      { x: NEAR_DOCK.x + 40, y: NEAR_DOCK.y },
    );
    await page.touchscreen.tap(away.x, away.y);
    await page.waitForFunction(() => (window as unknown as Handle).__stackacres.scene.cast === null, null, { timeout: 10_000 });
    // He stayed put: the tap spent itself on the cast rather than walking him.
    await page.waitForTimeout(400);
    expect((await read(page)).walking).toBe(false);

    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});
