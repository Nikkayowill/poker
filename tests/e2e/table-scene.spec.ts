import { expect, test } from "@playwright/test";

/**
 * The seam between the canvas room and the DOM HUD drawn over it.
 *
 * Everything here is invisible in a screenshot until it is badly wrong,
 * which is why it is a test rather than a look. A canvas that swallows a
 * tap looks exactly like a button that did not fire; a canvas that never
 * sleeps looks exactly like one that does, until the phone is warm.
 */

const TABLE = { name: "Scene QA", isPrivate: true, tier: "1k", buyIn: 1000 };

async function seatAtTable(context: import("@playwright/test").BrowserContext) {
  await context.request.post("/api/profile");
  const created = await context.request.post("/api/games", { data: TABLE });
  expect(created.ok()).toBe(true);
  const gameId = (await created.json()).game.id as string;

  const page = await context.newPage();
  await page.goto(`/?table=${gameId}`);
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
 * Hit-tested with `elementFromPoint` at each element's own centre rather
 * than by reading z-indexes, because a z-index is a claim and the hit test
 * is what the browser will actually do when a player's thumb lands there.
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
 * The felt and rail stop painting themselves only when the room is
 * genuinely there to replace them — and the DOM figures stay primary,
 * because the canvas paints furniture and chips, never people.
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
        // People are the DOM's job. The old sprite layer is gone; a hidden
        // figure now would mean nobody is drawing this player at all.
        figureVisible: figure ? getComputedStyle(figure).visibility !== "hidden" : false,
      };
    });
    expect(painted.lit).toBe(true);
    expect(painted.feltBackground).toBe("none");
    expect(painted.railBackground).toBe("none");
    expect(painted.feltBox).toBe(true);
    expect(painted.figureVisible).toBe(true);
  } finally {
    await context.close();
  }
});

/**
 * The room is fitted to the table's own plate, at whatever size the
 * viewport left it.
 *
 * `roomScale` is CSS pixels per world unit under the orthographic tilt, so
 * the exact relationship `scale = wrapWidth / (2 * feltRadiusX)` is
 * assertable directly — the closed-form fit either ran against the real
 * plate or it did not. Checked on two very different plates: a desktop
 * table and a portrait phone one, which is also what holds "mobile
 * responsive" to being a measured property rather than a hope.
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
      expect(fit.canvas).toBeGreaterThan(0);
      expect(fit.wrap).toBeGreaterThan(0);
      // The felt's world width is 18 units (2 * radiusX); its screen width
      // is pinned to the wrap. One part in fifty of slack covers a resize
      // landing between the measure and the assert.
      expect(fit.scale).toBeGreaterThan((fit.wrap / 18) * 0.98);
      expect(fit.scale).toBeLessThan((fit.wrap / 18) * 1.02);
    } finally {
      await context.close();
    }
  });
}

/**
 * An idle table stops drawing. The whole scheduler exists for this: between
 * one player acting and the next there is nothing moving on the felt, and a
 * loop that repainted a static room sixty times a second through those gaps
 * would cost a phone its battery for no frames anyone could tell apart.
 */
test("the render loop sleeps once the felt is still", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page } = await seatAtTable(context);
    // Wait out any dealing/settling motion, then watch the frame counter.
    const wentQuiet = await page.waitForFunction(() => {
      const scene = window.__stackchipsScene;
      return scene ? !scene.awake() : false;
    }, null, { timeout: 60_000 }).catch(() => null);
    expect(wentQuiet).not.toBeNull();
    const before = await page.evaluate(() => window.__stackchipsScene!.framesRendered());
    await page.waitForTimeout(1_200);
    const after = await page.evaluate(() => ({
      frames: window.__stackchipsScene!.framesRendered(),
      awake: window.__stackchipsScene!.awake(),
    }));
    // Asleep means asleep: zero frames across the window, not merely few —
    // unless something genuinely started moving again, in which case being
    // awake is the correct answer and the next quiet window will sleep.
    if (!after.awake) {
      expect(after.frames).toBe(before);
    }
  } finally {
    await context.close();
  }
});
