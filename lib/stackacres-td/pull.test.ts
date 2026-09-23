import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PULL_CATCH_MS,
  PULL_FRAMES_BEFORE_CATCH,
  PULL_FRAMES_BEFORE_GRIP,
  PULL_FRAMES_BEFORE_POP,
  PULL_GRIP_MS,
  PULL_HOP_PX,
  PULL_POP_MS,
  PULL_RISE_MS,
  PULL_SETTLE_MS,
  pullHopPoint,
} from "./pull";

interface Sheet {
  frames: Record<string, { duration: number }>;
  meta: { frameTags: { name: string; from: number; to: number }[] };
}

const sheet = JSON.parse(readFileSync("public/stackacres-td/characters/farmer.json", "utf8")) as Sheet;

function msBefore(facing: string, frames: number): number {
  const tag = sheet.meta.frameTags.find((t) => t.name === `harvest_${facing}`);
  expect(tag, `harvest_${facing} on the farmer's sheet`).toBeDefined();
  let total = 0;
  for (let i = 0; i < frames; i++) total += sheet.frames[String(tag!.from + i)].duration;
  return total;
}

describe("a picked crop moves with the farmer's hands", () => {
  for (const facing of ["down", "up", "left", "right"]) {
    it(`comes loose and lands in time with the ${facing} pick`, () => {
      expect(PULL_GRIP_MS).toBe(msBefore(facing, PULL_FRAMES_BEFORE_GRIP));
      expect(PULL_POP_MS).toBe(msBefore(facing, PULL_FRAMES_BEFORE_POP));
      expect(PULL_CATCH_MS).toBe(msBefore(facing, PULL_FRAMES_BEFORE_CATCH));
    });
  }

  it("leaves time to hop between rising out of the soil and the catch", () => {
    expect(PULL_POP_MS + PULL_RISE_MS).toBeLessThanOrEqual(PULL_CATCH_MS - 100);
  });

  it("is tucked away before the pick finishes, so a row can be picked at walking pace", () => {
    expect(PULL_CATCH_MS + PULL_SETTLE_MS).toBeLessThanOrEqual(msBefore("down", 4));
  });
});

describe("pullHopPoint", () => {
  const from = { x: 10, y: 50 };
  const to = { x: 30, y: 30 };

  it("starts at the bed and ends in his hands", () => {
    expect(pullHopPoint(0, from, to)).toEqual(from);
    expect(pullHopPoint(1, from, to)).toEqual(to);
  });

  it("peaks the hop above the straight line at the middle", () => {
    expect(pullHopPoint(0.5, from, to)).toEqual({ x: 20, y: 40 - PULL_HOP_PX });
  });

  it("clamps outside 0 to 1", () => {
    expect(pullHopPoint(-1, from, to)).toEqual(from);
    expect(pullHopPoint(2, from, to)).toEqual(to);
  });
});
