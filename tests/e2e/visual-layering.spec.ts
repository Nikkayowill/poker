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

async function openIsolatedTable(browser: Browser, viewport: ViewportCase) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  // A private table, deliberately, rather than quick play.
  //
  // Quick play seats you at the oldest open *public* table at this tier, so
  // the moment any other spec file leaves one behind, this one stops
  // measuring what it thinks it is measuring: it inherits that table at
  // whatever street, turn and seat those tests left it in. That is not a
  // layout this file asserts anything about, and it made the suite's result
  // depend on file order. findOpenPublicGame filters on is_private, so a
  // private table can never be handed to another test -- every viewport
  // below now gets its own fresh six-max table with this context at seat 0.
  const response = await context.request.post("/api/games", {
    data: { name: "Visual QA", isPrivate: true, tier: "1k", buyIn: 1000 },
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

  await expect(avatar).toBeVisible();
  await expect(cards).toBeVisible();
  await expect(plate).toBeVisible();
  await expect(local.locator(".seat-turn-status")).toHaveCount(0);

  // One synchronous pass in the page, not four round trips.
  //
  // ActionBar is keyed on game.version, so it remounts every time the table
  // moves -- and since continuous play landed, the table moves on its own
  // whether or not this test is doing anything. Four separate boundingBox()
  // calls could therefore read four different renders, and the bar's node
  // could be detached by the time its turn came, which surfaced as a null box
  // and a test that passed alone and failed in the suite. Comparing four
  // rectangles only means something if they were all measured at once anyway.
  const boxes = await page.evaluate(() => {
    const read = (selector: string, root: ParentNode = document) => {
      const element = root.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const seat = document.querySelector(".seat-first-person");
    return {
      avatarBox: seat ? read(".local-avatar-slot", seat) : null,
      cardsBox: seat ? read(".own-cards", seat) : null,
      plateBox: seat ? read(".seat-plate", seat) : null,
      actionBox: read(".action-bar"),
    };
  });
  const { avatarBox, cardsBox, plateBox, actionBox } = boxes;
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
    const { context, page } = await openIsolatedTable(browser, viewport);
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
