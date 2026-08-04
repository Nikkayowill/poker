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
