import { expect, test, type Page } from "@playwright/test";

/**
 * Two contracts M5 introduced, both of which rot silently.
 *
 * "Buttons never move" is invisible in a screenshot -- every individual frame
 * looks correct, and only the difference between two of them is wrong. And
 * defect D1 (the local nameplate ending up underneath the controls at
 * 390x844) came back green on every layout assertion the suite had, because
 * nothing put the player on turn with the raise controls open, which is the
 * only state where it happened.
 */

async function openTable(page: Page, request: Page["request"]) {
  // Private, so table matchmaking cannot hand this spec a table another spec
  // left behind -- see tests/e2e/visual-layering.spec.ts for the same reason.
  const response = await request.post("/api/games", {
    data: { name: "Action QA", isPrivate: true, tier: "1k", buyIn: 1000 },
  });
  expect(response.ok()).toBe(true);
  const { game } = await response.json();
  await page.goto(`/?table=${game.id}`);
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.locator(".poker-table-wrap")).toBeVisible();
}

/** Bots act on their own deadlines, so the first turn is a wait, not a click. */
async function waitForMyTurn(page: Page) {
  await expect(page.locator(".action-bar-your-turn")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".action-slot-controls button").first()).toBeEnabled();
}

const controls = (page: Page) => page.locator(".action-slot-controls button");

test("the three decisions keep their slots whatever is legal", async ({ page }) => {
  await openTable(page, page.request);

  // Three buttons exist before it is anyone's turn to act on them. The old bar
  // rendered each conditionally, so Call slid into the slot Check had been in
  // and whichever you had learned to reach for, the other was under your thumb.
  await expect(controls(page)).toHaveCount(3);

  await waitForMyTurn(page);
  await expect(controls(page)).toHaveCount(3);

  const labels = await controls(page).allTextContents();
  expect(labels[0]).toContain("Fold");
  expect(labels[1]).toMatch(/Check|Call/);
  expect(labels[2]).toMatch(/Bet \/ Raise|All in/);
});

test("opening the raise controls does not move the buttons", async ({ page }) => {
  await openTable(page, page.request);
  await waitForMyTurn(page);

  const before = await controls(page).evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) };
    }),
  );

  const raise = controls(page).nth(2);
  if (await raise.getAttribute("aria-expanded")) {
    await raise.click();
    await expect(page.locator(".raise-drawer")).toBeVisible();

    /**
     * toBeVisible() is not enough, and this is the assertion that would have
     * caught the real bug: a stale `.action-bar { overflow: hidden }` in
     * 08-seat.css clipped the drawer away entirely, while
     * getBoundingClientRect still returned a full-size box. Playwright called
     * that visible; a player saw nothing at all. Hit-testing the centre point
     * is the difference between "has a box" and "is on screen".
     */
    const paintedAtCentre = await page.locator(".raise-drawer").evaluate((drawer) => {
      const box = drawer.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return Boolean(hit && drawer.contains(hit));
    });
    expect(paintedAtCentre).toBe(true);

    const after = await controls(page).evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) };
      }),
    );
    // The whole point of opening over the felt rather than inside the bar.
    expect(after).toEqual(before);
  }
});

/**
 * Honest about its own strength: this pins the invariant but is not a proven
 * regression guard. Reverting M5's fix (putting the raise drawer back inside
 * the bar) does NOT make it fail, because the ResizeObserver on the bar
 * re-measures foregroundDrop and the plate follows the table upward. The
 * original defect needed the reserve to be wrong as well, which deriving it
 * from the chrome and bar heights now prevents by construction. Keep it as a
 * canary; the test above is the one that actually bites.
 */
test("D1: the nameplate stays above the controls at 390x844, raise open", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await openTable(page, context.request as unknown as Page["request"]);
    await waitForMyTurn(page);

    const raise = controls(page).nth(2);
    if (await raise.getAttribute("aria-expanded")) {
      await raise.click();
      await expect(page.locator(".raise-drawer")).toBeVisible();
    }

    const plate = await page.locator(".seat-mine .seat-plate").boundingBox();
    const bar = await page.locator(".action-bar").boundingBox();
    expect(plate).not.toBeNull();
    expect(bar).not.toBeNull();
    // Measured 666.44 against a bar top of 614 when this was broken.
    expect(plate!.y + plate!.height).toBeLessThanOrEqual(bar!.y);

    // And the bar itself has to stay on screen, which is what the fixed height
    // and the derived --table-reserve exist to guarantee.
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(844);
  } finally {
    await context.close();
  }
});
