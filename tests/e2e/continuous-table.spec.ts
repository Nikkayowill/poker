import { expect, test } from "@playwright/test";

/**
 * The loop, end to end: a browser that is only sitting there watching still
 * gets a second hand.
 *
 * Everything below the surface is unit-tested with injected time. What this
 * covers is the part injected time cannot -- that a real page schedules the
 * real request against the real deadline, and that nothing in the route or
 * the store rejects it. The only interaction is one fold; after that the test
 * touches nothing and reads state out of band.
 */

test("a table deals the next hand on its own, with no player input", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  try {
    // Claim a guest session before creating anything. Rate limits key on the
    // river_session cookie when there is one and fall back to the source IP
    // when there is not -- and games:create allows ten per five minutes. Every
    // spec's first request is cookieless, so they all share one IP bucket, and
    // adding an eleventh create to the suite made whichever spec asked last
    // get a 429 with no game to render. Costs one request and takes this test
    // out of that shared pool entirely.
    await context.request.post("/api/profile");

    // A private table, not quick-play. Quick-play matches into any open public
    // table, so run as part of the suite this joined one another spec had
    // already started -- mid-hand, someone else on the clock, Fold disabled.
    // Passing alone and failing in the suite is the signature of that.
    const created = await context.request.post("/api/games", {
      data: { name: "Loop QA", isPrivate: true, tier: "1k", buyIn: 1000 },
    });
    expect(created.ok()).toBe(true);
    const gameId = (await created.json()).game.id as string;

    const page = await context.newPage();
    await page.goto(`/?table=${gameId}`);
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.locator(".poker-table-wrap")).toBeVisible();

    // Read through the API rather than the DOM: handNumber is not rendered,
    // and going through the page's own context means the same session cookie
    // without ever driving the UI.
    const snapshot = async () => {
      const response = await context.request.get(`/api/games/${gameId}`);
      return (await response.json()).game as {
        status: string;
        handNumber: number;
        nextHandAt: string | null;
      };
    };

    const until = async (
      predicate: (game: Awaited<ReturnType<typeof snapshot>>) => boolean,
      budgetMs: number,
    ) => {
      const deadline = Date.now() + budgetMs;
      let latest = await snapshot();
      while (Date.now() < deadline) {
        if (predicate(latest)) return latest;
        await page.waitForTimeout(500);
        latest = await snapshot();
      }
      return latest;
    };

    // One interaction, and only so the test is not sitting out a human turn
    // clock -- which this suite deliberately configures to two minutes.
    // Waited for rather than probed: an isEnabled() check that runs before
    // the bar has settled silently skips the fold, and then the table really
    // is just waiting for a player, which is not what is being measured.
    const foldButton = page.getByRole("button", { name: "Fold" });
    await expect(foldButton).toBeEnabled({ timeout: 30_000 });
    await foldButton.click();

    const completed = await until((game) => game.status === "complete", 90_000);
    expect(completed.status).toBe("complete");
    // The deadline is the mechanism; if it is absent the rest is luck.
    expect(completed.nextHandAt).not.toBeNull();
    const finishedHand = completed.handNumber;

    const dealt = await until(
      (game) => game.handNumber > finishedHand && game.status === "playing",
      30_000,
    );
    expect(dealt.handNumber).toBeGreaterThan(finishedHand);
    expect(dealt.status).toBe("playing");
    expect(dealt.nextHandAt).toBeNull();
  } finally {
    await context.close();
  }
});
