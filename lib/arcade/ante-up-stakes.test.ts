import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANTE_UP_GAMES, anteUpWagerCeilingProblem, maxAnteUpWager } from "./ante-up-stakes";
import { ANTE_UP_TIERS } from "./ante-up";
import { ANTE_UP_MINESWEEPER_TIERS } from "./ante-up-minesweeper";
import { SUDOKU_DIFFICULTIES } from "./puzzles/sudoku";
import { MINESWEEPER_DIFFICULTIES } from "./puzzles/minesweeper";
import { NONOGRAM_DIFFICULTIES } from "./puzzles/nonogram";

/**
 * The ceiling half of the anti-farm fix. What has to hold: a wager may never
 * exceed the ceiling of the board it is riding on, an easier board never
 * allows a bigger one than a harder board, and an unrecognised tier falls to
 * the *lowest* ceiling rather than the highest.
 */

describe("maxAnteUpWager", () => {
  it("climbs with Sudoku difficulty and never flattens", () => {
    const ladder = SUDOKU_DIFFICULTIES.map((d) => maxAnteUpWager("sudoku", d));
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });

  it("climbs with Minesweeper difficulty and never flattens", () => {
    const ladder = MINESWEEPER_DIFFICULTIES.map((entry) => maxAnteUpWager("minesweeper", entry.id));
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });

  it("gives every game a finite ceiling", () => {
    // The whole bug this file exists for was a missing upper bound, so an
    // Infinity or NaN slipping into the table has to fail loudly here.
    for (const game of ANTE_UP_GAMES) {
      const max = maxAnteUpWager(game, null);
      expect(Number.isFinite(max)).toBe(true);
      expect(max).toBeGreaterThan(0);
    }
  });

  it("falls to the lowest rung on a tier it does not recognise", () => {
    // A tier string that does not parse must never be the cheap way to the
    // top ceiling. The services parse difficulty first, so this is a backstop.
    expect(maxAnteUpWager("sudoku", "nonsense")).toBe(maxAnteUpWager("sudoku", "easy"));
    expect(maxAnteUpWager("sudoku", null)).toBe(maxAnteUpWager("sudoku", "easy"));
    expect(maxAnteUpWager("minesweeper", "nonsense")).toBe(maxAnteUpWager("minesweeper", "beginner"));
  });

  it("keeps the safest board's ceiling well under the harder ones", () => {
    // The specific shape of the exploit: an easy board is close to a certain
    // win, so it is the last place a fortune should be allowed to sit.
    expect(maxAnteUpWager("sudoku", "easy")).toBeLessThan(maxAnteUpWager("sudoku", "expert") / 10);
    expect(maxAnteUpWager("minesweeper", "beginner")).toBeLessThan(
      maxAnteUpWager("minesweeper", "expert") / 10,
    );
  });
});

describe("anteUpWagerCeilingProblem", () => {
  it("passes a wager at exactly the ceiling", () => {
    const max = maxAnteUpWager("sudoku", "medium");
    expect(anteUpWagerCeilingProblem("sudoku", "medium", max)).toBeNull();
  });

  it("refuses one Gold over the ceiling", () => {
    const max = maxAnteUpWager("sudoku", "medium");
    expect(anteUpWagerCeilingProblem("sudoku", "medium", max + 1)).not.toBeNull();
  });

  it("passes a free (zero) wager everywhere", () => {
    for (const game of ANTE_UP_GAMES) {
      expect(anteUpWagerCeilingProblem(game, null, 0)).toBeNull();
    }
  });

  it("names the next rung up so the player knows how to stake more", () => {
    const problem = anteUpWagerCeilingProblem("sudoku", "easy", 1_000_000);
    expect(problem).toContain("Medium");
    expect(problem).toContain(maxAnteUpWager("sudoku", "medium").toLocaleString());
  });

  it("does not promise a next rung at the top of a ladder", () => {
    const problem = anteUpWagerCeilingProblem("sudoku", "expert", 10_000_000);
    expect(problem).not.toBeNull();
    expect(problem).not.toContain("Step up");
  });

  it("does not promise a next rung on a game with no difficulty axis", () => {
    const problem = anteUpWagerCeilingProblem("memory-match", null, 10_000_000);
    expect(problem).not.toBeNull();
    expect(problem).not.toContain("Step up");
  });
});

