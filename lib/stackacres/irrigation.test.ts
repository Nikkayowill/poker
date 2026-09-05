import { describe, expect, it } from "vitest";

import {
  PIPE_FLOW_FRAMES,
  PIPE_MAX_REACH,
  PIPE_TILE,
  diffPipeGrid,
  pipeFlowFrame,
  pipeKey,
  pipeSyncPayload,
  pipeTileAt,
  recalculatePipeConnections,
  type GridSnapshot,
  type PlacedPipe,
} from "./irrigation";

/** A straight run of `count` pipe tiles east from (0,0), plus a well behind
 *  it at (-1, 0) unless `wellAt` says otherwise. */
function line(count: number, well: PlacedPipe | null = { tx: -1, ty: 0, kind: "well" }): PlacedPipe[] {
  const tiles: PlacedPipe[] = [];
  if (well) tiles.push(well);
  for (let i = 0; i < count; i += 1) tiles.push({ tx: i, ty: 0, kind: "pipe" });
  return tiles;
}

describe("pipeTileAt", () => {
  it("floors, so negatives do not fold onto zero", () => {
    expect(pipeTileAt(-0.5, -0.5)).toEqual({ tx: -1, ty: -1 });
    expect(pipeTileAt(0.5, 0.5)).toEqual({ tx: 0, ty: 0 });
    expect(pipeTileAt(PIPE_TILE * 3 + 1, -PIPE_TILE)).toEqual({ tx: 3, ty: -1 });
  });
});

describe("recalculatePipeConnections — connector framing", () => {
  it("reads the 4 diamond neighbours into a bitmask N=1 E=2 S=4 W=8", () => {
    const snapshot: GridSnapshot = {
      tiles: [
        { tx: 0, ty: 0, kind: "pipe" },
        { tx: 0, ty: -1, kind: "pipe" }, // N
        { tx: 1, ty: 0, kind: "pipe" }, // E
      ],
      crops: [],
    };
    const grid = recalculatePipeConnections(snapshot);
    expect(grid.byKey.get(pipeKey(0, 0))?.mask).toBe(0b0011);
  });

  it("frames a 4-way cross as 15 and an isolated tile as 0", () => {
    const cross: GridSnapshot = {
      tiles: [
        { tx: 0, ty: 0, kind: "pipe" },
        { tx: 0, ty: -1, kind: "pipe" },
        { tx: 0, ty: 1, kind: "pipe" },
        { tx: 1, ty: 0, kind: "pipe" },
        { tx: -1, ty: 0, kind: "pipe" },
      ],
      crops: [],
    };
    expect(recalculatePipeConnections(cross).byKey.get(pipeKey(0, 0))?.mask).toBe(15);

    const lone: GridSnapshot = { tiles: [{ tx: 5, ty: 5, kind: "pipe" }], crops: [] };
    expect(recalculatePipeConnections(lone).byKey.get(pipeKey(5, 5))?.mask).toBe(0);
  });

  it("a dry pipe still joins its neighbours (mask ignores hydration)", () => {
    // No well anywhere: nothing is hydrated, but the elbow is still an elbow.
    const snapshot: GridSnapshot = {
      tiles: [
        { tx: 0, ty: 0, kind: "pipe" },
        { tx: 1, ty: 0, kind: "pipe" },
        { tx: 0, ty: 1, kind: "pipe" },
      ],
      crops: [],
    };
    const node = recalculatePipeConnections(snapshot).byKey.get(pipeKey(0, 0));
    expect(node?.mask).toBe(0b0110); // E | S
    expect(node?.hydrated).toBe(false);
  });
});

describe("recalculatePipeConnections — fluid propagation (BFS)", () => {
  it("hydrates the well and every pipe within PIPE_MAX_REACH, and no further", () => {
    const grid = recalculatePipeConnections({ tiles: line(12), crops: [] });
    expect(grid.byKey.get(pipeKey(-1, 0))?.distance).toBe(0); // well
    for (let i = 0; i < PIPE_MAX_REACH; i += 1) {
      expect(grid.byKey.get(pipeKey(i, 0))?.hydrated).toBe(true);
      expect(grid.byKey.get(pipeKey(i, 0))?.distance).toBe(i + 1);
    }
    // The 9th pipe (distance would be 9) is out of reach.
    expect(grid.byKey.get(pipeKey(PIPE_MAX_REACH, 0))?.hydrated).toBe(false);
    expect(grid.byKey.get(pipeKey(PIPE_MAX_REACH, 0))?.distance).toBeNull();
  });

  it("takes the shortest path when two wells feed one pipe", () => {
    const snapshot: GridSnapshot = {
      tiles: [
        { tx: -1, ty: 0, kind: "well" },
        { tx: 10, ty: 0, kind: "well" },
        ...Array.from({ length: 10 }, (_, i): PlacedPipe => ({ tx: i, ty: 0, kind: "pipe" })),
      ],
      crops: [],
    };
    const grid = recalculatePipeConnections(snapshot);
    // Pipe 9 is 1 step from the right well (10); pipe 8 is 2. Pipe 4 is 5
    // steps from the left well (-1) and 6 from the right — the flood takes
    // the nearer.
    expect(grid.byKey.get(pipeKey(9, 0))?.distance).toBe(1);
    expect(grid.byKey.get(pipeKey(8, 0))?.distance).toBe(2);
    expect(grid.byKey.get(pipeKey(4, 0))?.distance).toBe(5);
  });

  it("a gap in the run stops the water", () => {
    const snapshot: GridSnapshot = {
      tiles: [
        { tx: -1, ty: 0, kind: "well" },
        { tx: 0, ty: 0, kind: "pipe" },
        { tx: 1, ty: 0, kind: "pipe" },
        // gap at tx 2
        { tx: 3, ty: 0, kind: "pipe" },
      ],
      crops: [],
    };
    const grid = recalculatePipeConnections(snapshot);
    expect(grid.byKey.get(pipeKey(1, 0))?.hydrated).toBe(true);
    expect(grid.byKey.get(pipeKey(3, 0))?.hydrated).toBe(false);
  });

  it("a network with no well hydrates nothing", () => {
    const grid = recalculatePipeConnections({ tiles: line(4, null), crops: [] });
    expect(grid.nodes.every((n) => !n.hydrated)).toBe(true);
    expect(grid.sources).toHaveLength(0);
  });
});

