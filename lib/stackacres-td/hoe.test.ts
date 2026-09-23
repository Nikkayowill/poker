import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BED_DROP_FROM, BED_DROP_MS, HOE_FRAMES_BEFORE_STRIKE, HOE_STRIKE_MS } from "./hoe";

interface Sheet {
  frames: Record<string, { duration: number }>;
  meta: { frameTags: { name: string; from: number; to: number }[] };
}

const sheet = JSON.parse(readFileSync("public/stackacres-td/characters/farmer.json", "utf8")) as Sheet;

describe("the hoe stroke lands with the swing", () => {
  for (const facing of ["down", "up", "left", "right"]) {
    it(`strikes when the ${facing} swing's blade reaches the ground`, () => {
      const tag = sheet.meta.frameTags.find((t) => t.name === `chop_${facing}`);
      expect(tag, `chop_${facing} on the farmer's sheet`).toBeDefined();
      let before = 0;
      for (let i = 0; i < HOE_FRAMES_BEFORE_STRIKE; i++) before += sheet.frames[String(tag!.from + i)].duration;
      expect(HOE_STRIKE_MS).toBe(before);
    });
  }

  it("drops the square in quickly enough that a row can be hoed at walking pace", () => {
    expect(HOE_STRIKE_MS + BED_DROP_MS).toBeLessThan(700);
    expect(BED_DROP_FROM).toBeGreaterThan(0);
    expect(BED_DROP_FROM).toBeLessThan(1);
  });
});
