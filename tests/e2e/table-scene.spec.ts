import { expect, test } from "@playwright/test";

/**
 * The seam between the canvas room and the DOM HUD drawn over it.
 *
 * Everything here is invisible in a screenshot until it is badly wrong,
 * which is why it is a test rather than a look. A canvas that swallows a
 * tap looks exactly like a button that did not fire; a skeletal mixer that
 * receives one frame looks alive for an instant and then freezes.
 */

const TABLE = { name: "Scene QA", isPrivate: true, tier: "1k", buyIn: 1000 };

async function seatAtTable(context: import("@playwright/test").BrowserContext) {
  await context.request.post("/api/profile");
  const created = await context.request.post("/api/games", { data: TABLE });
  expect(created.ok()).toBe(true);
  const gameId = (await created.json()).game.id as string;

  const page = await context.newPage();
  await page.goto(`/?table=${gameId}`);
  // POST /api/profile establishes the guest session on this context. The
  // table route consumes it automatically; waiting on the account-gate
  // button races that redirect and can leave Playwright clicking a disabled,
  // already-obsolete node while the table is visibly running underneath.
  await expect(page.locator(".poker-table-wrap")).toBeVisible();
  // Code-split, so it arrives a beat after the table does.
  await page.waitForFunction(() => Boolean(window.__stackchipsScene), null, { timeout: 30_000 });
  return { page, gameId };
}

/**
 * The requirement the whole architecture rests on: the HUD sits *on top* of
 * the room, and the room cannot take a click.
 *
 * Hit-tested with `elementFromPoint` at each element's own centre rather
 * than by reading z-indexes, because a z-index is a claim and the hit test
 * is what the browser will actually do when a player's thumb lands there.
 */
test("the DOM HUD sits on top of the canvas and the canvas takes no input", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context);
    const liveHand = page.locator('[class*="ownHandLayerLive"]');
    await expect(liveHand).toBeVisible();
    await expect(page.locator('[class*="ownHandStrength"]')).toBeVisible();

    const report = await page.evaluate(() => {
      const host = document.querySelector(".table-scene");
      const style = host ? getComputedStyle(host) : null;
      const hit = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return { selector, found: false, canvasOnTop: true };
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { selector, found: true, canvasOnTop: top?.tagName === "CANVAS" };
      };
      return {
        canvasPresent: Boolean(document.querySelector(".table-scene canvas")),
        pointerEvents: style?.pointerEvents ?? null,
        ariaHidden: host?.getAttribute("aria-hidden"),
        navPotDisplay: getComputedStyle(document.querySelector(".game-header .pot-display")!).display,
        headerPositions: (() => {
          const header = document.querySelector(".game-header")!.getBoundingClientRect();
          const leave = document.querySelector(".game-header .leave-button")!.getBoundingClientRect();
          const profile = document.querySelector(".game-header [aria-label=\"Open player menu\"]")!.getBoundingClientRect();
          return {
            leftGap: leave.left - header.left,
            rightGap: header.right - profile.right,
          };
        })(),
        livePotVisible: Array.from(document.querySelectorAll('[class*="livePot"]'))
          .some((pot) => getComputedStyle(pot).visibility !== "hidden"),
        hits: [
          ".table-feed",
          ".action-slot-controls",
          ".seat-plate",
          ".community-cards",
        ].map(hit),
      };
    });

    expect(report.canvasPresent).toBe(true);
    // Without this the room covers every seat and every button on the felt.
    expect(report.pointerEvents).toBe("none");
    // And it contributes nothing to the accessibility tree.
    expect(report.ariaHidden).toBe("true");
    // The 3D room owns the pot readout; the Classic header copy must not
    // produce two competing totals.
    expect(report.navPotDisplay).toBe("none");
    expect(report.livePotVisible).toBe(true);
    expect(report.headerPositions.leftGap).toBeGreaterThanOrEqual(0);
    expect(report.headerPositions.rightGap).toBeGreaterThanOrEqual(0);
    for (const hit of report.hits) {
      expect(hit).toEqual({ selector: hit.selector, found: true, canvasOnTop: false });
    }

    const handPlacement = await page.evaluate(() => {
      const hand = document.querySelector('[class*="ownHandLayerLive"]')!.getBoundingClientRect();
      const action = document.querySelector(".action-bar-3d")!.getBoundingClientRect();
      const localSeat = window.__stackchipsScene!.seat(0);
      return {
        sideOffset: hand.x + hand.width / 2 - localSeat.x,
        actionGap: action.y - (hand.y + hand.height),
      };
    });
    expect(handPlacement.sideOffset).toBeGreaterThan(40);
    expect(handPlacement.actionGap).toBeGreaterThan(0);
    expect(handPlacement.actionGap).toBeLessThan(48);
  } finally {
    await context.close();
  }
});

test("switching Classic back to 3D restores the complete 3D HUD", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context);
    const playerMenu = page.getByRole("button", { name: "Open player menu" });

    await playerMenu.click();
    await page.getByRole("menuitem", { name: "Table: 3D room" }).click();
    await expect(page.locator(".game-header")).not.toHaveClass(/game-header-3d/);
    await expect(page.locator(".game-header .pot-display")).toBeVisible();
    await expect(page.locator('[class*="ownHandLayerLive"]')).toHaveCount(0);

    await playerMenu.click();
    await page.getByRole("menuitem", { name: "Table: Classic" }).click();
    await expect(page.locator(".game-header")).toHaveClass(/game-header-3d/);
    await expect(page.locator(".game-header .pot-display")).toBeHidden();
    await expect(page.locator('[class*="livePot"]')).toBeVisible();
    await expect(page.locator('[class*="ownHandLayerLive"]')).toBeVisible();
    await expect.poll(
      () => page.evaluate(() => window.__stackchipsScene?.framesRendered() ?? 0),
      { timeout: 8_000 },
    ).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

