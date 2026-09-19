import { describe, expect, it } from "vitest";
import { WOOD_NODE_IDS, isWoodNodeId } from "./tree-nodes";

describe("isWoodNodeId", () => {
  it("accepts every catalogued node id", () => {
    for (const id of WOOD_NODE_IDS) expect(isWoodNodeId(id)).toBe(true);
  });

  it("rejects anything not in the catalogue", () => {
    expect(isWoodNodeId("oak-1")).toBe(false);
    expect(isWoodNodeId("")).toBe(false);
  });
});
