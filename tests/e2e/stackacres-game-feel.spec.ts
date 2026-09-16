import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

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
    pos: { x: number; y: number };
    player: { x: number; y: number; anims: { currentAnim: { key: string } | null } };
    cameras: { main: { scrollX: number; scrollY: number } };
  };
  game: { events: { on: (event: string, fn: () => void) => void; off: (event: string, fn: () => void) => void } };
}

async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string } };
  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);
}

test("a tap walks the farmer without shaking, and his actions play", async ({ browser }) => {
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
    await page.locator(".sa-play-screen").click({ timeout: 15_000 });
    await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
    await page.waitForTimeout(2_000);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const welcome = page.locator(".profile-overlay .sa-cta");
      if ((await welcome.count()) === 0) break;
      await welcome.first().click();
      await page.waitForTimeout(300);
    }

    // Open grass in the middle of the Homestead, then a real tap down and to the right of him.
    const start = { x: 236, y: 196 };
    await page.evaluate((at) => {
      (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.placeFarmer("homestead", at);
    }, start);
    await page.waitForTimeout(300);
    const target = await page.evaluate(
      (at) => (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.clientPointFor(at.x, at.y),
      { x: start.x + 80, y: start.y + 20 },
    );

    // Where he's drawn relative to the camera, every rendered frame of the walk.
    await page.evaluate(() => {
      const { scene, game } = (window as unknown as { __stackacres: TopdownHandle }).__stackacres;
      const offsets = new Set<string>();
      (window as unknown as { __offsets: Set<string> }).__offsets = offsets;
      const sample = () => {
        if (!scene.isWalking()) return;
        const cam = scene.cameras.main;
        offsets.add(`${(scene.player.x - cam.scrollX).toFixed(3)},${(scene.player.y - cam.scrollY).toFixed(3)}`);
      };
      game.events.on("postrender", sample);
    });
    await page.touchscreen.tap(target.x, target.y);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __offsets: Set<string> }).__offsets.size)).toBeGreaterThan(0);
    await page.waitForFunction(() => !(window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.isWalking());

    const walk = await page.evaluate(() => ({
      offsets: [...(window as unknown as { __offsets: Set<string> }).__offsets],
      at: (window as unknown as { __stackacres: TopdownHandle }).__stackacres.scene.pos,
    }));
    expect(walk.at.x).toBeGreaterThan(start.x + 40);
    expect(walk.offsets).toHaveLength(1);

    for (const [action, anim] of [
      ["water", "water"],
      ["harvest", "harvest"],
      ["plant", "chop"],
    ] as const) {
      const playing = await page.evaluate((a) => {
        const { scene } = (window as unknown as { __stackacres: TopdownHandle }).__stackacres;
        scene.farmerAction(a);
        return scene.player.anims.currentAnim?.key ?? null;
      }, action);
      expect(playing).toMatch(new RegExp(`^${anim}_(up|down|left|right)$`));
      await page.waitForTimeout(1_400);
    }

    expect(errors).toEqual([]);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