describe("the payout ladders this file bounds", () => {
  /**
   * The ceiling and the multiplier are two halves of one fix, and the half
   * that actually stops the compounding is this one: a board close to a
   * certain win must not pay a large multiple of the stake. These pin the
   * safe rungs specifically, since those are the ones that were farmed.
   */
  it("keeps the easiest Sudoku grid near 1x", () => {
    expect(ANTE_UP_TIERS.easy.multiplier).toBeLessThanOrEqual(1.25);
  });

  it("keeps the easiest Minesweeper board near 1x", () => {
    expect(ANTE_UP_MINESWEEPER_TIERS.beginner.multiplier).toBeLessThanOrEqual(1.25);
  });

  it("pays more for a harder Sudoku grid at every rung", () => {
    const ladder = SUDOKU_DIFFICULTIES.map((d) => ANTE_UP_TIERS[d].multiplier);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });

  it("gives a harder Sudoku grid at least as much time as an easier one", () => {
    // The ladder used to run backwards (easy 15 min, expert 5), which is what
    // made easy the only rung worth wagering on.
    const clocks = SUDOKU_DIFFICULTIES.map((d) => ANTE_UP_TIERS[d].timeLimitMs);
    for (let i = 1; i < clocks.length; i += 1) {
      expect(clocks[i]).toBeGreaterThanOrEqual(clocks[i - 1]);
    }
  });
});

/**
 * `maxAnteUpWager` above is only half the ceiling. The other half is the
 * `ante_up_attempts_enforce_wager_ceiling` BEFORE INSERT trigger (see
 * supabase/migrations/20260827090000_ante_up_wager_tier_ceiling.sql for why
 * it is a trigger and not a CHECK), which makes the rule true of the data
 * itself rather than of the one code path that happens to call this file. A
 * trigger cannot import a TypeScript module, so its case list is a duplicate
 * kept in step by hand -- and a duplicated invariant drifts silently. That is
 * exactly what happened: Nonogram shipped with a ceiling here and none in the
 * trigger, so its only enforcement was whichever service function remembered
 * to call `anteUpWagerCeilingProblem`. Fixed in
 * 20260901090000_nonogram_wager_ceiling.sql; this test is what stops the next
 * game from doing the same thing quietly.
 *
 * Reads the trigger's *current* definition off migration files on disk
 * (Postgres has no test-time presence here), taking the most recently
 * written migration that redefines the function -- each one has always
 * replaced the whole case list, never patched it, so the latest file is the
 * whole truth, the same way the last CREATE OR REPLACE wins when Postgres
 * applies them in order.
 */
describe("the DB ceiling trigger stays in step with maxAnteUpWager", () => {
  function currentTriggerCeilings(): Map<string, number> {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const marker = "create or replace function public.ante_up_attempts_enforce_wager_ceiling";
    const owning = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) => readFileSync(path.join(dir, name), "utf8").includes(marker));

    if (owning.length === 0) {
      throw new Error(
        "No migration defines ante_up_attempts_enforce_wager_ceiling -- has it been renamed or dropped?",
      );
    }

    const sql = readFileSync(path.join(dir, owning[owning.length - 1]), "utf8");
    const ceilings = new Map<string, number>();
    const linePattern = /when new\.game = '([a-z-]+)'(?:\s+and new\.tier = '([a-z]+)')?\s+then\s+(\d+)/g;
    for (const [, game, tier, amount] of sql.matchAll(linePattern)) {
      ceilings.set(tier ? `${game}:${tier}` : game, Number(amount));
    }
    return ceilings;
  }

  const ceilings = currentTriggerCeilings();

  it.each(SUDOKU_DIFFICULTIES)("sudoku/%s", (tier) => {
    expect(ceilings.get(`sudoku:${tier}`)).toBe(maxAnteUpWager("sudoku", tier));
  });

  it.each(MINESWEEPER_DIFFICULTIES.map((d) => d.id))("minesweeper/%s", (tier) => {
    expect(ceilings.get(`minesweeper:${tier}`)).toBe(maxAnteUpWager("minesweeper", tier));
  });

  it.each(NONOGRAM_DIFFICULTIES.map((d) => d.id))("nonogram/%s", (tier) => {
    expect(ceilings.get(`nonogram:${tier}`)).toBe(maxAnteUpWager("nonogram", tier));
  });

  it("memory-match's flat ceiling matches (word-stack/connections deliberately don't write to this table)", () => {
    expect(ceilings.get("memory-match")).toBe(maxAnteUpWager("memory-match", null));
  });
});
