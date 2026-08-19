import { describe, expect, it } from "vitest";
import { ARCADE_GAMES } from "./games";
import { isRetiredArcadeGame, RETIRED_ARCADE_GAMES } from "./retired";

/**
 * These pin the 2026-08-12 retirement in the only two places it can rot: the
 * catalog saying one thing while the guard says another, and a service's
 * storage key drifting away from the string in the list.
 */
describe("retired arcade games", () => {
  it("matches the catalog's retired rows one for one", () => {
    // The two lists are spelled differently on purpose -- the catalog uses
    // display ids ("roulette-wheel"), the guard uses arcade_rounds.game keys
    // ("roulette") -- so this maps rather than compares, and would fail if a
    // game were retired in one place and not the other.
    const catalogIds = ARCADE_GAMES
      .filter((game) => game.status === "retired")
      .map((game) => game.id);
    expect(catalogIds).toHaveLength(RETIRED_ARCADE_GAMES.length);
    expect(new Set(catalogIds)).toEqual(
      new Set(["hi-lo", "video-poker", "roulette-wheel", "baccarat", "coin-flip"]),
    );
  });

  it("never retires a game that is still listed as live", () => {
    const liveIds = new Set(
      ARCADE_GAMES.filter((game) => game.status === "live").map((game) => game.id),
    );
    // A live catalog row pointing at a guarded game is the worst of both: a
    // working "Play" button that 410s on the click.
    for (const key of RETIRED_ARCADE_GAMES) expect(liveIds.has(key as never)).toBe(false);
  });

  it("leaves the skill games alone", () => {
    // The line the owner drew: chance-against-the-house is out, skill and
    // social are in. Blackjack has a decision every hand; the dailies are free.
    for (const key of ["blackjack", "word-stack", "connections", "sudoku", "memory"]) {
      expect(isRetiredArcadeGame(key)).toBe(false);
    }
  });

  it("recognises each retired storage key", () => {
    for (const key of RETIRED_ARCADE_GAMES) expect(isRetiredArcadeGame(key)).toBe(true);
    expect(isRetiredArcadeGame("chess")).toBe(false);
  });
});
