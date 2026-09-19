import { describe, expect, it } from "vitest";
import { REGROW_MS } from "@/lib/stackacres/stone-nodes";
import { WOOD_RESPAWN_MS } from "@/lib/stackacres/wood";
import { NODE_ART, gatherKindOfTag, spentStones, spentTrees } from "./gather-nodes";

const node = <Id extends string>(nodeId: Id, ready: boolean, respawnProgress: number | null) => ({
  nodeId,
  ready,
  hitsRemaining: ready ? 3 : 0,
  respawnProgress,
});

describe("spentTrees", () => {
  it("leaves standing and regrown trees alone", () => {
    expect(spentTrees([node("homestead-1", true, null), node("homestead-2", true, 1)], 1000)).toEqual([]);
  });

  it("makes a stump of a tree that is still regrowing, named by its tag", () => {
    const [tree] = spentTrees([node("homestead-3", false, 0.25)], 1000);
    expect(tree.tag).toBe("tree:homestead-3");
    expect(tree.regrowAt).toBe(1000 + WOOD_RESPAWN_MS * 0.75);
  });

  it("gives a tree felled just now the full wait", () => {
    const [tree] = spentTrees([node("homestead-4", false, 0)], 5000);
    expect(tree.regrowAt).toBe(5000 + WOOD_RESPAWN_MS);
  });

  it("treats a missing or out-of-range progress as the full wait or none", () => {
    const [missing, over] = spentTrees([node("a", false, null), node("b", false, 3)], 0);
    expect(missing.regrowAt).toBe(WOOD_RESPAWN_MS);
    expect(over.regrowAt).toBe(0);
  });
});

describe("spentStones", () => {
  it("leaves a boulder alone until it has been broken", () => {
    expect(spentStones([node("stone:mine-1" as const, true, null)], 0)).toEqual([]);
  });

  it("keeps the stone id as the tag and waits out the longer stone regrow", () => {
    const [rock] = spentStones([node("stone:mine-2" as const, false, 0.5)], 100);
    expect(rock.tag).toBe("stone:mine-2");
    expect(rock.regrowAt).toBe(100 + REGROW_MS * 0.5);
  });
});

describe("gatherKindOfTag", () => {
  it("names trees and boulders", () => {
    expect(gatherKindOfTag("tree:homestead-2")).toBe("tree");
    expect(gatherKindOfTag("stone:mine-1")).toBe("stone");
  });

  it("ignores every other tag", () => {
    expect(gatherKindOfTag(undefined)).toBeNull();
    expect(gatherKindOfTag("barn")).toBeNull();
    expect(gatherKindOfTag("tree:")).toBeNull();
    expect(gatherKindOfTag("stone:")).toBeNull();
  });
});

describe("node art", () => {
  for (const [kind, art] of Object.entries(NODE_ART)) {
    it(`${kind}: is a clean rectangle that only uses colours it defines`, () => {
      const width = art.rows[0].length;
      for (const row of art.rows) {
        expect(row).toHaveLength(width);
        for (const ch of row) if (ch !== ".") expect(art.colors[ch]).toBeDefined();
      }
    });

    it(`${kind}: rests on solid ground, an outline all the way across its middle`, () => {
      expect(art.rows[art.rows.length - 1].slice(2, -2)).toMatch(/^O+$/);
    });
  }
});
