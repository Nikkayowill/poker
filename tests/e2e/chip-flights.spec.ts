import { expect, test } from "@playwright/test";

/**
 * The pot has to land on the player who won it.
 *
 * This assertion predates the WebGL room and it is worth saying why it still
 * exists in that form. Every distance in the payout is computed at runtime,
 * which sounds self-correcting and is not: the original defect was that the
 * travel vector was measured from `.pot-anchor` while the chips *started*
 * somewhere else entirely, so they flew the right distance in the right
 * direction from the wrong place and stopped fifty pixels short of every
 * winner. Nothing failed. It just looked slightly off, and only if you knew
 * where to look.
 *
 * The chips are meshes now, so `getBoundingClientRect` is no longer available
 * to measure them -- which would have quietly turned this file into a test
 * that asserts nothing. `window.__stackchipsScene` exists for exactly this:
 * it projects each chip's world position back into viewport pixels, so the
 * same question ("did a chip actually reach the winner?") is still being
 * asked of the same screen coordinates.
 */
test("the pot lands on the winner it was paid to", async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

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
    // The room is code-split, so it arrives a beat after the table does.
    await page.waitForFunction(() => Boolean(window.__stackchipsScene), null, { timeout: 30_000 });

    /**
     * Sampled by polling the page from here, rather than by a
     * `requestAnimationFrame` loop installed inside it.
     *
     * The in-page version is the obvious way to watch an animation and it
     * cannot work in this environment. Headless Chromium drives rAF from an
     * on-demand BeginFrame source, so it fires single-digit times per second
     * rather than sixty -- measured at 74 ticks across an entire hand. That
     * starves the probe of samples, and it also slows the thing being
     * probed: the room's render loop caps how much animation time one frame
     * may advance (`MAX_FRAME_DELTA_MS`, the guard that stops a backgrounded
     * tab teleporting every chip onto its target when it wakes), so at three
     * frames a second the payout plays at roughly an eighth speed. Both
     * effects are peculiar to headless and neither says anything about what
     * a player sees at 60fps.
     *
     * A poll from the test process is immune to the first problem: each
     * `evaluate` runs on demand, so the sample rate is ours to choose rather
     * than the compositor's. The second problem is simply tolerated -- the
     * assertion below is a ranking, and a payout that is only part-way home
     * still ranks correctly.
     */
    const readScene = () => page.evaluate(() => {
      const scene = window.__stackchipsScene;
      // Never throw: the seam is deleted and re-created when the scene
      // remounts, which React does on every mount in development, and a
      // sample that failed there would end the poll before the hand it is
      // measuring.
      if (!scene) return null;
      const seats = [...document.querySelectorAll(".player-seat")];
      return {
        funnelSlots: scene.lastFunnel(),
        // The room's own seat positions, not the DOM plates: the payout is
        // aimed at the seat ring in the scene, and with the sprite layer off
        // the plates are still on the CSS ellipse -- a different shape by up
        // to ~180px at the sides. `table-scene.spec.ts` is what holds those
        // two together when it matters; this asks only where the pot went.
        centres: seats.map((_, slot) => scene.seat(slot)),
        chips: scene.chips(),
        winning: seats
          .map((seat, slot) => (seat.classList.contains("seat-winner") ? slot : -1))
          .filter((slot) => slot >= 0),
      };
    });

    // Folding is the quickest route to a finished hand, and the funnel runs
    // for an uncontested pot exactly as it does for a showdown.
    const fold = page.getByRole("button", { name: /^Fold/ });
    await expect(fold).toBeEnabled({ timeout: 30_000 });
    await fold.click();

    let funnelSlots: number[] = [];
    let domWinnerSlots: number[] = [];
    let closest: number[] = [];
    let started: number[] = [];

    /**
     * The window is bracketed by the payout itself at one end and the
     * celebration ending at the other, and both bounds are load-bearing.
     *
     * Arming on `lastFunnel()` rather than on `.seat-winner` appearing means
     * the baseline cannot be taken from bet chips left over from the last
     * street, which is what used to make this test disagree with itself
     * across runs. Stopping when the winner class clears means it cannot
     * drift into the next hand, whose blinds leave from their own seats and
     * would score enormous gains against them.
     */
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      const sample = await readScene();
      if (sample) {
        if (funnelSlots.length === 0 && sample.funnelSlots.length > 0) {
          funnelSlots = [...sample.funnelSlots];
          // Captured now, not read back afterwards: the winner class is
          // cleared when the next hand is dealt 2.8s later.
          domWinnerSlots = sample.winning;
          closest = sample.centres.map(() => Infinity);
          /**
           * The baseline, taken once, from every chip in the payout at the
           * moment it is first seen.
           *
           * Deliberately the centroid of the whole spray and not -- as this
           * did first -- the distance of whichever chip happened to be at
           * the head of the renderer's array. That chip is not a fixed
           * point: a chip is released the instant it arrives and the pool
           * hands it straight back out, so the head of the array is a
           * different chip at different moments in the same payout, and the
           * baseline it produced moved by hundreds of pixels between runs.
           * Ranking a gain against a baseline that wanders is how a payout
           * that visibly landed on its winner came out fourth.
           */
          const centroid = {
            x: sample.chips.reduce((sum, chip) => sum + chip.x, 0) / sample.chips.length,
            y: sample.chips.reduce((sum, chip) => sum + chip.y, 0) / sample.chips.length,
          };
          started = sample.centres.map((centre) => Math.hypot(centroid.x - centre.x, centroid.y - centre.y));
        }
        if (funnelSlots.length > 0) {
          if (sample.winning.length === 0) break;
          sample.centres.forEach((centre, slot) => {
            for (const chip of sample.chips) {
              const distance = Math.hypot(chip.x - centre.x, chip.y - centre.y);
              if (distance < closest[slot]) closest[slot] = distance;
            }
          });
        }
      }
      // Fast enough that the payout is first seen within a frame of leaving,
      // which is what keeps the baseline above honest.
      await page.waitForTimeout(25);
    }

    // The payout fired at all.
    expect(funnelSlots.length).toBeGreaterThan(0);

    /**
     * The mapping, asserted directly: the ring slots the room was told to pay
     * are the ring slots the DOM marked as winning.
     *
     * These are two independent derivations of the same fact -- the scene is
     * handed slots resolved through the ordered-seat map, the plates get
     * their class from the winner list itself -- so a rotation or off-by-one
     * between the room's ring and the DOM's shows up here as a mismatch
     * rather than as chips quietly landing on the wrong player.
     */
    expect([...funnelSlots].sort()).toEqual([...domWinnerSlots].sort());

    const winnerSlot = funnelSlots[0];
    // Chips were seen in flight -- otherwise this asserts nothing.
    expect(Number.isFinite(closest[winnerSlot])).toBe(true);
    expect(Number.isFinite(started[winnerSlot])).toBe(true);
    expect(started[winnerSlot]).toBeGreaterThan(0);

    /**
     * And the geometry: the pot closed ground on the seat it was paid to,
     * and closed more of it than all but one other seat.
     *
     * Ranked rather than measured against a distance, and the reasons are
     * properties of the table rather than slack. An absolute tolerance fails
     * because the seat marker sits at rail height while the chips rest on the
     * cloth, leaving a standing offset that varies around the ring.
     * "Nearest seat" fails because the pot projects close to the far seat
     * under this camera, so that seat would win on every hand it did not
     * play. And a fixed ratio against the best gain fails because the winner
     * and its neighbour sit sixty degrees apart, so the payout passes one on
     * its way to the other: observed between 128% and 89% of the neighbour,
     * all on correct payouts. The ordering is what holds -- a pot paid to the
     * wrong side of the felt puts its winner fourth or worse.
     *
     * The gain is the *fraction* of its starting distance a seat closed, not
     * the pixels it closed, and that distinction is load-bearing. The pot no
     * longer sits at the middle of the felt -- `POT_DEPTH_FRACTION` rests it
     * behind the board, away from the viewer, so the board is not buried
     * under it -- which means the seats do not start equidistant from the
     * chips any more. A near seat begins several hundred pixels away and a
     * far seat begins close, so counting pixels rewards whoever had the most
     * ground available rather than whoever was actually paid: observed
     * directly, a correct payout to slot 2 ranked behind slots 4 and 5 purely
     * because they had further to close. A fraction is scale-free -- the
     * winner closes essentially all of its distance wherever it sits, and a
     * seat the chips merely flew past does not.
     *
     * The cut is `funnelSlots.length + 1` rather than a literal two because a
     * split pot is ordinary here: an uncontested fold-around is not the only
     * way this hand ends, and a payout to three winners legitimately closes
     * ground on three seats.
     */
    const gained = (slot: number) => (started[slot] > 0
      ? (started[slot] - closest[slot]) / started[slot]
      : 0);
    expect(gained(winnerSlot)).toBeGreaterThan(0);
    const ranked = closest
      .map((_, slot) => ({ slot, gain: gained(slot) }))
      .sort((a, b) => b.gain - a.gain);
    expect(
      ranked.slice(0, funnelSlots.length + 1).map((entry) => entry.slot),
    ).toContain(winnerSlot);

    /**
     * A note for whoever revisits this, since the absence is deliberate.
     *
     * The exact landing point is not checked here and does not need to be:
     * `lib/scene/chips/chip-payout.test.ts` fixes the slide's arithmetic and
     * proves the whole funnel lands inside NEXT_HAND_DELAY_MS, and
     * `lib/scene/seat-ring.test.ts` fixes the ring it is aimed at -- both
     * deterministically, rather than against six bots and a clock. What
     * genuinely needs a live table is the pair above: that the room is told
     * to pay the player the DOM is showing as the winner, and that the chips
     * actually travel to them.
     */
  } finally {
    await context.close();
  }
});

