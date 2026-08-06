import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`blind emphasis is clear on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    try {
      // Own a session first: the rate limiter keys on the session token and
      // only falls back to the source IP, so cookieless callers all share one
      // bucket in local dev. See tests/e2e/visual-layering.spec.ts.
      await context.request.post("/api/profile");
      const response = await context.request.post("/api/games/quick-play", {
        data: { name: "Blind QA", tier: "1k", buyIn: 1000 },
      });
      expect(response.ok()).toBe(true);
      const payload = await response.json();
      const page = await context.newPage();
      await page.goto(`/?table=${payload.game.id}`);
      await page.getByRole("button", { name: "Play as guest" }).click();
      await expect(page.locator(".poker-table-wrap")).toBeVisible();

      const structure = page.locator(".blind-structure");
      await expect(structure).toBeVisible();
      await expect(structure).toContainText("SB 5");
      await expect(structure).toContainText("BB 10");

      // The pot and the stakes read in the black space around the table, not
      // on the cloth. Asserted as an overlap and not an absence: the defect
      // this replaced had both elements perfectly visible while the blinds
      // line was drawn across the top of the community card row.
      //
      // Against the seats as well as the rail, because the rail alone is the
      // weaker claim and it passed while the pot was unreadable. The ring
      // overhangs the felt -- at 1440x900 the top seat begins 16px above
      // .poker-table-wrap -- so growing the table in the Slot 0 refactor
      // walked a player's head up into the HUD band and printed the pot
      // across it, 20px deep on desktop and 10px on a phone, with this
      // spec green throughout. A readout that clears the cloth but not the
      // person sitting at it has not cleared anything.
      const overlap = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const hits = (box: DOMRect | null, other: DOMRect | null) =>
          Boolean(box && other
            && box.left < other.right && box.right > other.left
            && box.top < other.bottom && box.bottom > other.top);
        const rail = rect(".poker-rail");
        const seats = [...document.querySelectorAll(".player-seat")]
          .map((seat) => seat.getBoundingClientRect());
        const clearOfSeats = (selector: string) => {
          const box = rect(selector);
          return Boolean(box) && !seats.some((seat) => hits(box, seat));
        };
        return {
          foundRail: Boolean(rail),
          seatCount: seats.length,
          potOnRail: hits(rect(".pot-display"), rail),
          blindsOnRail: hits(rect(".blind-structure"), rail),
          potClearOfSeats: clearOfSeats(".pot-display"),
          blindsClearOfSeats: clearOfSeats(".blind-structure"),
          feedClearOfSeats: clearOfSeats(".table-feed"),
          // The chip-flight target stays behind on the felt; if this ever
          // stops overlapping the rail, chips are flying to the margin.
          anchorOnFelt: hits(rect(".pot-anchor"), rail),
        };
      });
      expect(overlap).toEqual({
        foundRail: true,
        seatCount: 6,
        potOnRail: false,
        blindsOnRail: false,
        potClearOfSeats: true,
        blindsClearOfSeats: true,
        feedClearOfSeats: true,
        anchorOnFelt: true,
      });
      await expect(page.locator(".seat-small-blind .blind-label")).toBeVisible();
      await expect(page.locator(".seat-big-blind .blind-label")).toBeVisible();

      const avatarWidths = await page.locator(".seat-ring .seat-figure").evaluateAll((figures) =>
        figures.map((figure) => figure.getBoundingClientRect().width),
      );
      expect(Math.max(...avatarWidths) - Math.min(...avatarWidths)).toBeLessThan(1);

      const scene = await page.locator(".game-shell").evaluate((element) => ({
        backgroundPanel: getComputedStyle(element, "::before").display,
        railTransform: getComputedStyle(element.querySelector(".poker-rail")!).transform,
      }));
      expect(scene.backgroundPanel).toBe("none");
      expect(scene.railTransform).not.toBe("none");
    } finally {
      await context.close();
    }
  });
}
