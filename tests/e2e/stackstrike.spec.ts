import { expect, test, type Page } from "@playwright/test";

/**
 * StackStrike: desktop and phone-landscape smoke tests. They read the sim
 * through the dev-only window.__stackstrike handle, so they only run against
 * `next dev`. Headless Chromium draws WebGL in software, which makes the game
 * run slowly here, so these poll for results instead of waiting fixed times.
 */

interface Point {
  x: number;
  y: number;
}

interface Handle {
  state: () => {
    status: string;
    time: number;
    difficulty: string;
    hasGold: boolean;
    loot: { taken: boolean; spot: { pos: Point; main: boolean } }[];
    contract: { id: string };
    enemies: { mode: string; awareness: number; lastKnown: Point | null }[];
    shotsFired: number;
    player: {
      weaponIds: string[];
      pos: Point;
      health: number;
      maxHealth: number;
      aim: number;
      hidden: boolean;
      cover: number;
    };
  };
  heard: () => string[];
  scene: {
    sound: { mute: boolean; get: (key: string) => { volume: number; isPlaying: boolean } | null };
    audio: { update: (dt: number, input: { hunted: boolean; awareness: number; ending: "none" | "dead" | "escaped" }) => unknown };
    readInput: () => { aim: number; fire: boolean };
    buttonCentre: (name: "reload" | "swap") => Point;
    padCentre: (which: "move" | "aim") => Point;
  };
}

type Win = { __stackstrike?: Handle };

const read = (page: Page) => page.evaluate(() => (window as unknown as { __stackstrike: Handle }).__stackstrike.state());
const centre = (page: Page, kind: "button" | "pad", name: string) =>
  page.evaluate(
    ([k, n]) => {
      const { scene } = (window as unknown as { __stackstrike: Handle }).__stackstrike;
      return k === "button"
        ? scene.buttonCentre(n as "reload" | "swap")
        : scene.padCentre(n as "move" | "aim");
    },
    [kind, name] as const,
  );

/** Keeps the player alive: the tests are about controls, not survival. */
async function readyToPlay(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as Win).__stackstrike));
  await page.evaluate(() => {
    const state = (window as unknown as { __stackstrike: Handle }).__stackstrike.state();
    state.player.health = state.player.maxHealth = 1e9;
  });
}

async function openOnPhone(page: Page, difficulty?: "easy" | "normal" | "hard") {
  await page.goto("/stackstrike");
  await expect(page.getByTestId("stackstrike-gate")).toBeVisible();
  if (difficulty) await page.getByTestId(`stackstrike-difficulty-${difficulty}`).tap();
  await page.getByTestId("stackstrike-play").tap();
  await readyToPlay(page);
}

const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };

test("desktop: start screen, then boots with guards on duty, moves and shoots", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/stackstrike");
  await expect(page.getByTestId("stackstrike-gate")).toBeVisible();
  await page.getByTestId("stackstrike-play").click();
  await readyToPlay(page);

  // No waves: the guards are already there.
  expect((await read(page)).enemies.length).toBeGreaterThan(0);

  const before = (await read(page)).player.pos;
  // Down: the start is in a server-rack aisle that opens to the south.
  await page.keyboard.down("s");
  await expect.poll(async () => (await read(page)).player.pos.y, { timeout: 30_000 }).toBeGreaterThan(before.y + 40);
  await page.keyboard.up("s");

  await page.mouse.move(900, 360);
  await page.mouse.down();
  await expect.poll(async () => (await read(page)).shotsFired, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.mouse.up();

  await expect(page.getByTestId("stackstrike-host").locator("canvas")).toHaveCount(1);
});

test("desktop: the mouse aims at the right place on a high-density screen", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto("/stackstrike");
  await page.getByTestId("stackstrike-play").click();
  await readyToPlay(page);

  // The camera centres on the player except near the arena's edge, so stand mid-arena and let it settle.
  await page.evaluate(() => {
    const s = (window as unknown as { __stackstrike: Handle }).__stackstrike.state();
    s.player.pos.x = 750;
    s.player.pos.y = 450;
  });
  await page.mouse.move(640, 360 - 100);
  // A point straight above the screen centre is then straight up.
  await expect
    .poll(
      async () => page.evaluate(() => (window as unknown as { __stackstrike: Handle }).__stackstrike.scene.readInput().aim),
      { timeout: 20_000 },
    )
    .toBeCloseTo(-Math.PI / 2, 1);
  await context.close();
});

