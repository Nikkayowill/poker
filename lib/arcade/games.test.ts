import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ARCADE_GAMES,
  arcadeActionLabel,
  arcadeBlockedReason,
  arcadeEntryLabel,
  canAffordArcadeGame,
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
  ...over,
});

describe("arcade catalogue", () => {
  it("lists the ten expansion games in display order", () => {
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
    ]);
  });

  it("keeps ids unique", () => {
    const ids = ARCADE_GAMES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never puts a price on a daily puzzle", () => {
    for (const entry of ARCADE_GAMES) {
      if (entry.kind === "puzzle") expect(entry.entryCost).toBe(0);
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

  it("reports coming-soon ahead of affordability", () => {
    const broke = { goldBalance: 0, unlimitedGold: false };
    expect(arcadeBlockedReason(game({ status: "coming-soon" }), broke)).toBe("coming-soon");
    expect(arcadeBlockedReason(game({ status: "live" }), broke)).toBe("insufficient-gold");
    expect(arcadeBlockedReason(game({ status: "live" }), { goldBalance: 999, unlimitedGold: false }))
      .toBeNull();
    expect(arcadeActionLabel(game({ status: "coming-soon" }), broke)).toBe("Soon");
    expect(arcadeActionLabel(game({ status: "live" }), broke)).toBe("Low Gold");
  });
});
