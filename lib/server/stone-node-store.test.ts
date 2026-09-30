import { beforeEach, describe, expect, it, vi } from "vitest";

const inFn = vi.fn();
const selectFn = vi.fn(() => ({ in: inFn }));
const fromFn = vi.fn(() => ({ select: selectFn }));
vi.mock("./supabase-admin", () => ({ adminClient: () => ({ from: fromFn }) }));

import { STONE_NODE_IDS } from "@/lib/stackacres/stone-nodes";
import { readAllStoneNodes } from "./stone-node-store";

const NOW = new Date("2026-09-28T12:00:00.000Z");

const row = (nodeId: string, hitsRemaining: number) => ({
  node_id: nodeId,
  hits_remaining: hitsRemaining,
  broken_at: null,
  version: 0,
});

describe("readAllStoneNodes against the database", () => {
  beforeEach(() => {
    fromFn.mockClear();
    selectFn.mockClear();
    inFn.mockReset();
  });

  it("reads every boulder in one round trip, not one per node", async () => {
    inFn.mockResolvedValue({
      data: STONE_NODE_IDS.map((id) => row(id, 4)),
      error: null,
    });

    const nodes = await readAllStoneNodes(NOW);

    expect(fromFn).toHaveBeenCalledTimes(1);
    expect(fromFn).toHaveBeenCalledWith("homestead_stone_nodes");
    expect(inFn).toHaveBeenCalledWith("node_id", STONE_NODE_IDS);
    expect(nodes.map((n) => n.nodeId)).toEqual([...STONE_NODE_IDS]);
  });

  it("throws when the query itself fails", async () => {
    inFn.mockResolvedValue({ data: null, error: { message: "connection failure" } });
    await expect(readAllStoneNodes(NOW)).rejects.toThrow(/Could not read the Mine's boulders/);
  });

  it("throws rather than silently dropping a node missing from the result set", async () => {
    inFn.mockResolvedValue({ data: [row(STONE_NODE_IDS[0], 4)], error: null });
    await expect(readAllStoneNodes(NOW)).rejects.toThrow(/is missing/);
  });
});
