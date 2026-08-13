import { expect, test } from "@playwright/test";

/**
 * The local player has to be able to see their own chips go out.
 *
 * Slot 0 is the only chair with a figure standing between it and the pot —
 * below 901px. Every `.seat-figure` is a square box centred on the DOM
 * ellipse with its artwork anchored to the base, so a figure occupies the
 * space *above* its seat — which for the five opponents points away from the
 * table, and for the near seat points straight across the felt at its own
 * bet spot. The canvas cannot win that overlap: `.table-scene` is
 * `z-index: 0` and `.seat-figure` is `z-index: 4` and up, so a bet landing
 * inside that box is simply painted over. Measured at 1440x900 before the
 * fix, the near bet spot sat 64px inside the local player's own avatar, at
 * about chest height.
 *
 * Desktop (`min-width: 901px`) has since dropped that figure altogether —
 * the avatar moved to `local-player-hud.tsx`'s corner card — so there is
 * nothing left there to clear, and `NEAR_SEAT_BET_INSET_DESKTOP`
 * (`lib/scene/seat-ring.ts`) instead pushes the near seat's own reach out to
 * match every opponent's. That plate skips the figure check below and just
 * confirms the board is still clear by a wide margin.
 *
 * This is asserted against the *rendered* boxes rather than recomputed from
 * the constants, because that is the whole failure mode: the canvas and the
 * DOM each agreed with themselves. `betSpot` on the scene seam projects the
 * same world point the chips actually fly to, so the two systems are being
 * compared rather than one of them being restated.
 *
 * FORCED TO `canvas_2d`. The table renderer defaults to the 3D room
 * (`DEFAULT_TABLE_RENDERER`, `lib/scene/table-renderer.ts`), which mounts a
 * differently-sized rail than the classic table this file is about — every
 * viewport below sets the stored preference before navigating, or these
 * geometry numbers describe whichever renderer happened to win the race.
 */

/** Roughly half a chip's painted face, in CSS pixels per unit of room scale. */
const CHIP_FACE_RADIUS_WORLD = 0.4;

const VIEWPORTS = [
  /**
   * `corridor` means this plate has room between the board and the near
   * figure for the chips to sit in. A landscape phone does not — the board's
   * box already ends *below* where the figure's box begins, so the two
   * overlap before any chip is placed. See `NEAR_SEAT_BET_INSET`, and
   * `POT_DEPTH_FRACTION` for the same limit hitting the pot. `figureHidden`
   * is desktop alone — see the header above.
   */
  { name: "desktop", width: 1440, height: 900, corridor: true, figureHidden: true },
  { name: "portrait phone", width: 390, height: 844, corridor: true, figureHidden: false },
  { name: "landscape phone", width: 844, height: 390, corridor: false, figureHidden: false },
];

