import { expect, test, type Page } from "@playwright/test";

/**
 * The Blackjack room: Loki and Finn, their table, and the game played on it.
 *
 * WHAT THIS FILE USED TO TEST, and why none of it is here any more. The
 * dealers were a three.js scene in a 560px rounded box dropped into the top of
 * the felt, so this spec asserted that a WebGL context came up, that two
 * projected muzzles agreed with a DOM speech bubble's tails, and that the
 * panel fell back to a flat drawing when no context was available. That whole
 * contract is gone with the renderer: there is no canvas, no GPU context and
 * no fallback path, because the room is four positioned 2D layers.
 *
 * What replaces it is the thing the old arrangement got wrong. The stage was a
 * picture of a room hung inside another room -- its own backdrop, its own
 * counter, decorative chips and cards painted on that counter, and a SECOND
 * flat drawing of the same two dogs forty pixels below it. The assertions
 * below are about there being ONE room now: the layers stack in one box, the
 * pair are drawn exactly once, the cloth's printed rules match the engine, and
 * nothing in the live game prints over the table it is played on.
 *
 * Layout arithmetic is what this file is for. vitest.config.ts collects only
 * lib/ and app/, so no unit test in the repo can see a grid row, a z-index or
 * two boxes overlapping -- which is exactly the class of bug that shipped the
 * duplicate dealer in the first place.
 */

const FELT = ".bj-felt";

async function openBlackjack(page: Page) {
  await page.goto("/games/blackjack");
  await expect(page.locator(FELT)).toBeVisible();
  // The room is server-rendered markup now, not a code-split renderer, so
  // there is nothing to wait for beyond the table's own first fetch settling
  // the Deal button into a real state.
  await expect(page.getByRole("button", { name: /^Deal/ })).toBeEnabled({ timeout: 20_000 });
}

/** A rect, in page coordinates, or a failure if the selector matched nothing. */
async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  expect(found, selector).not.toBeNull();
  return found!;
}

test("the room is one room: casino, cloth and dealers in a single box", async ({ page }) => {
  await openBlackjack(page);

  const felt = await box(page, FELT);
  for (const layer of [".bj-room", ".bj-surface", ".bj-dealers", ".bj-play"]) {
    const rect = await box(page, layer);
    // Inside the felt, on both axes. The old stage was a 560px island floating
    // in the middle of a 1280px table with its own background; every layer
    // here belongs to the same box.
    expect(rect.x, `${layer} left`).toBeGreaterThanOrEqual(felt.x - 1);
    expect(rect.x + rect.width, `${layer} right`).toBeLessThanOrEqual(felt.x + felt.width + 1);
    expect(rect.y, `${layer} top`).toBeGreaterThanOrEqual(felt.y - 1);
  }

  // The casino fills the whole room; the cloth and the dealers each take part
  // of it. A backdrop that stopped short of an edge would show the bare felt
  // colour through as a band.
  const room = await box(page, ".bj-room");
  expect(Math.round(room.width)).toBe(Math.round(felt.width));
  expect(Math.round(room.height)).toBe(Math.round(felt.height));
});

/**
 * The rail, which is the grid row boundary and the seam of the whole picture.
 *
 * The dealers sit in row one and the cloth in row two, and the cloth reaches
 * up PAST that boundary so its lip passes behind the dogs' paws. Get the sign
 * of that overlap wrong and the two halves read as two stacked bands rather
 * than one table -- which is what the old panel looked like.
 */
test("the dealers sit behind the table, overlapping it at the rail", async ({ page }) => {
  await openBlackjack(page);

  const dealers = await box(page, ".bj-dealers");
  const surface = await box(page, ".bj-surface");

  // They overlap: the cloth starts before the dealers' airspace ends.
  expect(surface.y).toBeLessThan(dealers.y + dealers.height);
  // But the cloth does not swallow them: it starts well below their tops.
  expect(surface.y).toBeGreaterThan(dealers.y + dealers.height * 0.4);
  // And the cloth runs to the bottom of the room.
  const felt = await box(page, FELT);
  expect(surface.y + surface.height).toBeGreaterThanOrEqual(felt.y + felt.height - 2);
});

/**
 * The pair are drawn ONCE.
 *
 * This is the regression guard for the specific defect that made the old stage
 * read as a television: the page rendered Loki and Finn in the 3D panel and
 * then again, forty pixels below, as a 34px flat crop beside the dealer's
 * hand -- two depictions in two art styles, both labelled "Loki & Finn".
 */
test("Loki and Finn appear exactly once on the page", async ({ page }) => {
  await openBlackjack(page);

  await expect(page.locator(".bj-dealer-pair")).toHaveCount(1);
  // Whatever the dealers' layer is drawn with, no OTHER part of the page may
  // draw them too. The hand row names them; it must not picture them.
  await expect(page.locator(".bj-hand-head .dealer-avatar")).toHaveCount(0);
  await expect(page.locator(".bj-hand-label").first()).toHaveText("Loki & Finn");
  // Named somewhere, so two dogs in bow ties have an explanation attached.
  await expect(page.locator(".bj-dealer-names")).toContainText("Loki");
  await expect(page.locator(".bj-dealer-names")).toContainText("Finn");
});

