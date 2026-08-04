import { expect, test } from "@playwright/test";

/**
 * The table feed is the only running account of the hand.
 *
 * The per-seat status pills that used to repeat it ("Folded", "calls 2000")
 * were removed -- they printed a variable-length string into a fixed slot
 * under an absolutely-positioned seat and ran out from under the table. So
 * this element now carries that information alone, and two things about it
 * are load-bearing rather than cosmetic:
 *
 *  - it has to be legible, which is a floor on font size, and
 *  - it cannot grow into a player, which is a ceiling on its box.
 *
 * Those pull against each other, and the second is measured, not chosen: at
 * 390px the top seat's box begins at x=147 while the feed starts at x=12.
 * Enlarging the feed to 46vw put it at x=174 and straight through that seat,
 * with every unit test still green. Only a layout assertion catches it.
 */
for (const viewport of [
  { name: "desktop", width: 1440, height: 900, minFontPx: 12 },
  { name: "portrait phone", width: 390, height: 844, minFontPx: 11 },
  // The short-viewport breakpoint used to drop the feed entirely. With the
  // seat pills gone that left a landscape phone with nowhere at all to read
  // what just happened, so it is back as a corner overlay and has to stay.
  { name: "landscape phone", width: 844, height: 390, minFontPx: 10 },
]) {
  test(`the table feed is readable and clear of every seat on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    try {
      // Claim a session first, then take a private table of our own. Quick
      // play draws on the shared cookieless games:create bucket and hands
      // back whatever table is currently matchmaking -- both of which make
      // this flaky only once the whole suite runs, which is exactly when a
      // layout guard is least useful. Same reasoning as chip-flights.spec.ts.
      await context.request.post("/api/profile");
      const response = await context.request.post("/api/games", {
        data: { name: "Feed QA", isPrivate: true, tier: "1k", buyIn: 1000 },
      });
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      const page = await context.newPage();
      await page.goto(`/?table=${payload.game.id}`);
      await page.getByRole("button", { name: "Play as guest" }).click();
      await expect(page.locator(".poker-table-wrap")).toBeVisible();

      const feed = page.locator(".table-feed");
      await expect(feed).toBeVisible();
      await expect(feed).toContainText("blinds");

      const measured = await page.evaluate(() => {
        const element = document.querySelector(".table-feed");
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const seats = [...document.querySelectorAll(".player-seat")]
          .map((seat) => seat.getBoundingClientRect());
        return {
          fontPx: Number.parseFloat(getComputedStyle(element).fontSize),
          width: box.width,
          height: box.height,
          collidingSeats: seats.filter((seat) =>
            box.left < seat.right && box.right > seat.left
            && box.top < seat.bottom && box.bottom > seat.top).length,
          // Nothing may be pushed off the left edge or past the viewport.
          insideViewport: box.left >= 0 && box.right <= window.innerWidth,
        };
      });

      expect(measured).not.toBeNull();
      expect(measured!.collidingSeats).toBe(0);
      expect(measured!.insideViewport).toBe(true);
      // A feed nobody can read is the defect this replaced, not a smaller
      // version of the fix.
      expect(measured!.fontPx).toBeGreaterThanOrEqual(viewport.minFontPx);
      expect(measured!.width).toBeGreaterThan(60);
      expect(measured!.height).toBeGreaterThan(12);
    } finally {
      await context.close();
    }
  });
}

test("no seat prints a status pill under itself any more", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.request.post("/api/profile");
    const response = await context.request.post("/api/games", {
      data: { name: "Pill QA", isPrivate: true, tier: "1k", buyIn: 1000 },
    });
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    const page = await context.newPage();
    await page.goto(`/?table=${payload.game.id}`);
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.locator(".poker-table-wrap")).toBeVisible();

    // The element and its styling are both gone; a stray rule left behind
    // would silently re-clip the moment anything re-added the class.
    await expect(page.locator(".status-pill")).toHaveCount(0);
    await expect(page.locator(".action-pill")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

/**
 * The feed still clears the ring if the table ever goes to eight seats.
 *
 * Recorded as defect D2 and then withdrawn -- see docs/known-defects.md. The
 * claim was that the 10:30 seat an eight-max ring introduces would land under
 * this plate on a phone. It does not, and the arithmetic that said otherwise
 * mixed two coordinate spaces: the seat position was computed relative to
 * .poker-table-wrap and compared against a feed measured from the top of the
 * viewport. The feed sits *above* the wrap on every viewport, so the two never
 * meet.
 *
 * This exists because that is a fact about the current layout rather than a
 * law, and the next person to move either element deserves to be told rather
 * than to re-derive it. The seat rectangle is computed here from the same
 * constants lib/game/table-geometry.ts uses, because SEAT_COUNT is still 6 and
 * there is no eight-max seat in the DOM to measure -- which is also why the
 * assertion above it, which measures real .player-seat boxes, cannot catch
 * this on its own.
 */
for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "portrait phone", width: 390, height: 844 },
  { name: "landscape phone", width: 844, height: 390 },
]) {
  test(`the feed clears an eight-max 10:30 seat on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    try {
      await context.request.post("/api/profile");
      const response = await context.request.post("/api/games", {
        data: { name: "Feed 8max QA", isPrivate: true, tier: "1k", buyIn: 1000 },
      });
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      const page = await context.newPage();
      await page.goto(`/?table=${payload.game.id}`);
      await page.getByRole("button", { name: "Play as guest" }).click();
      await expect(page.locator(".poker-table-wrap")).toBeVisible();
      await expect(page.locator(".table-feed")).toContainText("blinds");

      const clearance = await page.evaluate(() => {
        // Measured at the feed's maximum height, not at the one line a freshly
        // dealt table shows. A guard that only ever sees the empty case would
        // pass right up until the first busy hand.
        //
        // Exactly three entries, because that is the most that can ever exist:
        // poker-table.tsx renders `game.log.slice(0, 3)`. Beyond that the
        // stylesheet decides the height, and it decides differently per
        // viewport -- desktop keeps all three on one line each via nowrap and
        // ellipsis, portrait wraps each to at most two lines and hides the
        // third, and the short-viewport override shows only the first. Letting
        // CSS do that rather than assuming a line count is the whole point of
        // measuring it in a browser.
        const list = document.querySelector(".table-feed")!;
        list.innerHTML = "";
        for (let index = 0; index < 3; index += 1) {
          const item = document.createElement("li");
          item.textContent = "Bartholomew raises to 250,000 and Constantine calls it down";
          list.appendChild(item);
        }

        const feed = list.getBoundingClientRect();
        const wrap = document.querySelector(".poker-table-wrap")!.getBoundingClientRect();

        // The 10:30 slot of an eight-seat ring: 135 degrees back from the near
        // edge, on the ellipse radiiForTable() would pick for this box.
        const portrait = wrap.height > wrap.width;
        const rx = portrait ? 37 : wrap.width <= 620 ? 38 : 46;
        const ry = portrait ? 44 : 36;
        const centreX = wrap.left + ((50 - rx * Math.SQRT1_2) / 100) * wrap.width;
        const centreY = wrap.top + ((50 - ry * Math.SQRT1_2) / 100) * wrap.height;
        // seatWidthFor(table, 8): the six-max box scaled by the ratio of the
        // two rings' neighbour spacings.
        const base = Math.min(wrap.width * 0.26, wrap.height * 0.3);
        const size = Math.round(base * (Math.sin(Math.PI / 8) / Math.sin(Math.PI / 6)));
        const seat = {
          left: centreX - size / 2,
          right: centreX + size / 2,
          top: centreY - size / 2,
          bottom: centreY + size / 2,
        };

        const overlaps = feed.left < seat.right && feed.right > seat.left
          && feed.top < seat.bottom && feed.bottom > seat.top;
        return { overlaps, verticalGap: seat.top - feed.bottom };
      });

      expect(clearance.overlaps).toBe(false);
      // Not merely "does not overlap": a gap that has quietly shrunk to two
      // pixels is the same defect arriving next milestone.
      expect(clearance.verticalGap).toBeGreaterThan(16);
    } finally {
      await context.close();
    }
  });
}
