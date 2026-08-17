import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The 2.5D table is landscape-only. Portrait is a client-side orientation
 * gate; the disabled Classic implementation is not mounted.
 *
 * `resolveTableRenderer` is pure and covered in `table-renderer.test.ts`. What
 * is only true in a browser is that the orientation actually reaches it: the
 * value comes from a `matchMedia` subscription (`useLandscape`), and a
 * subscription that never fires looks exactly like one that does until the
 * device is turned. The rotation case below is the one that matters — a
 * snapshot taken once at mount would pass every other assertion here.
 */

const TABLE = { name: "Racetrack QA", isPrivate: true, tier: "1k", buyIn: 1000 };
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

/** The class the table wears only when the racetrack room is the one mounted. */
const RACETRACK_CLASS = "scene-room-racetrack";

async function seatWithRacetrackChosen(browser: Browser, size: { width: number; height: number }) {
  const context = await browser.newContext({ viewport: size });
  await context.request.post("/api/profile");
  const created = await context.request.post("/api/games", { data: TABLE });
  expect(created.ok()).toBe(true);
  const gameId = (await created.json()).game.id as string;
  // Set before the first paint: poker-table.tsx holds a blank frame until the
  // stored choice lands, then mounts exactly one room.
  await context.addInitScript(() => {
    window.localStorage.setItem("stackchips:table-renderer", "racetrack_2d5");
  });
  const page = await context.newPage();
  await page.goto(`/?table=${gameId}`);
  await expect(page.locator(".poker-table-wrap")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__stackchipsScene), null, { timeout: 60_000 });
  return { context, page };
}

const roomClass = (page: Page) =>
  page.evaluate(() => document.querySelector(".table-area")?.className ?? "");

test("the 2.5D table returns after the portrait mobile fallback", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await seatWithRacetrackChosen(browser, PORTRAIT);
  try {
    await expect(page.getByRole("status")).toContainText("Turn your phone sideways");
    await expect.poll(() => roomClass(page), { timeout: 20_000 }).not.toContain(RACETRACK_CLASS);

    // Rotate. No reload, and that is the assertion: the preference was never
    // rewritten, so the room comes back the moment the media query flips.
    await page.setViewportSize(LANDSCAPE);
    await expect.poll(() => roomClass(page), { timeout: 20_000 }).toContain(RACETRACK_CLASS);

    // ...and back, so the orientation gate returns without changing the
    // stored 2.5D preference.
    await page.setViewportSize(PORTRAIT);
    await expect(page.getByRole("status")).toContainText("Turn your phone sideways");
    await expect.poll(() => roomClass(page), { timeout: 20_000 }).not.toContain(RACETRACK_CLASS);

    // The stored choice survived the whole trip untouched.
    const stored = await page.evaluate(() => window.localStorage.getItem("stackchips:table-renderer"));
    expect(stored).toBe("racetrack_2d5");
  } finally {
    await context.close();
  }
});

test("the buy-in preselect offers only 2.5D", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const size of [LANDSCAPE, PORTRAIT]) {
    const context = await browser.newContext({ viewport: size });
    try {
      await context.request.post("/api/profile");
      const page = await context.newPage();
      await page.goto("/");
      await page.locator("button.hub-tile-play:not([disabled])").click({ timeout: 30_000 });

      const segment = page.locator(".buyin-renderer .entry-segment");
      await expect(segment).toBeVisible({ timeout: 20_000 });
      expect(await segment.locator("button").allInnerTexts()).toEqual(["2.5D"]);

      /* Disabled rather than hidden, so the control keeps one shape across a
         rotation and the note underneath can explain the absence. */
      const twoAndAHalf = segment.getByRole("button", { name: "2.5D" });
      if (size.height > size.width) await expect(twoAndAHalf).toBeDisabled();
      else await expect(twoAndAHalf).toBeEnabled();
    } finally {
      await context.close();
    }
  }
});