test("start screen: the difficulty chosen is the difficulty played", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page, "hard");
  expect((await read(page)).difficulty).toBe("hard");
  // Hard puts more guards on duty than easy.
  const hardGuards = (await read(page)).enemies.length;
  await page.evaluate(() => localStorage.setItem("stackstrike:difficulty", "easy"));
  await page.reload();
  await page.getByTestId("stackstrike-difficulty-easy").tap();
  await page.getByTestId("stackstrike-play").tap();
  await readyToPlay(page);
  expect((await read(page)).difficulty).toBe("easy");
  expect((await read(page)).enemies.length).toBeLessThan(hardGuards);
  await context.close();
});

test("phone landscape: the controls sit where the thumbs are, and the mission is still to do", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);

  await expect(page.getByTestId("stackstrike-rotate")).toHaveCount(0);

  // The guards are on duty and the gold is still where it was left.
  const start = await read(page);
  expect(start.enemies.length).toBeGreaterThan(0);
  expect(start.hasGold).toBe(false);
  expect(start.loot.every((entry) => !entry.taken)).toBe(true);

  // Pads in the bottom corners, buttons clear of them and of each other.
  const move = await centre(page, "pad", "move");
  const aim = await centre(page, "pad", "aim");
  expect(move.x).toBeLessThan(844 / 2);
  expect(aim.x).toBeGreaterThan(844 / 2);
  expect(move.y).toBeGreaterThan(390 / 2);
  const names = ["reload", "swap"] as const;
  const buttons = await Promise.all(names.map((name) => centre(page, "button", name)));
  for (const [index, at] of buttons.entries()) {
    expect(at.x, names[index]).toBeGreaterThan(844 / 2);
    expect(at.y, names[index]).toBeGreaterThan(60);
    expect(at.y, names[index]).toBeLessThan(390 - 20);
    expect(Math.hypot(at.x - aim.x, at.y - aim.y), names[index]).toBeGreaterThan(70 + 30 - 2);
    for (const other of buttons.slice(index + 1)) {
      expect(Math.hypot(at.x - other.x, at.y - other.y)).toBeGreaterThan(60);
    }
  }
  await context.close();
});

test("phone landscape: dragging the right pad aims, letting go fires along that aim", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);
  const aim = await centre(page, "pad", "aim");
  const cdp = await context.newCDPSession(page);
  const wanted = Math.atan2(-20, 40);

  // Drag up and to the right: the gun and laser turn, and nothing is fired while the thumb is down.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: aim.x, y: aim.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: aim.x + 40, y: aim.y - 20, id: 2 }] });
  await expect.poll(async () => (await read(page)).player.aim, { timeout: 20_000 }).toBeCloseTo(wanted, 1);
  await page.waitForTimeout(900);
  expect((await read(page)).shotsFired).toBe(0);

  // The thumb rolls as it leaves the glass: the last touch point is a little way off the aim.
  // Stamped 16ms apart: the software-rendered test browser is slow to take the two calls, and
  // the lookback goes by when the touch happened.
  const now = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: aim.x + 36, y: aim.y - 2, id: 2 }], timestamp: now });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: now + 0.016 });
  await expect.poll(async () => (await read(page)).shotsFired, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await read(page)).player.aim).toBeCloseTo(wanted, 1);
  await context.close();
});

test("phone landscape: a flick that is over within a frame still fires where it went", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);
  const aim = await centre(page, "pad", "aim");
  const cdp = await context.newCDPSession(page);

  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: aim.x, y: aim.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: aim.x - 40, y: aim.y + 40, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await read(page)).shotsFired, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await read(page)).player.aim).toBeCloseTo(Math.atan2(40, -40), 1);
  await context.close();
});

