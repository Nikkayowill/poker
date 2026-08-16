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
  id: "coin-flip",
  name: "Coin Flip",
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
      "Daily Wordle",
      "Connections",
      "Hi-Lo",
      "Video Poker",
      "Roulette Wheel",
      "Daily Sudoku",
      "Memory Match",
      "Baccarat",
      "Coin Flip",
      "Chess",
      "Checkers",
      "Trivia Showdown",
      "Word Race",
      "Ante Up: Sudoku",
    ]);
  });

  it("keeps every retired game off the floor and unlinked", () => {
    // The catalog half of the 2026-08-12 retirement. The half that actually
    // matters -- that the deal routes refuse -- is pinned in retired.test.ts;
    // this is what stops one of them being quietly relinked.
    const retired = ARCADE_GAMES.filter((entry) => entry.status === "retired");
    expect(retired.map((entry) => entry.id)).toEqual([
      "hi-lo",
      "video-poker",
      "roulette-wheel",
      "baccarat",
      "coin-flip",
    ]);
    for (const entry of retired) expect(entry.href).toBeNull();

    const floor = splitArcadeFloor();
    const onFloor = [...floor.free, ...floor.duels, ...floor.wagers, ...floor.staked].map((entry) => entry.id);
    for (const entry of retired) expect(onFloor).not.toContain(entry.id);
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

  it("routes every live game and only live games", () => {
    // A live entry with a null href renders an unclickable "Play"; a
    // coming-soon or retired entry with an href is a link to a page nobody
    // should be sent to.
    for (const entry of ARCADE_GAMES) {
      if (entry.status === "live") expect(entry.href).toBeTruthy();
      else expect(entry.href).toBeNull();
    }
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
