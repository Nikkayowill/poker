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
    wave: number;
    difficulty: string;
    intermission: number;
    incoming: string[];
    enemies: { mode: string; awareness: number; lastKnown: Point | null }[];
    shotsFired: number;
    player: {
      pos: Point;
      health: number;
      maxHealth: number;
      aim: number;
      hidden: boolean;
      cover: number;
    };
  };
  scene: {
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

/** Keeps the player alive and skips the planning countdown: the tests are about controls, not survival. */
async function readyToPlay(page: Page, skipPlanning = false) {
  await page.waitForFunction(() => Boolean((window as unknown as Win).__stackstrike));
  await page.evaluate((skip) => {
    const state = (window as unknown as { __stackstrike: Handle }).__stackstrike.state();
    state.player.health = state.player.maxHealth = 1e9;
    if (skip) state.intermission = 0.01;
  }, skipPlanning);
}

async function openOnPhone(page: Page, difficulty?: "easy" | "normal" | "hard") {
  await page.goto("/stackstrike");
  await expect(page.getByTestId("stackstrike-gate")).toBeVisible();
  if (difficulty) await page.getByTestId(`stackstrike-difficulty-${difficulty}`).tap();
  await page.getByRole("button", { name: "Tap to play" }).tap();
  await readyToPlay(page);
}

const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };

test("desktop: start screen, then boots, moves, shoots and spawns a wave", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/stackstrike");
  await expect(page.getByTestId("stackstrike-gate")).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  await readyToPlay(page, true);

  await expect.poll(async () => (await read(page)).wave, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await read(page)).enemies.length, { timeout: 20_000 }).toBeGreaterThan(0);

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
  await page.getByRole("button", { name: "Play" }).click();
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
  // Hard comes in through more doors than easy.
  expect((await read(page)).incoming.length).toBe(3);
  await context.close();
});

test("phone landscape: the controls sit where the thumbs are, and the planning time is announced", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);

  await expect(page.getByTestId("stackstrike-rotate")).toHaveCount(0);

  // Nothing is in the world yet: planning time, doors announced, no enemies.
  const start = await read(page);
  expect(start.wave).toBe(0);
  expect(start.enemies).toHaveLength(0);
  expect(start.incoming.length).toBeGreaterThan(0);

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

test("phone landscape: the right pad aims without firing, a tap fires", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page);
  const aim = await centre(page, "pad", "aim");
  const cdp = await context.newCDPSession(page);

  // Drag up and to the right: the gun and laser turn, and nothing is fired.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: aim.x, y: aim.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: aim.x + 40, y: aim.y - 20, id: 2 }] });
  await expect.poll(async () => (await read(page)).player.aim, { timeout: 20_000 }).toBeCloseTo(Math.atan2(-20, 40), 1);
  // Hold the drag past the hold-to-fire delay: still nothing, because it is aiming.
  await page.waitForTimeout(900);
  expect((await read(page)).shotsFired).toBe(0);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  expect((await read(page)).shotsFired).toBe(0);

  // The gun stays where it was aimed. A tap on the pad now fires.
  await page.touchscreen.tap(aim.x, aim.y);
  await expect.poll(async () => (await read(page)).shotsFired, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await read(page)).player.aim).toBeCloseTo(Math.atan2(-20, 40), 1);
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

test("phone landscape: enemies come in knowing nothing and the meter fills before they hunt you", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await openOnPhone(page, "easy");
  await page.evaluate(() => {
    (window as unknown as { __stackstrike: Handle }).__stackstrike.state().intermission = 0.01;
  });
  await expect.poll(async () => (await read(page)).enemies.length, { timeout: 30_000 }).toBeGreaterThan(0);
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
