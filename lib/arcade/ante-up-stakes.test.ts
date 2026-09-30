import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANTE_UP_GAMES, ANTE_UP_TIER_LADDERS, anteUpStakeProblem, maxAnteUpWager } from "./ante-up-stakes";

/**
 * The per-difficulty wager ceiling this file used to enforce was removed: a
 * solo wager is now bounded only by the player's own balance, same as any
 * other stake in the app. A big stake decides which boards may be played,
 * never how much may be staked, in either the TypeScript check or its DB-side
 * mirror.
 */

describe("maxAnteUpWager", () => {
  it("is unbounded for every game, with or without a tier", () => {
    for (const game of ANTE_UP_GAMES) {
      expect(maxAnteUpWager(game, null)).toBe(Number.POSITIVE_INFINITY);
      expect(maxAnteUpWager(game, "nonsense")).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

describe("anteUpStakeProblem", () => {
  // A big stake picks the board, never the amount: the hardest tier (or a
  // game with no tiers) takes any stake at all.
  it("never objects to a stake on the hardest board, at any size", () => {
    for (const game of ANTE_UP_GAMES) {
      const tiers = ANTE_UP_TIER_LADDERS[game]?.tiers;
      const hardest = tiers ? tiers[tiers.length - 1] : null;
      expect(anteUpStakeProblem(game, null, 0)).toBeNull();
      expect(anteUpStakeProblem(game, hardest, 1_000_000_000)).toBeNull();
    }
  });
});

/**
 * The DB-side backstop (ante_up_attempts_enforce_wager_ceiling, see
 * 20260918152323_ante_up_remove_wager_ceiling.sql) was made a no-op alongside
 * this file. It must stay a no-op: a stale trigger definition that still
 * rejects large wagers would silently reintroduce the cap this file says
 * does not exist.
 */
describe("the DB ceiling trigger stays a no-op", () => {
  function currentTriggerBody(): string {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const marker = "create or replace function public.ante_up_attempts_enforce_wager_ceiling";
    const owning = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) => readFileSync(path.join(dir, name), "utf8").toLowerCase().includes(marker));

    if (owning.length === 0) {
      throw new Error(
        "No migration defines ante_up_attempts_enforce_wager_ceiling -- has it been renamed or dropped?",
      );
    }

    return readFileSync(path.join(dir, owning[owning.length - 1]), "utf8");
  }

  it("no longer raises on any wager", () => {
    const sql = currentTriggerBody().toLowerCase();
    expect(sql).not.toContain("raise exception");
  });
});
