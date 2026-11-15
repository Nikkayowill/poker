import { describe, expect, it } from "vitest";
import homesteadArea from "@/public/stackacres-td/areas/homestead/area.json";
import { WOOD_NODE_IDS, isWoodNodeId, treeNodeIdForProp } from "./tree-nodes";

describe("isWoodNodeId", () => {
  it("accepts every catalogued node id", () => {
    for (const id of WOOD_NODE_IDS) expect(isWoodNodeId(id)).toBe(true);
  });

  it("rejects anything not in the catalogue", () => {
    expect(isWoodNodeId("oak-1")).toBe(false);
    expect(isWoodNodeId("")).toBe(false);
  });
});

describe("tree catalogue", () => {
  it("never repeats an id", () => {
    expect(new Set(WOOD_NODE_IDS).size).toBe(WOOD_NODE_IDS.length);
  });

  it("keeps the four original ids on the trees that already carry them", () => {
    const tagged = homesteadArea.props.filter((prop) => "tag" in prop && String(prop.tag).startsWith("tree:"));
    expect(tagged).toHaveLength(4);
    for (const prop of tagged) expect(`tree:${treeNodeIdForProp(prop)}`).toBe(prop.tag);
  });

  it("names a new tree by where it stands", () => {
    const natural = homesteadArea.props.find((prop) => "sway" in prop && prop.h >= 30 && !("tag" in prop));
    expect(natural).toBeDefined();
    expect(treeNodeIdForProp(natural!)).toBe(`homestead-tree-${natural!.x}-${natural!.y}`);
  });

  it("leaves scenery that is not a tree alone", () => {
    expect(treeNodeIdForProp({ x: -1, y: -1, frame: "nothing" })).toBeNull();
  });
});
