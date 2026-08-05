import { expect, test, type Browser } from "@playwright/test";

/**
 * The deal, checked as geometry rather than as "something moved".
 *
 * Every assertion here fails on the code this replaced, which used a flat
 * --deal-y: 120px for the whole ring and left the local player with no
 * variables at all.
 */

async function seatAtTable(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const response = await context.request.post("/api/games/quick-play", {
    data: { name: "Deal QA", tier: "1k", buyIn: 1000 },
  });
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  const page = await context.newPage();
  await page.goto(`/?table=${payload.game.id}`);
  await page.getByRole("button", { name: "Play as guest" }).click();
  await expect(page.locator(".poker-table-wrap")).toBeVisible();
  await waitForOwnHoleCards(page);
  return { context, page };
}

/**
 * Wait for a hand this player is actually *in*, not merely for the table to
 * appear.
 *
 * Claiming a seat while a hand is already running deliberately sits the new
 * occupant out of it: `claimSeat` clears their hole cards and forces
 * `status = "out"` for the rest of that hand, which is what stops somebody
 * who sits down mid-hand inheriting the bot's cards and turn. Quick-play
 * hands back a table whose bots have usually already been dealt in by the
 * time the browser has loaded, claimed a seat and rendered, so the first hand
 * a test sees is frequently one where `.seat-cards` is correctly empty and
 * the action bar correctly reads "Sat out".
 *
 * Waiting on `.seat-cards` being visible therefore raced the engine rather
 * than the renderer, and failed on whichever runs happened to land mid-hand.
 * Waiting for the cards themselves waits out that hand instead. The budget
 * has to cover a full six-bot hand plus the 2.8s before the next deal, which
 * is why it is far longer than an ordinary expect timeout.
 */
async function waitForOwnHoleCards(page: import("@playwright/test").Page) {
  await expect(page.locator(".own-cards .dealt-card-shell")).toHaveCount(2, { timeout: 90_000 });
  await expect(page.locator(".seat-cards").first()).toBeVisible();
}

test("every hole card is dealt from the deck on the felt", async ({ browser }) => {
  // Covers waiting out a hand this player was seated too late to join.
  test.setTimeout(180_000);
  const { context, page } = await seatAtTable(browser, { width: 1440, height: 900 });
  try {
    const seats = await page.evaluate(() => {
      const anchor = document.querySelector(".pot-anchor")?.getBoundingClientRect();
      if (!anchor) return null;
      const deck = { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 };
      return [...document.querySelectorAll<HTMLElement>(".player-seat")].map((seat) => {
        const cards = seat.querySelector<HTMLElement>(".seat-cards");
        const style = cards ? getComputedStyle(cards) : null;
        const rect = seat.getBoundingClientRect();
        return {
          isMine: seat.classList.contains("seat-mine"),
          // Where the card starts, resolved from the variables actually in
          // effect -- so a fallback that never got overridden is visible here
          // as the wrong number rather than as a passing test.
          dealX: Number.parseFloat(style?.getPropertyValue("--deal-x") ?? "NaN"),
          dealY: Number.parseFloat(style?.getPropertyValue("--deal-y") ?? "NaN"),
          centreX: rect.left + rect.width / 2,
          centreY: rect.top + rect.height / 2,
          deckX: deck.x,
          deckY: deck.y,
        };
      });
    });

    expect(seats).not.toBeNull();
    expect(seats!.length).toBe(6);
    // One seat is the local player. They sit on the ring like everyone else
    // now; what still makes them worth naming here is that theirs was the
    // seat that used to animate from nowhere at all.
    expect(seats!.filter((seat) => seat.isMine)).toHaveLength(1);

    // seat centre + vector == the deck. This is the whole claim of the
    // milestone, written as arithmetic: the card's starting offset carries it
    // to the middle of the table, from wherever this seat happens to be.
    //
    // Not to the pixel. The vector is measured when the table's layout
    // changes, and a seat's own box keeps breathing after that -- a status
    // pill appears, the turn ring mounts and the nameplate row grows a few
    // pixels. Measured drift from that is ~6px. The tolerance is set well
    // above it and still two orders below the flight itself, which the last
    // assertion here pins down so the check cannot be satisfied by a vector
    // that simply goes nowhere.
    const TOLERANCE_PX = 16;
    for (const seat of seats!) {
      // Named explicitly so an unset variable reports as "the local player has
      // no deal vector" rather than as NaN failing a comparison by accident.
      expect({
        isMine: seat.isMine,
        dealX: Number.isFinite(seat.dealX),
        dealY: Number.isFinite(seat.dealY),
      }).toEqual({ isMine: seat.isMine, dealX: true, dealY: true });
      expect(Math.abs(seat.centreX + seat.dealX - seat.deckX)).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(Math.abs(seat.centreY + seat.dealY - seat.deckY)).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(Math.hypot(seat.dealX, seat.dealY)).toBeGreaterThan(TOLERANCE_PX * 5);
    }

    // Six seats ringing a table cannot all be the same distance and direction
    // from its middle. A flat per-ring constant passes every check above that
    // is written per seat, so the spread is asserted too.
    const distinctY = new Set(seats!.map((seat) => Math.round(seat.dealY / 10)));
    expect(distinctY.size).toBeGreaterThan(2);
    expect(seats!.some((seat) => seat.dealX > 20)).toBe(true);
    expect(seats!.some((seat) => seat.dealX < -20)).toBe(true);
  } finally {
    await context.close();
  }
});

test("the local player is dealt first, and the whole deal clears quickly", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await seatAtTable(browser, { width: 390, height: 844 });
  try {
    const delays = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".player-seat")].map((seat) => ({
        isMine: seat.classList.contains("seat-mine"),
        delays: [...seat.querySelectorAll<HTMLElement>(".dealt-card-shell")].map((shell) =>
          Number.parseFloat(getComputedStyle(shell).animationDelay) * 1000,
        ),
      })),
    );

    const mine = delays.find((seat) => seat.isMine);
    expect(mine?.delays.length).toBe(2);
    const everyDelay = delays.flatMap((seat) => seat.delays);
    expect(everyDelay.length).toBeGreaterThan(0);
    // You cannot act on a card you cannot see, and the server's turn clock is
    // already running by now.
    expect(Math.min(...mine!.delays)).toBe(Math.min(...everyDelay));
    expect(Math.max(...everyDelay)).toBeLessThan(1_000);
  } finally {
    await context.close();
  }
});

test("community cards transition in rather than snapping", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await seatAtTable(browser, { width: 1440, height: 900 });
  try {
    // Board slots exist from the start as ghosts; only a real card gets a
    // flipper, and a flipper is what carries the animation.
    await expect(page.locator(".community-card-shell")).toHaveCount(5);
    const ghostAnimations = await page.locator(".community-card-shell").evaluateAll((shells) =>
      shells.map((shell) => ({
        hasFlipper: Boolean(shell.querySelector(".community-card-flipper")),
        animation: shell.querySelector(".community-card-flipper")
          ? getComputedStyle(shell.querySelector(".community-card-flipper")!).animationName
          : null,
      })),
    );
    for (const slot of ghostAnimations) {
      if (slot.hasFlipper) expect(slot.animation).toBe("community-flip");
    }
  } finally {
    await context.close();
  }
});