for (const viewport of VIEWPORTS) {
  test(`the local player's bet clears their own figure — ${viewport.name}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    // See the file header: the stored raw value, not a JSON-encoded one --
    // normalizeTableRenderer matches the bare string against TABLE_RENDERERS.
    await context.addInitScript(() => {
      window.localStorage.setItem("stackchips:table-renderer", "canvas_2d");
    });

    try {
      // Claim a session first, so this does not draw on the shared cookieless
      // games:create bucket — see the note in continuous-table.spec.ts.
      await context.request.post("/api/profile");
      const created = await context.request.post("/api/games", {
        data: { name: "Near seat QA", isPrivate: true, tier: "1k", buyIn: 1000 },
      });
      expect(created.ok()).toBe(true);
      const gameId = (await created.json()).game.id as string;

      const page = await context.newPage();
      await page.goto(`/?table=${gameId}`);
      await page.getByRole("button", { name: "Play as guest" }).click();
      await expect(page.locator(".poker-table-wrap")).toBeVisible();
      // The room is code-split, so it arrives a beat after the table does.
      await page.waitForFunction(() => Boolean(window.__stackchipsScene), null, { timeout: 30_000 });

      const bet = await page.evaluate(() => window.__stackchipsScene!.betSpot(0));
      const room = await page.evaluate(() => ({
        scale: window.__stackchipsScene!.roomScale(),
        felt: window.__stackchipsScene!.roomFelt(),
      }));

      // The local player's own figure: the one seat rendered `.seat-mine`.
      // Deliberately not DOM order — `orderedSeats` rotates the local player
      // to index 0, so `.last()` selects the seat *opposite* and the sanity
      // check below fails by half a table width.
      //
      // Desktop drops this figure entirely (16-first-person.css,
      // `min-width: 901px`) — nothing left to clear, so nothing to measure.
      const figure = viewport.figureHidden
        ? null
        : await page.locator(".player-seat.seat-mine .seat-figure").boundingBox();
      if (!viewport.figureHidden) {
        expect(figure).not.toBeNull();

        // Sanity: the two systems are talking about the same column of the
        // screen, or "clears vertically" would be meaningless.
        const figureCentreX = figure!.x + figure!.width / 2;
        expect(Math.abs(bet.x - figureCentreX)).toBeLessThan(figure!.width);
      }

      // The board's *cards*, not `.community-cards` — that container carries
      // 7px of padding and a translucent panel, so its box overstates by a
      // chip's worth what the chips actually have to stay below.
      const cards = await page.locator(".community-card-shell").last().boundingBox();
      expect(cards).not.toBeNull();

      // A chip is a disc lying on the felt, so its face reaches this far
      // above the point it is centred on.
      const chipTop = bet.y - CHIP_FACE_RADIUS_WORLD * room.scale * Math.sin((38 * Math.PI) / 180);
      const figureClearance = figure ? figure.y - bet.y : null;
      const boardClearance = chipTop - (cards!.y + cards!.height);

      console.log(
        `${viewport.name}: bet y=${bet.y.toFixed(0)} | figure top `
        + `${figure ? figure.y.toFixed(0) : "n/a (hidden)"} `
        + `(clear ${figureClearance === null ? "n/a" : figureClearance.toFixed(0) + "px"}) `
        + `| cards bottom ${(cards!.y + cards!.height).toFixed(0)} (clear ${boardClearance.toFixed(0)}px)`,
      );

      if (viewport.figureHidden) {
        // No figure left to protect against — the near seat reaches out to
        // BET_INSET like every opponent now (NEAR_SEAT_BET_INSET_DESKTOP),
        // so the board should clear by a wide margin rather than the few
        // pixels the old figure-avoiding corridor left. Regression guard: if
        // this silently reverted to the tight corridor, that margin would
        // collapse toward single digits or go negative (see the comment on
        // the non-corridor branch below for the same table without the fix).
        expect(boardClearance).toBeGreaterThan(60);
      } else if (viewport.corridor) {
        // Above the figure's crown: the chips are on open felt, not behind a
        // chest. This is the assertion the whole file exists for.
        expect(figureClearance).toBeGreaterThan(0);
        // And still below the board — a bet belongs between its player and
        // the pot, never stacked on the flop.
        expect(boardClearance).toBeGreaterThan(0);
      } else {
        /**
         * No corridor exists on this plate, so absolute clearance is not
         * available to assert. What must stay true is that the near seat is
         * still pulled well clear of where the ordinary inset put it —
         * otherwise a future edit could quietly revert the fix here while the
         * other two viewports kept passing.
         *
         * `roomFelt().height` is `2 * radiusZ * TILT_SIN * scale`, so half of
         * it converts an inset delta straight into screen pixels.
         */
        const ordinaryInsetY = bet.y + (0.74 - 0.35) * (room.felt.height / 2);
        expect(bet.y).toBeLessThan(ordinaryInsetY);
        expect(ordinaryInsetY - bet.y).toBeGreaterThan(20);
        // And it must not have overshot past the board into the far half.
        expect(bet.y).toBeGreaterThan(cards!.y);
      }
    } finally {
      await context.close();
    }
  });
}
