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
      // on the cloth. Asserted as "no pixel of either overlaps the rail",
      // because the defect this replaced was an overlap and not an absence:
      // both elements were perfectly visible while the blinds line was drawn
      // across the top of the community card row.
      const overlap = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const rail = rect(".poker-rail");
        const intersects = (box: DOMRect | null) =>
          Boolean(box && rail
            && box.left < rail.right && box.right > rail.left
            && box.top < rail.bottom && box.bottom > rail.top);
        return {
          foundRail: Boolean(rail),
          pot: intersects(rect(".pot-display")),
          blinds: intersects(rect(".blind-structure")),
          // The chip-flight target stays behind on the felt; if this ever
          // stops overlapping the rail, chips are flying to the margin.
          anchorOnFelt: intersects(rect(".pot-anchor")),
        };
      });
      expect(overlap).toEqual({
        foundRail: true,
        pot: false,
        blinds: false,
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
