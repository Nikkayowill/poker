import { describe, expect, it } from "vitest";
import { ARCADE_GAMES } from "./games";
import { isRetiredArcadeGame, RETIRED_ARCADE_GAMES } from "./retired";

/**
 * These pin the retirement guard in the two places it can rot: the catalog
 * saying one thing while the guard says another, and (whenever the list is
 * non-empty again) a service's storage key drifting away from the string in
 * the list. Nothing is retired right now -- the five games this guard was
 * built for were deleted outright on 2026-08-20 rather than left in this
 * state -- so most of what's pinned here is the mechanism staying correct
 * at zero entries, ready for whichever game gets retired next.
 */
describe("retired arcade games", () => {
  it("matches the catalog's retired rows one for one, even at zero", () => {
    // The two lists are spelled differently on purpose -- the catalog would
    // use a display id ("chess-duel"), the guard an arcade_rounds.game key
    // ("chess") -- so this maps rather than compares, and would fail if a
    // game were ever retired in one place and not the other.
    const catalogIds = ARCADE_GAMES
      .filter((game) => game.status === "retired")
      .map((game) => game.id);
    expect(catalogIds).toHaveLength(RETIRED_ARCADE_GAMES.length);
    expect(RETIRED_ARCADE_GAMES).toEqual([]);
  });

  it("never retires a game that is still listed as live", () => {
    const liveIds = new Set(
      ARCADE_GAMES.filter((game) => game.status === "live").map((game) => game.id),
    );
    // A live catalog row pointing at a guarded game is the worst of both: a
    // working "Play" button that 410s on the click.
    for (const key of RETIRED_ARCADE_GAMES) expect(liveIds.has(key as never)).toBe(false);
  });

  it("leaves every live game alone", () => {
    // The line the owner drew when this guard was introduced: chance-
    // against-the-house is out, skill and social are in. Nothing live today
    // should ever match the (currently empty) retired list.
    for (const key of ["blackjack", "word-stack", "connections", "sudoku", "memory", "chess", "cribbage"]) {
      expect(isRetiredArcadeGame(key)).toBe(false);
    }
  });
});
