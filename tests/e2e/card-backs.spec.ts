import { expect, test } from "@playwright/test";

/**
 * M12. The catalog has sold seven card backs since the store shipped, and
 * every one of them was drawn on the felt as the same hardcoded green: the
 * design lived in 07-cards.css and the items lived in TypeScript, and nothing
 * connected them. These assertions all fail on that code.
 */

test("every seat deals from its own deck", async ({ browser }) => {
  // Covers waiting out a hand this player was seated too late to join.
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    /**
     * A private table, never a matchmade one — see the same note in
     * dealing.spec.ts. `/api/games/quick-play` is a shared pool, so a later
     * test in the run is matched onto an earlier test's table, seated
     * mid-hand (correctly sat out by `claimSeat`) and left waiting on a seat
     * whose human has already closed their browser. A table of this test's
     * own puts this player in seat 0 of hand 1. Nothing here is about
     * matchmaking; it is about what a card back is drawn as.
     */
    await context.request.post("/api/profile");
    const response = await context.request.post("/api/games", {
      data: { name: "Deck QA", isPrivate: true, tier: "1k", buyIn: 1000 },
    });
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    const page = await context.newPage();
    await page.goto(`/?table=${payload.game.id}`);
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.locator(".poker-table-wrap")).toBeVisible();
    // A hand this player is dealt into, not merely a rendered table.
    await expect(page.locator(".own-cards .dealt-card-shell")).toHaveCount(2, { timeout: 90_000 });
    await expect(page.locator(".seat-cards").first()).toBeVisible();

    const seats = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".player-seat")].map((seat) => ({
        isMine: seat.classList.contains("seat-mine"),
        backs: [...seat.querySelectorAll<HTMLElement>(".card-back")].map((back) => {
          const art = back.querySelector("svg.card-back-art");
          return {
            // The stock colour, read off the drawing itself rather than off a
            // class name -- a class would pass while the SVG rendered empty.
            base: art?.querySelector("rect")?.getAttribute("fill") ?? null,
            // Something has to be printed on it. A back with a base and no
            // pattern is a rectangle of colour, which is what a missing
            // pattern branch would silently produce.
            marks: art ? art.querySelectorAll("path, circle").length : 0,
          };
        }),
      })),
    );

    expect(seats).toHaveLength(6);

    // Your own cards are face up to you, so the local seat has no backs at
    // all. If this ever finds one, the redaction that hides opponents' cards
    // has started hiding yours.
    const mine = seats.filter((seat) => seat.isMine);
    expect(mine).toHaveLength(1);
    expect(mine[0].backs).toHaveLength(0);

    const opponents = seats.filter((seat) => !seat.isMine);
    for (const seat of opponents) {
      expect(seat.backs).toHaveLength(2);
      for (const back of seat.backs) {
        expect(back.base).toMatch(/^#[0-9a-f]{6}$/i);
        expect(back.marks).toBeGreaterThan(0);
      }
      // One deck per seat: a player's two hole cards are the same back.
      expect(seat.backs[0].base).toBe(seat.backs[1].base);
    }

    // The whole point of the item. Five bots showing one identical deck is
    // indistinguishable from the hardcoded back this replaced, and it is
    // exactly what a first-time player sees.
    const decks = new Set(opponents.map((seat) => seat.backs[0].base));
    expect(decks.size).toBeGreaterThan(1);

    // And it is not the old painted-on green, which had no SVG behind it at
    // all -- the negative case for every assertion above.
    const legacy = await page.locator(".card-back").first().evaluate((element) => ({
      hasArt: Boolean(element.querySelector("svg.card-back-art")),
      hasEmblem: Boolean(element.querySelector(".card-back-emblem")),
    }));
    expect(legacy).toEqual({ hasArt: true, hasEmblem: false });
  } finally {
    await context.close();
  }
});

/**
 * The budget here is deliberately generous, and it is a *wait* rather than a
 * tolerance -- nothing this test asserts is weakened by it.
 *
 * Driving to a flop means outlasting whatever the six bots do first, and the
 * suite runs serially against one long-lived dev server that never drops the
 * tables earlier specs created. By the time this runs, that process is
 * ticking dozens of them, and a loop that reaches a flop in 16s on an idle
 * server has been measured taking longer than 90s at the end of a full run --
 * failing on the clock while asserting nothing. Standalone runtime is
 * unchanged; this only stops the last specs in a run being punished for
 * being last.
 */
test("the board flips on a real deck, not a blank card", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    // Own the session before creating, and use a private table: quick-play
    // matches into any open public table, so in a full suite run this would
    // join a hand another spec had already started. See continuous-table.spec.
    await context.request.post("/api/profile");
    const created = await context.request.post("/api/games", {
      data: { name: "Deck QA Board", isPrivate: true, tier: "1k", buyIn: 1000 },
    });
    expect(created.ok()).toBe(true);
    const gameId = (await created.json()).game.id as string;

    const page = await context.newPage();
    await page.goto(`/?table=${gameId}`);
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.locator(".poker-table-wrap")).toBeVisible();

    // Drive to a flop rather than testing whatever happens to be on screen.
    // The first draft of this checked the board only `if` a flipper existed,
    // which on a preflop table asserts nothing at all and passes -- the same
    // shape of hole this suite has been caught by twice before.
    await expect(async () => {
      const check = page.getByRole("button", { name: /^(Check|Call)/ });
      if (await check.isEnabled({ timeout: 1_000 }).catch(() => false)) await check.click();
      await expect(page.locator(".community-card-flipper").first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 240_000 });

    // Your hole cards are face up and your back is shown to everyone but you,
    // so the half-second of the board's flip is the only time you ever see
    // the deck you bought. Structural rather than by colour: the guest starts
    // on the house deck, which several bots carry too.
    const board = await page.locator(".community-card-backface").first().evaluate((element) => {
      const art = element.querySelector("svg.card-back-art");
      return {
        base: art?.querySelector("rect")?.getAttribute("fill") ?? null,
        marks: art ? art.querySelectorAll("path, circle").length : 0,
      };
    });
    expect(board.base).toMatch(/^#[0-9a-f]{6}$/i);
    expect(board.marks).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
