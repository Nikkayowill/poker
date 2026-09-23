import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BED_DROP_FROM, BED_DROP_MS, HOE_STRIKE_MS } from "./hoe";
import { SWING_FRAMES_BEFORE_STRIKE, SWING_STRIKE_MS, swingToolFor } from "./swing";

interface Sheet {
  frames: Record<string, { duration: number }>;
  meta: { frameTags: { name: string; from: number; to: number }[] };
}

const sheet = JSON.parse(readFileSync("public/stackacres-td/characters/farmer.json", "utf8")) as Sheet;

describe("the swing lands on its strike frame", () => {
  for (const tool of ["hoe", "axe", "pick"]) {
    for (const facing of ["down", "up", "left", "right"]) {
      it(`${tool}_${facing} strikes at SWING_STRIKE_MS`, () => {
        const tag = sheet.meta.frameTags.find((t) => t.name === `${tool}_${facing}`);
        expect(tag, `${tool}_${facing} on the farmer's sheet`).toBeDefined();
        let before = 0;
        for (let i = 0; i < SWING_FRAMES_BEFORE_STRIKE; i++) before += sheet.frames[String(tag!.from + i)].duration;
        expect(SWING_STRIKE_MS).toBe(before);
      });
    }
  }

  it("keeps the old sheet in place: the swings come after everything the scene names by index", () => {
    const first = Math.min(...sheet.meta.frameTags.filter((t) => /^(hoe|axe|pick)_/.test(t.name)).map((t) => t.from));
    const rest = sheet.meta.frameTags.filter((t) => !/^(hoe|axe|pick)_/.test(t.name));
    expect(Math.max(...rest.map((t) => t.to))).toBeLessThan(first);
  });

  it("drops a hoed square in quickly enough that a row can be hoed at walking pace", () => {
    expect(HOE_STRIKE_MS).toBe(SWING_STRIKE_MS);
    expect(HOE_STRIKE_MS + BED_DROP_MS).toBeLessThan(700);
    expect(BED_DROP_FROM).toBeGreaterThan(0);
    expect(BED_DROP_FROM).toBeLessThan(1);
  });
});

describe("swingToolFor", () => {
  it("swings the axe at trees and scrub and the pick at rock", () => {
    expect(swingToolFor("tree:homestead-1")).toBe("axe");
    expect(swingToolFor("stone:mine-1")).toBe("pick");
    expect(swingToolFor("land:cropfields-01", "tree")).toBe("axe");
    expect(swingToolFor("land:cropfields-02", "scrub")).toBe("axe");
    expect(swingToolFor("land:cropfields-03", "boulder")).toBe("pick");
  });

  it("is not a swing anywhere else", () => {
    expect(swingToolFor("well")).toBeNull();
    expect(swingToolFor("forage:bush-1")).toBeNull();
    expect(swingToolFor("land:cropfields-01")).toBeNull();
  });
});
