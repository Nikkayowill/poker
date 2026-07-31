import { expect, test } from "@playwright/test";

/**
 * The pot has to land on the player who won it.
 *
 * Every distance in these animations is measured at runtime, which sounds
 * self-correcting and is not: the vector is measured from .pot-anchor, but
 * where a chip *starts* is a CSS declaration, and for as long as the funnel
 * has existed those two were different points on the felt. The chips flew the
 * right distance in the right direction from the wrong place, so they stopped
 * short of every seat they were paid to -- measured at 1440x900, fifty pixels
 * above the winner's chip stack. Nothing failed; it just looked slightly off,
 * and only if you knew where to look.
 *
 * So this asserts the arithmetic that matters -- a chip's last frame is on
 * the winner -- rather than that chips exist.
 */
test("the pot lands on the winner it was paid to", async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Every funnel chip frozen on its final keyframe. That transform is the
  // landing point, so a frozen chip's centre is exactly where it vanishes.
  await context.addInitScript(() => {
    const apply = () => {
      const style = document.createElement("style");
      style.textContent = `.pot-chip-flight {
        animation-delay: -1.2s !important;
        animation-play-state: paused !important;
        opacity: 1 !important;
      }`;
      document.head.appendChild(style);
    };
    if (document.head) apply();
    else document.addEventListener("DOMContentLoaded", apply);
  });

  try {
    // Claims a session first, so this does not draw on the shared cookieless
    // games:create bucket -- see the note in continuous-table.spec.ts.
    await context.request.post("/api/profile");
    const created = await context.request.post("/api/games", {
      data: { name: "Funnel QA", isPrivate: true, tier: "1k", buyIn: 1000 },
    });
    expect(created.ok()).toBe(true);
    const gameId = (await created.json()).game.id as string;

    const page = await context.newPage();
    await page.goto(`/?table=${gameId}`);
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.locator(".poker-table-wrap")).toBeVisible();

    // Folding is the quickest route to a finished hand, and the funnel runs
    // for an uncontested pot exactly as it does for a showdown.
    const fold = page.getByRole("button", { name: /^Fold/ });
    await expect(fold).toBeEnabled({ timeout: 30_000 });
    await fold.click();

    const deadline = Date.now() + 100_000;
    let landing: {
      chips: number;
      worstDx: number;
      worstDy: number;
      target: { x: number; y: number } | null;
    } | null = null;

    while (Date.now() < deadline && !landing) {
      const game = (await (await context.request.get(`/api/games/${gameId}`)).json()).game;
      if (game.status === "complete" && game.winners?.length) {
        await page.waitForTimeout(500);
        landing = await page.evaluate(() => {
          const centre = (el: Element | null) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          };
          const winner = document.querySelector(".player-seat.seat-winner");
          // PotFunnel aims at .seat-stack when a seat has one, so that is the
          // point the chips are supposed to reach.
          const target = centre(winner?.querySelector(".seat-stack") ?? winner ?? null);
          const chips = [...document.querySelectorAll(".pot-chip-flight")]
            .map(centre)
            .filter((c): c is { x: number; y: number } => c !== null);
          if (!target || chips.length === 0) return { chips: chips.length, worstDx: 0, worstDy: 0, target };
          return {
            chips: chips.length,
            worstDx: Math.max(...chips.map((c) => Math.abs(c.x - target.x))),
            worstDy: Math.max(...chips.map((c) => Math.abs(c.y - target.y))),
            target,
          };
        });
        break;
      }
      await page.waitForTimeout(600);
    }

    expect(landing).not.toBeNull();
    expect(landing!.target).not.toBeNull();
    expect(landing!.chips).toBeGreaterThan(0);

    // The spray is deliberate: PotFunnel scatters each chip by up to 10px
    // across and 6px down so a dozen of them do not stack into one disc. The
    // tolerance covers that scatter and nothing more -- the defect this
    // replaced was fifty pixels, five times the widest legitimate spread.
    expect(landing!.worstDx).toBeLessThanOrEqual(22);
    expect(landing!.worstDy).toBeLessThanOrEqual(22);
  } finally {
    await context.close();
  }
});
