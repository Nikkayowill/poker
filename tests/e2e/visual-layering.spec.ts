import { expect, test, type Browser, type Page } from "@playwright/test";

type ViewportCase = {
  name: string;
  width: number;
  height: number;
  screenshot?: string;
};

const viewports: ViewportCase[] = [
  {
    name: "reference desktop",
    width: 1144,
    height: 846,
    screenshot: "artifacts/screenshots/table-layering-after-1144x846.png",
  },
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile landscape", width: 844, height: 390 },
  { name: "mobile portrait", width: 390, height: 844 },
];

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

async function openQuickTable(browser: Browser, viewport: ViewportCase) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const response = await context.request.post("/api/games/quick-play", {
    data: { name: "Visual QA", tier: "micro", buyIn: 500 },
  });
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  const page = await context.newPage();
  await page.goto(`/?table=${payload.game.id}`);
  // Returning/table links still pass through the one intentional entry
  // surface. The table opens only after the player chooses how to continue.
  await expect(page.locator(".account-entry-page")).toBeVisible();
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.locator(".poker-table-wrap")).toBeVisible();
  return { context, page };
}

async function verifyLocalLayout(page: Page) {
  const local = page.locator(".seat-first-person");
  const avatar = local.locator(".local-avatar-slot");
  const cards = local.locator(".own-cards");
  const plate = local.locator(".seat-plate");
  const actionBar = page.locator(".action-bar");

  await expect(avatar).toBeVisible();
  await expect(cards).toBeVisible();
  await expect(plate).toBeVisible();
  await expect(local.locator(".seat-turn-status")).toHaveCount(0);

  const [avatarBox, cardsBox, plateBox, actionBox] = await Promise.all([
    avatar.boundingBox(),
    cards.boundingBox(),
    plate.boundingBox(),
    actionBar.boundingBox(),
  ]);
  expect(avatarBox).not.toBeNull();
  expect(cardsBox).not.toBeNull();
  expect(plateBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(overlaps(avatarBox!, cardsBox!)).toBe(false);
  expect(cardsBox!.y + cardsBox!.height).toBeLessThanOrEqual(plateBox!.y);
  expect(plateBox!.y + plateBox!.height).toBeLessThanOrEqual(actionBox!.y);
}

async function verifyOpponentLayout(page: Page) {
  const seats = page.locator(".seat-ring");
  const count = await seats.count();
  for (let index = 0; index < count; index += 1) {
    const seat = seats.nth(index);
    const figure = seat.locator(".seat-figure");
    const cards = seat.locator(".seat-cards");
    const figureBox = await figure.boundingBox();
    const cardsBox = await cards.boundingBox();
    expect(figureBox).not.toBeNull();
    expect(figureBox!.y).toBeGreaterThanOrEqual(0);
    if (cardsBox) {
      // Card backs may cross the lower torso, but must remain below the face.
      expect(cardsBox.y).toBeGreaterThanOrEqual(figureBox!.y + figureBox!.height * 0.48);
    }
  }
}

test("table layers keep cards, portraits, status and controls in reserved space", async ({ browser }) => {
  for (const viewport of viewports) {
    const { context, page } = await openQuickTable(browser, viewport);
    try {
      await test.step(viewport.name, async () => {
        await verifyLocalLayout(page);
        await verifyOpponentLayout(page);
        const rearRailContent = await page.locator(".poker-table-wrap").evaluate((element) =>
          getComputedStyle(element, "::before").content,
        );
        expect(rearRailContent).toBe("none");
        if (viewport.screenshot) {
          await page.screenshot({ path: viewport.screenshot, fullPage: true });
        }
      });
    } finally {
      await context.close();
    }
  }
});
