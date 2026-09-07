import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * The game-feel layer, in a real engine.
 *
 * WHY THIS EXISTS AS AN E2E AT ALL. Almost everything this covers is Phaser,
 * and Phaser is the one place `tsc`, `eslint` and the unit suite all see
 * nothing: a scene method can be perfectly typed, perfectly linted, and still
 * take the whole page down on the first tap. This scene has already shipped
 * exactly that -- `TweenChain.remove` called with no argument, which reached
 * players as "a client-side exception has occurred" every time a bounce was
 * still running when its unit was rebuilt (see `cancelPop`'s own comment in
 * stackacres-scene.ts). The arithmetic underneath all of this is held to its
 * values in lib/stackacres/{crop-visuals,alpha-mask,juice}.test.ts; this spec
 * only answers the question those cannot: does it run.
 *
 * It drives the scene through `window.__stackacres`, the dev-only handle
 * stackacres-world.tsx already exposes for the gesture harness, plus real
 * pointer events at the canvas for the two gesture paths.
 */

const ADMIN_SECRET = "playwright-admin-secret";

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
    const topped = await admin.post("/api/admin/gold/adjust", {
      data: { profileId: profile.id, delta },
    });
    expect(topped.ok()).toBe(true);
  }
  return profile.id;
}

test("growing, harvesting and the equipment ladder all run without throwing", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 400_000);

    const page = await farmerContext.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    // The play gate `await`s `HTMLAudioElement.play()`, which never settles in
    // headless Chromium with no audio device, so the farm never mounts behind
    // it. Not a bug this spec is about -- stubbed so it can reach the scene.
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => {};
    });

    await page.goto("/games/stackacres");
    // By class rather than by role name: the visible label reads "Tap to play"
    // while the accessible name is "Tap to start StackAcres".
    await page.locator(".sa-play-screen").click({ timeout: 15_000 });
    await page.waitForFunction(() => "__stackacres" in window, null, { timeout: 60_000 });
    await page.waitForTimeout(3_000);

    const ghosts = await page.evaluate(async () => {
      type SceneUnit = {
        id: string;
        stock: string;
        state: string;
        progress: number | null;
        permanent: boolean;
      };
      type Probe = {
        setUnits: (units: SceneUnit[]) => void;
        celebrateHarvest: (id: string) => void;
        celebrateCrit: (id: string, multiplier: number) => void;
        popUnit: (id: string) => void;
        setToolIcon: (name: string) => void;
        setTool: (tool: string) => void;
        setToolTier: (tier: string) => void;
      };
      const scene = (window as unknown as { __stackacres: { scene: Probe } }).__stackacres.scene;
      const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const crop = (progress: number | null, state: string): SceneUnit => ({
        id: "probe-crop",
        stock: "carrot",
        state,
        progress,
        permanent: false,
      });

      // Both growth boundaries, each pushed while the previous ease is still
      // running -- the interrupt case, which is what `cancelGrowth` is for.
      scene.setUnits([crop(0.1, "working")]);
      await sleep(120);
      scene.setUnits([crop(0.6, "working")]);
      await sleep(120);
      scene.setUnits([crop(1, "ready")]);
      await sleep(60);
      // A tap and both harvest beats, fired mid-growth (the worst ordering:
      // the node is being written by a tween while an effect reads it).
      scene.popUnit("probe-crop");
      scene.celebrateHarvest("probe-crop");
      scene.celebrateCrit("probe-crop", 2);
      await sleep(500);
      // ...and again once the growth has settled, which is the ordinary one.
      scene.celebrateHarvest("probe-crop");
      scene.celebrateCrit("probe-crop", 1.75);
      await sleep(800);
      // A rebuild straight out of a growth: muck is the one crop change
      // `growCrop` refuses, so this is the fall-through to `buildUnit`.
      scene.setUnits([crop(1, "mucked")]);
      await sleep(200);

      // Each rung of the ladder in turn, which is what the mow ghost now
      // draws. A missing texture would surface as Phaser's green placeholder
      // rather than an error, so the names are asserted outside.
      const seen: string[] = [];
      for (const [tier, icon] of [
        ["trowel", "toolTrowel"],
        ["iron-shovel", "toolIronShovel"],
        ["golden-spade", "toolGoldenSpade"],
      ] as const) {
        scene.setToolTier(tier);
        scene.setToolIcon(icon);
        seen.push(icon);
      }
      scene.setTool("scythe");
      return seen;
    });

    expect(ghosts).toEqual(["toolTrowel", "toolIronShovel", "toolGoldenSpade"]);
    // Every rung's ghost texture really baked, rather than falling back to
    // Phaser's missing-texture frame.
    const baked = await page.evaluate((names: string[]) => {
      const scene = (
        window as unknown as { __stackacres: { game: { textures: { exists: (k: string) => boolean } } } }
      ).__stackacres.game;
      return names.filter((name) => scene.textures.exists(name));
    }, ["toolTrowel", "toolIronShovel", "toolGoldenSpade"]);
    expect(baked).toEqual(["toolTrowel", "toolIronShovel", "toolGoldenSpade"]);

    // The two gesture paths, as real pointer events on the canvas: a press
    // that crosses TAP_SLOP and becomes a pan (where `tapRejectRipple` hangs),
    // then a plain tap (where the alpha mask hangs).
    const box = await page.locator(".sa-world").boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) await page.mouse.move(cx + step * 8, cy + step * 4);
    await page.mouse.up();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1_500);

    expect(errors).toEqual([]);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
