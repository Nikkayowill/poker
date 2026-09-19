import { describe, expect, it } from "vitest";
import {
  HITS_TO_BREAK,
  REGROW_MS,
  STONE_NODE_IDS,
  applyMiningSwing,
  effectiveNodeState,
  freshStoneNode,
  hasRegrown,
  isNodeMineable,
  isStoneNodeId,
  regrowLabel,
} from "./stone-nodes";

const NOW = new Date("2026-09-18T12:00:00.000Z");

describe("isStoneNodeId", () => {
  it("accepts every seeded node id", () => {
    for (const id of STONE_NODE_IDS) expect(isStoneNodeId(id)).toBe(true);
  });

  it("rejects an unknown id", () => {
    expect(isStoneNodeId("stone:mine-99")).toBe(false);
    expect(isStoneNodeId("tree:homestead-1")).toBe(false);
  });
});

describe("applyMiningSwing", () => {
  it("takes exactly HITS_TO_BREAK swings to break a fresh node", () => {
    let node = freshStoneNode("stone:mine-1");
    for (let i = 0; i < HITS_TO_BREAK - 1; i += 1) {
      const result = applyMiningSwing(node, "hit", NOW);
      expect(result.broke).toBe(false);
      node = result.node;
    }
    const final = applyMiningSwing(node, "hit", NOW);
    expect(final.broke).toBe(true);
    expect(final.node.brokenAt).toBe(NOW.toISOString());
    expect(final.node.hitsRemaining).toBe(0);
  });

  it("pays out more Stone for a sweet swing than a plain one", () => {
    const node = freshStoneNode("stone:mine-1");
    const hit = applyMiningSwing(node, "hit", NOW);
    const sweet = applyMiningSwing(node, "sweet", NOW);
    expect(sweet.yield).toBeGreaterThan(hit.yield);
  });

  it("never lands on an already-broken node that has not regrown", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 4 };
    const soon = new Date(NOW.getTime() + 1000);
    const result = applyMiningSwing(broken, "sweet", soon);
    expect(result.broke).toBe(false);
    expect(result.yield).toBe(0);
    expect(result.node).toEqual(broken);
  });

  it("quality never changes whether the swing lands, only the yield", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 4 };
    const soon = new Date(NOW.getTime() + 1000);
    expect(applyMiningSwing(broken, "hit", soon).yield).toBe(0);
    expect(applyMiningSwing(broken, "sweet", soon).yield).toBe(0);
  });

  it("regrows and accepts a swing once the regrow window has fully elapsed", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 4 };
    const later = new Date(NOW.getTime() + REGROW_MS);
    const result = applyMiningSwing(broken, "hit", later);
    expect(result.broke).toBe(false);
    expect(result.yield).toBeGreaterThan(0);
    expect(result.node.hitsRemaining).toBe(HITS_TO_BREAK - 1);
  });
});

describe("hasRegrown / effectiveNodeState / isNodeMineable", () => {
  it("is not regrown a moment before the window elapses", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 1 };
    const almost = new Date(NOW.getTime() + REGROW_MS - 1);
    expect(hasRegrown(broken, almost)).toBe(false);
    expect(isNodeMineable(broken, almost)).toBe(false);
  });

  it("reports a regrown node as fresh without mutating the stored row", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 1 };
    const later = new Date(NOW.getTime() + REGROW_MS + 1);
    const effective = effectiveNodeState(broken, later);
    expect(effective.brokenAt).toBeNull();
    expect(effective.hitsRemaining).toBe(HITS_TO_BREAK);
    expect(broken.brokenAt).toBe(NOW.toISOString());
  });

  it("a fresh node is always mineable", () => {
    expect(isNodeMineable(freshStoneNode("stone:mine-2"), NOW)).toBe(true);
  });
});

describe("regrowLabel", () => {
  it("reads any moment once the window has elapsed", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 1 };
    expect(regrowLabel(broken, NOW.getTime() + REGROW_MS + 1)).toBe("any moment");
  });

  it("counts minutes while the node is still down", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 1 };
    expect(regrowLabel(broken, NOW.getTime() + 60_000)).toBe("17m");
  });
});