describe("recalculatePipeConnections — irrigated crops", () => {
  const cropOn = (tx: number, ty: number, unitId: string): GridSnapshot["crops"][number] => ({
    unitId,
    worldX: (tx + 0.5) * PIPE_TILE,
    worldY: (ty + 0.5) * PIPE_TILE,
  });

  it("waters a crop on a hydrated pipe tile or a diamond neighbour of one", () => {
    const grid = recalculatePipeConnections({
      tiles: line(4),
      crops: [
        cropOn(1, 0, "on-pipe"),
        cropOn(1, 1, "neighbour"),
        cropOn(1, 3, "far"),
      ],
    });
    expect(grid.irrigatedUnitIds.has("on-pipe")).toBe(true);
    expect(grid.irrigatedUnitIds.has("neighbour")).toBe(true);
    expect(grid.irrigatedUnitIds.has("far")).toBe(false);
  });

  it("a well waters nothing on its own — only pipe carries water to crops", () => {
    const grid = recalculatePipeConnections({
      tiles: [{ tx: 0, ty: 0, kind: "well" }],
      crops: [cropOn(0, 0, "under-well"), cropOn(1, 0, "beside-well")],
    });
    expect(grid.irrigatedUnitIds.size).toBe(0);
  });

  it("a crop beside a dry (unreached) pipe is not watered", () => {
    const grid = recalculatePipeConnections({
      tiles: line(12),
      crops: [cropOn(PIPE_MAX_REACH + 1, 0, "beside-dry")],
    });
    expect(grid.irrigatedUnitIds.has("beside-dry")).toBe(false);
  });
});

describe("pipeFlowFrame", () => {
  it("is null for dry tiles and wells, in range for hydrated pipe", () => {
    const grid = recalculatePipeConnections({ tiles: line(12), crops: [] });
    expect(pipeFlowFrame(grid.byKey.get(pipeKey(-1, 0))!, 0)).toBeNull(); // well
    expect(pipeFlowFrame(grid.byKey.get(pipeKey(PIPE_MAX_REACH, 0))!, 0)).toBeNull(); // dry
    const wet = grid.byKey.get(pipeKey(2, 0))!;
    for (const t of [0, 137, 900, 5000]) {
      const frame = pipeFlowFrame(wet, t);
      expect(frame).not.toBeNull();
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(PIPE_FLOW_FRAMES);
    }
  });

  it("offsets successive tiles so the wavefront marches outward", () => {
    const grid = recalculatePipeConnections({ tiles: line(6), crops: [] });
    const a = pipeFlowFrame(grid.byKey.get(pipeKey(0, 0))!, 0);
    const b = pipeFlowFrame(grid.byKey.get(pipeKey(1, 0))!, 0);
    expect(a).not.toBe(b);
  });
});

describe("diffPipeGrid", () => {
  it("reports adds, mask changes and removals against the previous grid", () => {
    const first = recalculatePipeConnections({ tiles: line(3), crops: [] });
    const second = recalculatePipeConnections({
      tiles: [...line(3), { tx: 1, ty: 1, kind: "pipe" }, { tx: 2, ty: 1, kind: "pipe" }],
      crops: [],
    });
    const diff = diffPipeGrid(first, second);
    const addedKeys = diff.added.map((n) => pipeKey(n.tx, n.ty)).sort();
    expect(addedKeys).toEqual(["1:1", "2:1"]);
    // (1,0) gained a south link, so its mask changed.
    expect(diff.changed.some((n) => pipeKey(n.tx, n.ty) === pipeKey(1, 0))).toBe(true);
    expect(diff.removed).toHaveLength(0);

    const third = recalculatePipeConnections({ tiles: line(2), crops: [] });
    expect(diffPipeGrid(second, third).removed).toContain(pipeKey(2, 0));
  });

  it("against a null previous grid, every node is an add", () => {
    const grid = recalculatePipeConnections({ tiles: line(3), crops: [] });
    expect(diffPipeGrid(null, grid).added).toHaveLength(grid.nodes.length);
  });
});

describe("pipeSyncPayload", () => {
  it("flattens every node's derived state for jsonb_to_recordset", () => {
    const grid = recalculatePipeConnections({ tiles: line(2), crops: [] });
    expect(pipeSyncPayload(grid)).toEqual(
      expect.arrayContaining([
        { tx: -1, ty: 0, mask: 0b0010, hydrated: true, distance: 0 },
        { tx: 0, ty: 0, mask: 0b1010, hydrated: true, distance: 1 },
      ]),
    );
  });
});
