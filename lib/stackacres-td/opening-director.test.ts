import { describe, expect, it } from "vitest";
import { OPENING_LINES, OPENING_PORCH_FARMER, OPENING_PORCH_RAY } from "@/lib/stackacres/opening";
import type { Point } from "@/lib/stackacres-td/movement";
import { directOpening, OpeningSkipped, type OpeningActor, type OpeningStage } from "./opening-director";

/** A stage that takes no time, writes down what it was asked and can be told to refuse from some step on. */
function recordingStage(skipAfter = Infinity) {
  const calls: string[] = [];
  const at: Record<OpeningActor, Point> = { farmer: { x: 90, y: 484 }, ray: { x: 214, y: 486 } };
  const step = (what: string) => {
    calls.push(what);
    if (calls.length > skipAfter) throw new OpeningSkipped();
  };
  const stage: OpeningStage = {
    placeBus: () => step("bus"),
    driveBus: async () => step("drive"),
    openDoor: () => step("door"),
    stepOffBus: async () => step("step-off"),
    walk: async (who, to) => {
      step(`walk:${who}`);
      at[who] = to;
    },
    face: (who, facing) => step(`face:${who}:${facing}`),
    position: (who) => at[who],
    line: (text) => {
      if (text) calls.push(`say:${text}`);
    },
    cameraRidesBoth: () => step("camera"),
    wait: async () => step("wait"),
  };
  return { stage, calls, at };
}

describe("the opening's script", () => {
  it("brings the bus in before anyone steps off, and says every line in order", async () => {
    const { stage, calls } = recordingStage();
    await directOpening(stage);
    expect(calls.indexOf("bus")).toBeLessThan(calls.indexOf("drive"));
    expect(calls.indexOf("drive")).toBeLessThan(calls.indexOf("door"));
    expect(calls.indexOf("door")).toBeLessThan(calls.indexOf("step-off"));
    expect(calls.indexOf("step-off")).toBeLessThan(calls.indexOf("walk:farmer"));
    const said = calls.filter((call) => call.startsWith("say:")).map((call) => call.slice(4));
    expect(said).toEqual(OPENING_LINES.map((line) => line.text));
  });

  it("walks the two of them up to the porch before the porch lines", async () => {
    const { stage, calls, at } = recordingStage();
    await directOpening(stage);
    expect(at.ray).toEqual(OPENING_PORCH_RAY);
    expect(at.farmer).toEqual(OPENING_PORCH_FARMER);
    const firstPorchLine = calls.indexOf(`say:${OPENING_LINES.find((line) => line.at === "porch")!.text}`);
    expect(calls.lastIndexOf("walk:ray")).toBeLessThan(firstPorchLine);
  });

  it("stops at once when skipped and says nothing more", async () => {
    const { stage, calls } = recordingStage(6);
    await expect(directOpening(stage)).rejects.toBeInstanceOf(OpeningSkipped);
    expect(calls.filter((call) => call.startsWith("say:"))).toEqual([]);
  });
});