/**
 * The felt, rail and classic DOM seats stop painting themselves only when
 * the room is genuinely there to replace them. The 3D room owns its figures
 * and projected nameplates as one camera-aligned system.
 *
 * The failure this guards is asymmetric and easy to ship: get it wrong in
 * one direction and a device without a working canvas shows an unpainted
 * table; get it wrong in the other and a flat green ellipse is drawn over
 * a painted one.
 */
test("the DOM felt yields to the room, and only once the room exists", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context);
    const painted = await page.evaluate(() => {
      const area = document.querySelector(".table-area");
      const felt = document.querySelector(".poker-felt");
      const rail = document.querySelector(".poker-rail");
      const figure = document.querySelector(".seat-figure");
      return {
        lit: area?.classList.contains("scene-lit") ?? false,
        feltBackground: felt ? getComputedStyle(felt).backgroundImage : null,
        railBackground: rail ? getComputedStyle(rail).backgroundImage : null,
        // The boxes themselves must survive: they are the coordinate system
        // the seat ring and the pot anchor are positioned against.
        feltBox: felt ? felt.getBoundingClientRect().width > 0 : false,
        livePlateVisible: Array.from(document.querySelectorAll('[class*="plateName"]'))
          .some((plate) => getComputedStyle(plate).visibility !== "hidden"),
        figureVisible: figure ? getComputedStyle(figure).visibility !== "hidden" : false,
      };
    });
    expect(painted.lit).toBe(true);
    expect(painted.feltBackground).toBe("none");
    expect(painted.railBackground).toBe("none");
    expect(painted.feltBox).toBe(true);
    expect(painted.figureVisible).toBe(false);
    expect(painted.livePlateVisible).toBe(true);
  } finally {
    await context.close();
  }
});

/**
 * The room is fitted to the table's own rail, at whatever size and shape the
 * viewport left it.
 *
 * `.poker-rail` carries the per-breakpoint insets the table artwork was cut
 * to. The perspective room deliberately leaves some of that box around the
 * physical rail because the seated Blender bodies are wider than the felt;
 * making the felt fill the box would crop the side players. We still pin a
 * useful lower bound so a bad camera fit cannot shrink the room to a diorama.
 *
 * Checked on two very different plates, because the shape is the whole
 * point: `--table-aspect` is 1.84 on a desktop and 0.62 on a portrait phone,
 * and a fit that reads only the width paints the same wide horizontal oval
 * on both.
 */
for (const viewport of [
  { width: 1440, height: 900, label: "desktop" },
  { width: 390, height: 844, label: "portrait phone" },
]) {
  test(`the room fits the ${viewport.label} table plate`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    try {
      const { page } = await seatAtTable(context);
      const fit = await page.evaluate(() => {
        const rail = document.querySelector(".poker-rail")!.getBoundingClientRect();
        return {
          felt: window.__stackchipsScene!.roomFelt(),
          rail: { width: rail.width, height: rail.height },
          canvas: document.querySelector(".table-scene canvas")!.getBoundingClientRect().width,
        };
      });
      expect(fit.canvas).toBeGreaterThan(0);
      expect(fit.rail.width).toBeGreaterThan(0);
      expect(fit.rail.height).toBeGreaterThan(0);

      // RAIL_SCALE (1.14) converts the measured felt to its physical rail.
      // One axis must dominate the plate. Landscape binds on height once the
      // bodies are included; portrait binds on width and deliberately leaves
      // the lower vertical space to the local hand and action controls.
      const fill = [
        (fit.felt.width * 1.14) / fit.rail.width,
        (fit.felt.height * 1.14) / fit.rail.height,
      ];
      expect(Math.max(...fill)).toBeGreaterThan(0.68);
      expect(Math.max(...fill)).toBeLessThan(1.02);

      // Unlike the flat renderer, physical 3D geometry must not stretch into
      // a tall ellipse just because the phone is upright. The camera changes;
      // the poker table keeps its real-world wide proportions.
      expect(fit.felt.width).toBeGreaterThan(fit.felt.height);
    } finally {
      await context.close();
    }
  });
}

/**
 * Rigged characters keep receiving frames even when no chip is in flight.
 * Idle breathing and thinking are skeletal animations; demand mode rendered
 * their first pose and then froze every avatar until an unrelated scene
 * mutation happened.
 */
test("the character room keeps rendering between chip flights", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context);
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => window.__stackchipsScene!.framesRendered());
    // CI uses software WebGL and can render complex skinned models at only a
    // few frames per second. Poll for continued progress; frame-rate belongs
    // to profiling, while this contract is specifically "does not freeze".
    await expect.poll(
      () => page.evaluate(() => window.__stackchipsScene!.framesRendered()),
      { timeout: 5_000 },
    ).toBeGreaterThan(before + 2);
  } finally {
    await context.close();
  }
});
