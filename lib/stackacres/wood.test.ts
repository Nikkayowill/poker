import { describe, expect, it } from "vitest";
import {
  WOOD_FELL_BONUS,
  WOOD_HITS_TO_FELL,
  WOOD_PER_HIT,
  WOOD_RESPAWN_MS,
  WOOD_SWEET_HIT_BONUS,
  freshWoodNodeState,
  isWoodNodeChoppable,
  isWoodNodeFelled,
  swingAtWoodNode,
  woodNodeReadyAt,
  woodNodeRespawnProgress,
  woodNodeSnapshot,
} from "./wood";

const NOW = new Date("2026-09-18T12:00:00.000Z");

describe("freshWoodNodeState", () => {
  it("starts standing, full health", () => {
    const state = freshWoodNodeState();
    expect(state.hitsRemaining).toBe(WOOD_HITS_TO_FELL);
    expect(isWoodNodeFelled(state)).toBe(false);
    expect(isWoodNodeChoppable(state, NOW)).toBe(true);
  });
});

describe("swingAtWoodNode", () => {
  it("refuses a swing on a felled tree still inside its respawn window", () => {
    const felled = { hitsRemaining: 0, felledAt: NOW.toISOString() };
    const later = new Date(NOW.getTime() + WOOD_RESPAWN_MS - 1);
    expect(isWoodNodeChoppable(felled, later)).toBe(false);
    expect(swingAtWoodNode(felled, later, false)).toBeNull();
  });

  it("lets a swing land again once the respawn clock clears, resetting hits", () => {
    const felled = { hitsRemaining: 0, felledAt: NOW.toISOString() };
    const respawned = new Date(NOW.getTime() + WOOD_RESPAWN_MS);
    expect(isWoodNodeChoppable(felled, respawned)).toBe(true);
    const result = swingAtWoodNode(felled, respawned, false);
    expect(result).not.toBeNull();
    expect(result!.nextState.hitsRemaining).toBe(WOOD_HITS_TO_FELL - 1);
    expect(result!.felled).toBe(false);
  });

  it("takes WOOD_HITS_TO_FELL ordinary swings to fell a fresh tree", () => {
    let state = freshWoodNodeState();
    for (let i = 0; i < WOOD_HITS_TO_FELL - 1; i++) {
      const result = swingAtWoodNode(state, NOW, false);
      expect(result).not.toBeNull();
      expect(result!.felled).toBe(false);
      expect(result!.woodGained).toBe(WOOD_PER_HIT);
      state = result!.nextState;
    }
    const last = swingAtWoodNode(state, NOW, false);
    expect(last).not.toBeNull();
    expect(last!.felled).toBe(true);
    expect(last!.woodGained).toBe(WOOD_PER_HIT + WOOD_FELL_BONUS);
    expect(isWoodNodeFelled(last!.nextState)).toBe(true);
    expect(isWoodNodeChoppable(last!.nextState, NOW)).toBe(false);
  });

  it("pays the sweet-hit bonus on top of the ordinary yield", () => {
    const state = freshWoodNodeState();
    const result = swingAtWoodNode(state, NOW, true);
    expect(result!.woodGained).toBe(WOOD_PER_HIT + WOOD_SWEET_HIT_BONUS);
  });

  it("cannot double-fell a tree that is already down", () => {
    // Two rapid swings against the same stale state: the caller (the
    // server's version-guarded write) is what actually prevents a second
    // credit from landing, but this pure function must itself refuse the
    // second swing against a state it has already marked felled.
    const state = freshWoodNodeState();
    const felledOnThisSwing = { hitsRemaining: 1, felledAt: null };
    const first = swingAtWoodNode(felledOnThisSwing, NOW, false)!;
    expect(first.felled).toBe(true);
    const second = swingAtWoodNode(first.nextState, NOW, false);
    expect(second).toBeNull();
    void state;
  });
});

describe("woodNodeReadyAt / woodNodeRespawnProgress", () => {
  it("is null for a standing tree", () => {
    const state = freshWoodNodeState();
    expect(woodNodeReadyAt(state)).toBeNull();
    expect(woodNodeRespawnProgress(state, NOW)).toBeNull();
  });

  it("runs 0..1 across the respawn window for a felled tree", () => {
    const felled = { hitsRemaining: 0, felledAt: NOW.toISOString() };
    expect(woodNodeRespawnProgress(felled, NOW)).toBe(0);
    expect(
      woodNodeRespawnProgress(felled, new Date(NOW.getTime() + WOOD_RESPAWN_MS / 2)),
    ).toBeCloseTo(0.5);
    expect(woodNodeRespawnProgress(felled, new Date(NOW.getTime() + WOOD_RESPAWN_MS))).toBe(1);
    expect(woodNodeReadyAt(felled)).toBe(NOW.getTime() + WOOD_RESPAWN_MS);
  });
});

describe("woodNodeSnapshot", () => {
  it("reports readiness, hits and respawn progress together", () => {
    const felled = { hitsRemaining: 0, felledAt: NOW.toISOString() };
    const snapshot = woodNodeSnapshot("homestead-1", felled, NOW);
    expect(snapshot).toEqual({
      nodeId: "homestead-1",
      ready: false,
      hitsRemaining: 0,
      respawnProgress: 0,
    });
  });
});
