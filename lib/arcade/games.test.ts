import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ARCADE_GAMES,
  arcadeActionLabel,
  arcadeBlockedReason,
  arcadeEntryLabel,
  canAffordArcadeGame,
  splitArcadeFloor,
  toArcadeWallet,
  type ArcadeGame,
} from "./games";

const game = (over: Partial<ArcadeGame> = {}): ArcadeGame => ({
  id: "blackjack-21",
  name: "Blackjack 21",
  blurb: "",
  kind: "casino",
  entryCost: 250,
  status: "coming-soon",
  href: null,
  ...over,
});

describe("arcade catalogue", () => {
  it("lists every catalogued game in display order", () => {
    expect(ARCADE_GAMES.map((entry) => entry.name)).toEqual([
      "Blackjack 21",
      "Daily Word Stack",
      "Connections",
      "Sudoku",
      "Memory Match",
      "Minesweeper",
      "Nonogram",
      "StackChips Homestead",
      "Chess",
      "Checkers",
      "Othello",
      "Trivia Showdown",
      "Word Race",
      "Cribbage",
    ]);
  });

  it("keeps every brain game as a wager row, not a separate free section", () => {
    // 2026-08-21: Word Stack/Connections/Sudoku/Memory Match moved from
    // kind "puzzle" to kind "wager". Word Stack/Connections still lead with
    // a free daily play (the wager now gates that one attempt); Sudoku/
    // Memory Match have no daily gate left at all. Both shapes are still
    // `kind: "wager"` -- see lib/arcade/games.ts's own note. Minesweeper
    // (2026-08-24) and Nonogram (2026-08-31) join the second, unlimited shape.
    const floor = splitArcadeFloor();
    expect(floor.free).toHaveLength(0);
    expect(floor.wagers.map((entry) => entry.id)).toEqual([
      "daily-word-stack",
      "connections",
      "daily-sudoku",
      "memory-match",
      "minesweeper",
      "nonogram",
    ]);
  });

  it("keeps a retired game off the floor and unlinked", () => {
    // Nothing in the live catalog is retired right now -- every game that
    // ever was got deleted outright on 2026-08-20 rather than left in this
    // state. The mechanism itself (lib/arcade/retired.ts's guard, this
    // status value, splitArcadeFloor's live-only filter) stays for whichever
    // game gets retired next, so this exercises it against a standalone
    // synthetic fixture rather than a real catalog row.
    const retired = game({ status: "retired", href: null });
    expect(retired.href).toBeNull();

    const floor = splitArcadeFloor([retired]);
    expect([...floor.free, ...floor.duels, ...floor.wagers, ...floor.staked]).toHaveLength(0);
  });

  it("stakes every duel and never lists one as free", () => {
    for (const entry of ARCADE_GAMES) {
      if (entry.kind !== "duel") continue;
      expect(entry.entryCost).toBeGreaterThan(0);
    }
    expect(splitArcadeFloor().free.every((entry) => entry.kind === "puzzle")).toBe(true);
  });

  it("keeps ids unique", () => {
    const ids = ARCADE_GAMES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives a route to every game that was actually built, and only those", () => {
    // The rule is "was it built", not "is it offered". A live entry with a
    // null href renders an unclickable "Play"; a coming-soon entry with an
    // href is a link to a page that does not exist yet. staff-only is the
    // case that forced the distinction: it IS built and it DOES have a
    // route, the route just refuses anyone without an admin session (see
    // lib/server/staff-gate.ts), so requiring a null href here would have
    // meant deleting a working link to hide a game.
    for (const entry of ARCADE_GAMES) {
      if (entry.status === "coming-soon") expect(entry.href).toBeNull();
      else expect(entry.href).toBeTruthy();
    }
  });

  it("keeps a staff-only game off the floor while leaving its route intact", () => {
    const homestead = ARCADE_GAMES.find((entry) => entry.id === "homestead");
    expect(homestead?.status).toBe("staff-only");
    // Under /admin, because that is the only path the admin session cookie
    // is sent to. See lib/server/staff-gate.ts.
    expect(homestead?.href).toBe("/admin/homestead");

    // The floor only ever shows live rows, so it never surfaces.
    const floor = splitArcadeFloor();
    const onFloor = [...floor.free, ...floor.duels, ...floor.wagers, ...floor.staked];
    expect(onFloor.map((entry) => entry.id)).not.toContain("homestead");
  });

  it("never puts a price on a daily puzzle, or a floor under a solo wager", () => {
    // Both are legitimately 0, for opposite reasons: a puzzle has nothing to
    // wager, a wager's floor is "free" because the real amount is picked on
    // the page itself, same as a duel's stake tier used to be picked there.
    for (const entry of ARCADE_GAMES) {
      if (entry.kind === "puzzle" || entry.kind === "wager") expect(entry.entryCost).toBe(0);
      else expect(entry.entryCost).toBeGreaterThan(0);
    }
  });
});

