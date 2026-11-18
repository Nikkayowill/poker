import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HITS_TO_BREAK,
  ORE_PER_BREAK,
  REGROW_MS,
  STONE_PER_SWING,
  STONE_NODE_IDS,
  STONE_NODES_ON_A_MAP,
  applyMiningSwing,
  effectiveNodeState,
  freshStoneNode,
  hasRegrown,
  isNodeMineable,
  isStoneNodeId,
  isStoneNodeOnAMap,
  oreForSwing,
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

describe("which Mine boulders stand on a map", () => {
  /** Every `stone:` tag the scene could draw, off every area it loads. */
  function stoneTagsOnTheMaps(): string[] {
    const dir = join(process.cwd(), "public/stackacres-td/areas");
    const tags: string[] = [];
    for (const area of readdirSync(dir)) {
      const file = join(dir, area, "area.json");
      if (!existsSync(file)) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/"tag":"(stone:[^"]+)"/g)) tags.push(match[1]);
    }
    return tags;
  }

  it("names exactly the boulders the maps draw", () => {
    expect([...STONE_NODES_ON_A_MAP].sort()).toEqual(stoneTagsOnTheMaps().sort());
  });

  it("has no Mine boulder on a map now", () => {
    for (const id of STONE_NODE_IDS) expect(isStoneNodeOnAMap(id), id).toBe(false);
  });
});

describe("applyMiningSwing", () => {
  it("takes exactly HITS_TO_BREAK swings to break a fresh node", () => {
    let node = freshStoneNode("stone:mine-1");
    for (let i = 0; i < HITS_TO_BREAK - 1; i += 1) {
      const result = applyMiningSwing(node, NOW);
      expect(result.broke).toBe(false);
      node = result.node;
    }
    const final = applyMiningSwing(node, NOW);
    expect(final.broke).toBe(true);
    expect(final.node.brokenAt).toBe(NOW.toISOString());
    expect(final.node.hitsRemaining).toBe(0);
  });

  it("pays STONE_PER_SWING (2) for every landed swing", () => {
    expect(STONE_PER_SWING).toBe(2);
    expect(applyMiningSwing(freshStoneNode("stone:mine-1"), NOW).yield).toBe(2);
  });

  it("pays Iron Ore only for the swing that breaks the node", () => {
    let node = freshStoneNode("stone:mine-1");
    let ore = 0;
    for (let i = 0; i < HITS_TO_BREAK; i += 1) {
      const result = applyMiningSwing(node, NOW);
      ore += oreForSwing(result.broke);
      node = result.node;
    }
    expect(ore).toBe(ORE_PER_BREAK);
    expect(oreForSwing(false)).toBe(0);
  });

  it("never lands on an already-broken node that has not regrown", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 4 };
    const soon = new Date(NOW.getTime() + 1000);
    const result = applyMiningSwing(broken, soon);
    expect(result.broke).toBe(false);
    expect(result.yield).toBe(0);
    expect(result.node).toEqual(broken);
  });

  it("regrows and accepts a swing once the regrow window has fully elapsed", () => {
    const broken = { nodeId: "stone:mine-1" as const, hitsRemaining: 0, brokenAt: NOW.toISOString(), version: 4 };
    const later = new Date(NOW.getTime() + REGROW_MS);
    const result = applyMiningSwing(broken, later);
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