test("phone landscape: sliding the thumb back to the middle cancels the shot", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);
  const aim = await centre(page, "pad", "aim");
  const cdp = await context.newCDPSession(page);

  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: aim.x, y: aim.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: aim.x + 40, y: aim.y - 20, id: 2 }] });
  await expect.poll(async () => (await read(page)).player.aim, { timeout: 20_000 }).toBeCloseTo(Math.atan2(-20, 40), 1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: aim.x + 3, y: aim.y - 2, id: 2 }] });
  // Long enough for the lookback to see only the thumb back in the middle.
  await page.waitForTimeout(1200);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600);
  expect((await read(page)).shotsFired).toBe(0);
  await context.close();
});

test("phone landscape: a tap off the middle of the aim pad fires, and fires that way", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);
  const aim = await centre(page, "pad", "aim");

  // Down and to the left of the pad's middle: the knob does not have to be centred to shoot.
  await page.touchscreen.tap(aim.x - 30, aim.y + 30);
  await expect.poll(async () => (await read(page)).shotsFired, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await read(page)).player.aim).toBeCloseTo(Math.atan2(30, -30), 1);
  await context.close();
});

test("a new player starts at rank 1 with just the pistol, and a restart deals a different job", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await page.goto("/stackstrike");
  await expect(page.getByTestId("stackstrike-rank")).toContainText("RANK 1");
  await page.getByTestId("stackstrike-play").tap();
  await readyToPlay(page);

  const first = await read(page);
  expect(first.player.weaponIds).toEqual(["pistol"]);
  expect(first.loot.some((entry) => entry.spot.main)).toBe(true);
  // Every restart is a different building. Look across a few for the gold moving.
  const spots = new Set([JSON.stringify(first.loot.find((entry) => entry.spot.main)?.spot.pos)]);
  for (let n = 0; n < 6; n += 1) {
    await page.evaluate(() => {
      const s = (window as unknown as { __stackstrike: Handle }).__stackstrike.state();
      s.player.health = 0;
      s.status = "dead";
    });
    await page.waitForTimeout(900);
    await page.touchscreen.tap(400, 200);
    await expect.poll(async () => (await read(page)).status, { timeout: 20_000 }).toBe("playing");
    spots.add(JSON.stringify((await read(page)).loot.find((entry) => entry.spot.main)?.spot.pos));
  }
  expect(spots.size).toBeGreaterThan(1);
  await context.close();
});

test("phone landscape: the left stick walks", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);
  const move = await centre(page, "pad", "move");
  const cdp = await context.newCDPSession(page);

  const start = (await read(page)).player.pos;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: move.x, y: move.y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: move.x + 50, y: move.y, id: 1 }] });
  await expect.poll(async () => (await read(page)).player.pos.x, { timeout: 20_000 }).toBeGreaterThan(start.x + 20);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await context.close();
});

test("phone landscape: a dark corner hides you, and walking out does not", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);

  // Out in the open there is nothing to hide behind.
  expect((await read(page)).player.hidden).toBe(false);

  // Press into the north-west corner of the office.
  await page.evaluate(() => {
    const s = (window as unknown as { __stackstrike: Handle }).__stackstrike.state();
    s.player.pos.x = 62;
    s.player.pos.y = 62;
  });
  await expect.poll(async () => (await read(page)).player.hidden, { timeout: 10_000 }).toBe(true);

  // Out of the corner: seen again.
  await page.evaluate(() => {
    const s = (window as unknown as { __stackstrike: Handle }).__stackstrike.state();
    s.player.pos.x = 250;
    s.player.pos.y = 200;
  });
  await expect.poll(async () => (await read(page)).player.hidden, { timeout: 10_000 }).toBe(false);
  await context.close();
});

test("phone landscape: guards start out knowing nothing and the meter fills before they hunt you", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page, "easy");
  const first = (await read(page)).enemies;
  for (const enemy of first) {
    expect(enemy.lastKnown).toBeNull();
    expect(["patrol", "suspicious", "search"]).toContain(enemy.mode);
  }
  await context.close();
});