/**
 * The cloth's printed rules, which are a CLAIM and can therefore be wrong.
 *
 * The reference art for this table arrived printed with "INSURANCE PAYS 2 TO
 * 1" and "DEALER MUST HIT SOFT 17". This engine has no insurance and the
 * dealer stands on soft 17. The print is DOM text derived from the engine's
 * own constants precisely so it cannot drift; this asserts the rendered result
 * and, crucially, that it agrees with the page header a few inches above it.
 */
test("the felt says what the engine does, and agrees with the header", async ({ page }) => {
  await openBlackjack(page);

  const print = page.locator(".bj-felt-print");
  await expect(print).toContainText("BLACKJACK PAYS 3 TO 2");
  await expect(print).toContainText("DEALER STANDS ON SOFT 17");
  await expect(print).not.toContainText(/INSURANCE|SPLIT|SURRENDER|MUST HIT/i);

  // The two places this game states its rules must not contradict each other.
  await expect(page.locator(".bj-header-copy p")).toContainText("Dealer stands on soft 17");
  await expect(page.locator(".bj-header-copy p")).toContainText("Blackjack pays 3:2");

  // And no control offers a verb the cloth does not cover.
  await expect(page.getByRole("button", { name: /^(Split|Insurance|Surrender)$/ })).toHaveCount(0);
});

/**
 * Nothing in the live game prints over the table it is played on.
 *
 * `.bj-play`'s top padding is clearance for `.bj-felt-print`, and the two are
 * declared in different stylesheets -- so this is the assertion that catches
 * them drifting apart. It has already caught one: at the original padding the
 * dealer's name and total printed straight across "DEALER STANDS ON SOFT 17".
 */
test("the cards clear the cloth's lettering at every width", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const at = `${viewport.width}px`;
    await page.setViewportSize(viewport);
    await openBlackjack(page);

    const print = await box(page, ".bj-felt-print");
    const firstRow = await box(page, ".bj-hand-head");
    expect(print.y + print.height, `${at} print bottom vs first hand top`)
      .toBeLessThanOrEqual(firstRow.y + 1);

    // Both hands and the deal button still fit.
    await expect(page.locator(".bj-hand")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^Deal/ })).toBeVisible();

    // Nothing here may give the page a horizontal axis to scroll -- the
    // grid-minimum class of bug that made the landing page pan at 390px.
    const panned = await page.evaluate(() => {
      document.documentElement.scrollLeft = 80;
      const leaked = document.documentElement.scrollLeft;
      document.documentElement.scrollLeft = 0;
      return leaked;
    });
    expect(panned, `${at} horizontal pan`).toBe(0);
  }
});

/**
 * Tipping, which is a real mechanic and therefore a real money path.
 *
 * The rule the product asked for is that the pair do not ask straight away.
 * The cadence itself is unit-tested in lib/arcade/tipping.ts; what only a
 * browser can check is that the offer is genuinely absent from the first
 * screen a player sees, that clicking an amount debits exactly that amount,
 * and that having paid buys silence rather than a second ask.
 */
test("the dealers ask for a tip only after a few hands, and take exactly what is clicked", async ({ page }) => {
  test.slow();
  await openBlackjack(page);

  // Nothing on the first screen. A tip jar that greets you is one nobody reads.
  await expect(page.locator(".bj-bubble")).toHaveCount(0);

  const settle = async () => {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/arcade/blackjack") && r.request().method() === "POST"),
      page.getByRole("button", { name: /^Deal/ }).first().click(),
    ]);
    for (let guard = 0; guard < 8; guard += 1) {
      if (await page.locator(".bj-verdict-chip").count()) return;
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/blackjack/actions")),
        page.getByRole("button", { name: "Stand" }).click(),
      ]);
    }
  };

  // Two hands in, still silent.
  await settle();
  await settle();
  await expect(page.locator(".bj-bubble")).toHaveCount(0);

  // Three, and they ask.
  await settle();
  await expect(page.locator(".bj-bubble")).toHaveCount(1);
  await expect(page.locator(".bj-bubble-line")).toHaveText("Tip the dealer!");

  const goldBefore = Number(
    (await page.locator(".bj-meter .gold-balance strong").innerText()).replace(/[^0-9]/g, ""),
  );

  // The amounts are the ones the route accepts, not a hand-copied list.
  const amounts = page.locator(".bj-tip-amount");
  await expect(amounts).toHaveCount(3);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/arcade/tip")),
    amounts.nth(1).click(),
  ]);

  await expect(page.locator(".bj-bubble-line")).toContainText("Thank you");
  const goldAfter = Number(
    (await page.locator(".bj-meter .gold-balance strong").innerText()).replace(/[^0-9]/g, ""),
  );
  // Exactly the amount on the button. Not a fraction of it, not twice it.
  expect(goldBefore - goldAfter).toBe(100);

  /*
   * Paying buys quiet: the thanks is a beat, and the ask does not come back
   * behind it.
   *
   * The LENGTH of that quiet is deliberately not asserted here. A first cut
   * played one more hand to check the offer had not returned, and it hung the
   * whole suite for six minutes -- after three 1,000 stakes and a tip, a
   * losing session drops under the minimum, the Deal button becomes "Not
   * enough Gold", and the test sat waiting on a POST that a disabled button
   * was never going to send. That is a real property of the table and not
   * something to paper over with a bigger starting balance; the cooldown is a
   * pure function of counters and is walked over a whole 200-hand session in
   * lib/arcade/tipping.test.ts, which is where it belongs.
   */
  await expect(page.locator(".bj-bubble")).toHaveCount(0, { timeout: 8000 });
});
