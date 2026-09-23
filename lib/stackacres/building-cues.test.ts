import { describe, expect, it } from "vitest";
import { buildingCueDoors, buildingCues, type BuildingCueInput } from "./building-cues";
import type { StackAcresMachineSnapshot } from "./machines";
import type { VatContainer } from "./aging";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

function machine(overrides: Partial<StackAcresMachineSnapshot> = {}): StackAcresMachineSnapshot {
  return {
    id: "m1",
    kind: "mill",
    status: "idle",
    startedAt: null,
    readyAt: null,
    recipeId: null,
    unitsProcessing: 0,
    done: false,
    progress: null,
    autoFeedsLeft: null,
    standingRecipe: null,
    kitchenSince: null,
    ...overrides,
  };
}

const finished = (kind: StackAcresMachineSnapshot["kind"]) =>
  machine({ kind, status: "working", readyAt: new Date(NOW - 1000).toISOString() });

const container = (status: VatContainer["status"]): Pick<VatContainer, "status"> => ({ status });

const farm = (patch: Partial<BuildingCueInput> = {}): BuildingCueInput => ({
  machines: [],
  vat: null,
  cellar: null,
  nowMs: NOW,
  ...patch,
});

describe("building cues", () => {
  it("says nothing on a farm with no buildings", () => {
    expect(buildingCues(farm())).toEqual([]);
    expect(buildingCueDoors(farm())).toEqual({});
  });

  it("puts a finished Mill run behind the Workshop door", () => {
    const cues = buildingCues(farm({ machines: [finished("mill")] }));
    expect(cues).toHaveLength(1);
    expect(cues[0].door).toBe("workshop");
    expect(cues[0].where).toBe("Workshop");
    expect(cues[0].line).toContain("Workshop");
  });

  it("puts a finished Oven run behind the farmhouse door", () => {
    const cues = buildingCues(farm({ machines: [finished("oven")] }));
    expect(cues[0].door).toBe("farmhouse");
    expect(cues[0].line).toContain("kitchen");
  });

  it("counts several finished runs in one room in one line", () => {
    const cues = buildingCues(farm({ machines: [finished("mill"), finished("loom")] }));
    expect(cues).toHaveLength(1);
    expect(cues[0].line).toContain("2 things");
  });

  it("ignores a run that has not finished yet", () => {
    const working = machine({ status: "working", readyAt: new Date(NOW + 60_000).toISOString() });
    expect(buildingCues(farm({ machines: [working] }))).toEqual([]);
  });

  it("gives the vat and the cellar their own lines, not a machine count", () => {
    const cues = buildingCues(
      farm({
        machines: [finished("vat"), finished("cellar")],
        vat: container("collectible"),
        cellar: container("collectible"),
      }),
    );
    expect(cues.map((cue) => cue.line)).toEqual([
      "The jars in the cellar have finished aging.",
      "There's a batch sitting ready in the vat.",
    ]);
  });

  it("stays quiet while a batch is still aging", () => {
    expect(buildingCues(farm({ vat: container("aging"), cellar: container("aging") }))).toEqual([]);
  });

  it("names the kitchen's banked batches", () => {
    const kitchen = machine({
      kind: "farm_kitchen",
      standingRecipe: "pickles",
      kitchenSince: new Date(NOW - 4 * 60 * 60 * 1000).toISOString(),
    });
    const cues = buildingCues(farm({ machines: [kitchen] }));
    expect(cues).toHaveLength(1);
    expect(cues[0].door).toBe("farmhouse");
    expect(cues[0].line).toMatch(/\d+ batches banked/);
  });

  it("flags both doors at once", () => {
    expect(
      buildingCueDoors(farm({ machines: [finished("mill")], cellar: container("collectible") })),
    ).toEqual({ workshop: true, farmhouse: true });
  });
});