test("phone: the canvas is drawn at the screen's pixel density", async ({ browser }) => {
  const context = await browser.newContext({ ...PHONE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await openOnPhone(page);

  const canvas = await page.evaluate(() => {
    const el = document.querySelector("canvas") as HTMLCanvasElement;
    const box = el.getBoundingClientRect();
    return { width: el.width, height: el.height, cssWidth: box.width, cssHeight: box.height };
  });
  expect(canvas.width).toBe(844 * 2);
  expect(canvas.height).toBe(390 * 2);
  expect(Math.round(canvas.cssWidth)).toBe(844);
  expect(Math.round(canvas.cssHeight)).toBe(390);
  await context.close();
});

test("phone: held upright the game pauses behind a rotate screen, and resumes sideways", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);

  // Fullscreen (from the tap) blocks resizing the window in this harness.
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("stackstrike-rotate")).toBeVisible();
  await page.waitForTimeout(500);
  const frozen = (await read(page)).time;
  await page.waitForTimeout(1500);
  expect((await read(page)).time).toBe(frozen);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId("stackstrike-rotate")).toHaveCount(0);
  await expect.poll(async () => (await read(page)).time, { timeout: 20_000 }).toBeGreaterThan(frozen);
  await context.close();
});

test("phone: opened upright, the rotate screen comes first", async ({ browser }) => {
  const context = await browser.newContext({ ...PHONE, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/stackstrike");
  await expect(page.getByTestId("stackstrike-rotate")).toBeVisible();
  await context.close();
});

test("sound: your shots and footsteps are heard, being hunted brings the hunt music, and the toggle mutes", async ({ page }) => {
  const errors: string[] = [];
  const missing: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/stackstrike/audio/") && response.status() >= 400) missing.push(response.url());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/stackstrike");
  await page.getByTestId("stackstrike-play").click();
  await readyToPlay(page);
  const heard = () => page.evaluate(() => (window as unknown as { __stackstrike: Handle }).__stackstrike.heard());
  const sound = (key: string) =>
    page.evaluate((k) => {
      const found = (window as unknown as { __stackstrike: Handle }).__stackstrike.scene.sound.get(k);
      return found ? { volume: found.volume, playing: found.isPlaying } : null;
    }, key);

  const before = (await read(page)).player.pos;
  await page.keyboard.down("s");
  await expect.poll(async () => (await read(page)).player.pos.y, { timeout: 30_000 }).toBeGreaterThan(before.y + 60);
  await page.keyboard.up("s");
  expect((await heard()).some((name) => name.startsWith("step-soft"))).toBe(true);

  await page.mouse.move(900, 360);
  await page.mouse.down();
  await expect.poll(async () => (await heard()).some((name) => name.startsWith("shot-pistol")), { timeout: 10_000 }).toBe(true);
  await page.mouse.up();

  // The calm track fades up on its own once the music has loaded.
  await expect.poll(async () => (await sound("ss-music-stealth"))?.volume ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.1);
  expect((await sound("ss-music-hunted"))?.volume ?? 0).toBeLessThan(0.05);

  // A guard giving chase swaps it for the hunt music. The chase decision itself is unit tested; a guard's
  // own AI changes its mind several times a frame here, so this drives the music as the scene would.
  await page.evaluate(() => {
    const { scene } = (window as unknown as { __stackstrike: Handle }).__stackstrike;
    for (let i = 0; i < 40; i += 1) scene.audio.update(0.1, { hunted: true, awareness: 1, ending: "none" });
  });
  expect((await sound("ss-music-hunted"))?.volume ?? 0).toBeGreaterThan(0.3);
  expect((await sound("ss-music-stealth"))?.volume ?? 1).toBeLessThan(0.1);

  const toggle = page.getByTestId("stackstrike-sound");
  await expect(toggle).toHaveText("Sound on");
  await toggle.click();
  await expect(toggle).toHaveText("Sound off");
  expect(await page.evaluate(() => (window as unknown as { __stackstrike: Handle }).__stackstrike.scene.sound.mute)).toBe(true);
  await toggle.click();
  expect(await page.evaluate(() => (window as unknown as { __stackstrike: Handle }).__stackstrike.scene.sound.mute)).toBe(false);

  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});