/**
 * `.pot-anchor` no longer draws anything -- the pile is meshes on the felt --
 * but it is still the fixed point two DOM effects are measured from: folded
 * cards drifting to the muck, and every hole card dealt. If a growing pot
 * could move or resize it, it would drag both trajectories with it, and the
 * symptom would be that everything on the table was slightly off rather than
 * anything visibly breaking.
 */
test("the pot anchor stays the fixed point every DOM trajectory is measured from", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await context.request.post("/api/profile");
    const created = await context.request.post("/api/games", {
      data: { name: "Pile QA", isPrivate: true, tier: "1k", buyIn: 1000 },
    });
    expect(created.ok()).toBe(true);
    const gameId = (await created.json()).game.id as string;

    const page = await context.newPage();
    await page.goto(`/?table=${gameId}`);
    await page.getByRole("button", { name: "Play as guest" }).click();
    await expect(page.locator(".poker-table-wrap")).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__stackchipsScene), null, { timeout: 30_000 });

    const reading = async () =>
      page.evaluate(() => {
        const el = document.querySelector(".pot-anchor");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          cx: Math.round(r.x + r.width / 2),
          cy: Math.round(r.y + r.height / 2),
          pile: window.__stackchipsScene?.pileSize() ?? 0,
        };
      });

    const before = await reading();
    expect(before).not.toBeNull();
    // Deliberately not asserted against the 45x35 the stylesheet declares:
    // the anchor sits inside transformed ancestors, so its measured box is
    // 44x33 at this viewport and would be something else again at another.
    // The contract is that it does not *change*, not that it equals a literal
    // -- pinning the literal would fail on a restyle that broke nothing.
    expect(before!.w).toBeGreaterThan(0);
    expect(before!.h).toBeGreaterThan(0);

    // Drive the pot up. Calling into a raised pot is the quickest way to make
    // the pile grow several denominations without waiting for a whole hand.
    const deadline = Date.now() + 60_000;
    let biggest = before!;
    while (Date.now() < deadline) {
      const current = await reading();
      if (current && current.pile > biggest.pile) biggest = current;
      if (biggest.pile >= 3) break;
      for (const label of [/^Call/, /^Check/]) {
        const button = page.getByRole("button", { name: label }).first();
        if (await button.isEnabled({ timeout: 300 }).catch(() => false)) {
          await button.click({ timeout: 1_500 }).catch(() => undefined);
          break;
        }
      }
      await page.waitForTimeout(350);
    }

    // The pile did grow -- otherwise this asserts nothing about a pile.
    expect(biggest.pile).toBeGreaterThan(0);
    // And the anchor did not budge while it did.
    expect({ w: biggest.w, h: biggest.h }).toEqual({ w: before!.w, h: before!.h });
    expect(Math.abs(biggest.cx - before!.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(biggest.cy - before!.cy)).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});
