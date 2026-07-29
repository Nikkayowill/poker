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
