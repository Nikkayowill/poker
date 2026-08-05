import { expect, test } from "@playwright/test";

/**
 * The seam between the WebGL room and the DOM HUD drawn over it.
 *
 * Everything here is invisible in a screenshot until it is badly wrong, which
 * is why it is a test rather than a look. A canvas that swallows a tap looks
 * exactly like a button that did not fire; a canvas that never sleeps looks
 * exactly like one that does, until the phone is warm.
 */

const TABLE = { name: "Scene QA", isPrivate: true, tier: "1k", buyIn: 1000 };

async function seatAtTable(context: import("@playwright/test").BrowserContext, query = "") {
  await context.request.post("/api/profile");
  const created = await context.request.post("/api/games", { data: TABLE });
  expect(created.ok()).toBe(true);
  const gameId = (await created.json()).game.id as string;

  const page = await context.newPage();
  await page.goto(`/?table=${gameId}${query}`);
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.locator(".poker-table-wrap")).toBeVisible();
  // Code-split, so it arrives a beat after the table does.
  await page.waitForFunction(() => Boolean(window.__stackchipsScene), null, { timeout: 30_000 });
  return { page, gameId };
}

/**
 * The requirement the whole architecture rests on: the HUD sits *on top* of
 * the room, and the room cannot take a click.
 *
 * Hit-tested with `elementFromPoint` at each element's own centre rather than
 * by reading z-indexes, because a z-index is a claim and the hit test is what
 * the browser will actually do when a player's thumb lands there.
 */
test("the DOM HUD sits on top of the canvas and the canvas takes no input", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context);

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
        hits: [
          ".pot-display",
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
    for (const hit of report.hits) {
      expect(hit).toEqual({ selector: hit.selector, found: true, canvasOnTop: false });
    }
  } finally {
    await context.close();
  }
});

/**
 * The felt and rail stop painting themselves only when the room is genuinely
 * there to replace them.
 *
 * The failure this guards is asymmetric and easy to ship: get it wrong in one
 * direction and a device without WebGL shows an unpainted table; get it wrong
 * in the other and a flat green ellipse is drawn over a lit one.
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
      return {
        lit: area?.classList.contains("scene-lit") ?? false,
        feltBackground: felt ? getComputedStyle(felt).backgroundImage : null,
        railBackground: rail ? getComputedStyle(rail).backgroundImage : null,
        // The boxes themselves must survive: they are the coordinate system
        // the seat ring and the pot anchor are positioned against.
        feltBox: felt ? felt.getBoundingClientRect().width > 0 : false,
      };
    });
    expect(painted.lit).toBe(true);
    expect(painted.feltBackground).toBe("none");
    expect(painted.railBackground).toBe("none");
    expect(painted.feltBox).toBe(true);
  } finally {
    await context.close();
  }
});

/**
 * The room is fitted to the table's own plate, at whatever size the viewport
 * left it.
 *
 * A single fixed world scale lines up at exactly one breakpoint. This checks
 * the solve actually ran and landed somewhere sane on two very different
 * plates -- a desktop table and a portrait phone one.
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
      const fit = await page.evaluate(() => ({
        scale: window.__stackchipsScene!.roomScale(),
        wrap: document.querySelector(".poker-table-wrap")!.getBoundingClientRect().width,
        canvas: document.querySelector(".table-scene canvas")!.getBoundingClientRect().width,
      }));
      // Inside the solver's own clamps, i.e. a real solution rather than a
      // bail-out onto a bound.
      expect(fit.scale).toBeGreaterThan(0.2);
      expect(fit.scale).toBeLessThan(3);
      expect(fit.canvas).toBeGreaterThan(0);
      expect(fit.wrap).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
}

/**
 * Layer C, and its kill switch.
 *
 * Two things are worth holding: that the sprite layer is *on* by default now
 * (the room's seat ring and the DOM's land on the same coordinates, which is
 * the whole reason the staging existed in the first place -- before the room
 * became the layout authority the two rings disagreed by 184px at the side
 * seats, a whole chair), and that `?webglAvatars=0` still falls back to the
 * flat DOM figures, so the sprite layer can be pulled from a live table
 * without a redeploy if it ever needs to be.
 */
test("the sprite layer is on by default, and the room's seats land on the DOM's", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context);
    // One frame for the fit to publish its seat ring and React to place the
    // plates on it.
    await page.waitForTimeout(1_500);

    const alignment = await page.evaluate(() => {
      const scene = window.__stackchipsScene!;
      return [...document.querySelectorAll(".player-seat")].map((el, slot) => {
        const r = el.getBoundingClientRect();
        const projected = scene.seat(slot);
        return {
          dx: Math.abs(projected.x - (r.x + r.width / 2)),
          dy: Math.abs(projected.y - (r.y + r.height / 2)),
        };
      });
    });

    expect(alignment.length).toBeGreaterThan(0);
    for (const seat of alignment) {
      // Tight, because these are now the same computation: the DOM plate is
      // positioned *from* the projection. Anything beyond a rounding error
      // means the two have come apart again.
      expect(seat.dx).toBeLessThanOrEqual(12);
      expect(seat.dy).toBeLessThanOrEqual(12);
    }

    // And the DOM figure has stood down, so only one system is drawing people.
    const figureHidden = await page.evaluate(
      () => getComputedStyle(document.querySelector(".seat-figure")!).visibility === "hidden",
    );
    expect(figureHidden).toBe(true);
  } finally {
    await context.close();
  }
});

test("the kill switch falls back to the flat DOM figures", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context, "&webglAvatars=0");
    const state = await page.evaluate(() => ({
      flagged: document.querySelector(".table-area")?.classList.contains("scene-avatars") ?? false,
      // The DOM figures are visible again, because they are the ones drawing
      // the players once more.
      figureHidden: getComputedStyle(document.querySelector(".seat-figure")!).visibility === "hidden",
    }));
    expect(state).toEqual({ flagged: false, figureHidden: false });
  } finally {
    await context.close();
  }
});