describe("toArcadeWallet", () => {
  const profile = (over: Partial<PlayerProfile>) => over as PlayerProfile;

  it("treats a missing profile as an empty wallet, not an unlimited one", () => {
    expect(toArcadeWallet(null)).toEqual({ goldBalance: 0, unlimitedGold: false });
  });

  it("floors a negative or non-finite balance at zero", () => {
    expect(toArcadeWallet(profile({ goldBalance: -50 })).goldBalance).toBe(0);
    expect(toArcadeWallet(profile({ goldBalance: Number.NaN })).goldBalance).toBe(0);
  });

  it("carries the balance and the unlimited flag through", () => {
    expect(toArcadeWallet(profile({ goldBalance: 4200, unlimitedGold: true })))
      .toEqual({ goldBalance: 4200, unlimitedGold: true });
  });
});

describe("canAffordArcadeGame", () => {
  it("gates a paid game on the balance covering it", () => {
    const wallet = { goldBalance: 999, unlimitedGold: false };
    expect(canAffordArcadeGame(game({ entryCost: 1000 }), wallet)).toBe(false);
    expect(canAffordArcadeGame(game({ entryCost: 999 }), wallet)).toBe(true);
  });

  it("never gates a free puzzle", () => {
    const broke = { goldBalance: 0, unlimitedGold: false };
    expect(canAffordArcadeGame(game({ kind: "puzzle", entryCost: 0 }), broke)).toBe(true);
  });

  it("lets an unlimited profile afford anything", () => {
    expect(canAffordArcadeGame(game({ entryCost: 500000 }), { goldBalance: 0, unlimitedGold: true }))
      .toBe(true);
  });
});

describe("labels", () => {
  it("prints a free puzzle as free and a stake with separators", () => {
    expect(arcadeEntryLabel(game({ entryCost: 0 }))).toBe("Free daily");
    expect(arcadeEntryLabel(game({ entryCost: 5000 }))).toBe("5,000");
  });

  it("tells a zero-cost wager row apart from a zero-cost puzzle row", () => {
    // The whole reason this label exists as its own function: a bare "Free
    // to play" on a wager row used to read as "nothing is wagered here",
    // which is backwards -- see this file's own 2026-08-21 note.
    expect(arcadeEntryLabel(game({ kind: "wager", entryCost: 0 }))).toBe("Free, or wager Gold");
    expect(arcadeEntryLabel(game({ kind: "puzzle", entryCost: 0 }))).toBe("Free daily");
  });

  it("names the daily identity for Word Stack/Connections specifically, unlike Sudoku/Memory Match", () => {
    expect(arcadeEntryLabel(game({ id: "daily-word-stack", kind: "wager", entryCost: 0 })))
      .toBe("Free daily · or wager it");
    expect(arcadeEntryLabel(game({ id: "connections", kind: "wager", entryCost: 0 })))
      .toBe("Free daily · or wager it");
    expect(arcadeEntryLabel(game({ id: "daily-sudoku", kind: "wager", entryCost: 0 })))
      .toBe("Free, or wager Gold");
    expect(arcadeEntryLabel(game({ id: "memory-match", kind: "wager", entryCost: 0 })))
      .toBe("Free, or wager Gold");
  });

  it("reports unavailability ahead of affordability", () => {
    // Telling a player they cannot afford a game nobody can play is the wrong
    // sentence, so both unavailable states outrank the wallet check.
    const broke = { goldBalance: 0, unlimitedGold: false };
    expect(arcadeBlockedReason(game({ status: "coming-soon" }), broke)).toBe("coming-soon");
    expect(arcadeBlockedReason(game({ status: "retired" }), broke)).toBe("retired");
    expect(arcadeBlockedReason(game({ status: "live" }), broke)).toBe("insufficient-gold");
    expect(arcadeBlockedReason(game({ status: "live" }), { goldBalance: 999, unlimitedGold: false }))
      .toBeNull();
    expect(arcadeActionLabel(game({ status: "coming-soon" }), broke)).toBe("Soon");
    expect(arcadeActionLabel(game({ status: "retired" }), broke)).toBe("Retired");
    expect(arcadeActionLabel(game({ status: "live" }), broke)).toBe("Low Gold");
  });

  it("says Challenge on a duel, since the click opens a lobby rather than dealing", () => {
    const rich = { goldBalance: 999_999, unlimitedGold: false };
    expect(arcadeActionLabel(game({ status: "live", kind: "duel" }), rich)).toBe("Challenge");
    expect(arcadeActionLabel(game({ status: "live", kind: "casino" }), rich)).toBe("Play");
  });
});
