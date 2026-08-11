import { describe, expect, it } from "vitest";
import {
  MAX_PUSH_STAGGER_MS,
  MIN_PUSH_STAGGER_MS,
  PUSH_STYLES,
  pushKindFromAction,
  pushStyleFor,
} from "./chip-push";

describe("pushKindFromAction", () => {
  it("reads the verb off the engine's own action labels", () => {
    // These strings are written in lib/game/engine.ts. Anything here that
    // stops matching means the felt has quietly lost its cadence — the
    // fallback is silent by design, so nothing else would report it.
    expect(pushKindFromAction("Call · 200")).toBe("call");
    expect(pushKindFromAction("Bet · 400")).toBe("bet");
    expect(pushKindFromAction("Raise to · 1200")).toBe("raise");
    expect(pushKindFromAction("All-in · 4300")).toBe("all-in");
    expect(pushKindFromAction("Small blind · 50")).toBe("blind");
    expect(pushKindFromAction("Big blind · 100")).toBe("blind");
  });

  it("falls back to the neutral bet cadence rather than throwing", () => {
    // A chip movement whose label the engine renamed still has to be
    // choreographed; `bet` is the middle of the range.
    expect(pushKindFromAction(null)).toBe("bet");
    expect(pushKindFromAction("Straddle · 200")).toBe("bet");
    expect(pushKindFromAction("")).toBe("bet");
  });

  it("is insensitive to case and surrounding space", () => {
    expect(pushKindFromAction("  CALL  ·  200 ")).toBe("call");
  });

  it("reads the scripted demo's un-separated labels too", () => {
    // components/game3d/demo/scripted-hand.ts writes these, and the demo is
    // the one place a person watches every cadence back to back.
    expect(pushKindFromAction("raise 30")).toBe("raise");
    expect(pushKindFromAction("bet 60")).toBe("bet");
    expect(pushKindFromAction("small blind")).toBe("blind");
    expect(pushKindFromAction("call")).toBe("call");
  });
});

describe("PUSH_STYLES", () => {
  it("staggers every kind inside the domino band", () => {
    for (const [kind, style] of Object.entries(PUSH_STYLES)) {
      expect(style.staggerMs, kind).toBeGreaterThanOrEqual(MIN_PUSH_STAGGER_MS);
      expect(style.staggerMs, kind).toBeLessThanOrEqual(MAX_PUSH_STAGGER_MS);
    }
  });

  it("keeps every arc low — these are chips pushed across cloth", () => {
    for (const [kind, style] of Object.entries(PUSH_STYLES)) {
      expect(style.arcHeight, kind).toBeGreaterThan(0);
      // The spray this replaced peaked half a world unit up, about twelve
      // chip radii — that height is what made a bet read as a funnel.
      expect(style.arcHeight, kind).toBeLessThanOrEqual(0.12);
    }
  });

  it("terminates: every style has a real travel and a real settle", () => {
    for (const [kind, style] of Object.entries(PUSH_STYLES)) {
      expect(style.travelMs, kind).toBeGreaterThan(0);
      expect(style.settleMs, kind).toBeGreaterThan(0);
      expect(style.tiltRad, kind).toBeGreaterThan(0);
      // A landing rock, not a topple.
      expect(style.tiltRad, kind).toBeLessThan(0.2);
    }
  });

  it("escalates with the weight of the action", () => {
    const { blind, call, bet, raise } = PUSH_STYLES;
    expect(blind.tiltRad).toBeLessThan(bet.tiltRad);
    expect(call.tiltRad).toBeLessThan(bet.tiltRad);
    expect(bet.tiltRad).toBeLessThan(raise.tiltRad);
    expect(raise.tiltRad).toBeLessThan(PUSH_STYLES["all-in"].tiltRad);
  });

  it("keeps the dealer's own hands flatter than any player's push", () => {
    // A dealer drags chips across the felt; a player tosses them.
    expect(PUSH_STYLES.sweep.arcHeight).toBeLessThan(PUSH_STYLES.call.arcHeight);
    expect(PUSH_STYLES.award.arcHeight).toBeLessThan(PUSH_STYLES.bet.arcHeight);
  });

  it("hands back the same style object per kind, so nothing allocates per push", () => {
    expect(pushStyleFor("raise")).toBe(PUSH_STYLES.raise);
  });
});
