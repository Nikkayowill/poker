import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DROP_FALL_MS,
  POUR_FRAMES_BEFORE,
  POUR_HOLD_MS,
  POUR_MS,
  SPOUT,
  SPLASH_SPREAD,
  dropPoint,
  pourDrops,
} from "./water-pour";

interface Sheet {
  frames: Record<string, { duration: number; frame: { x: number; y: number; w: number; h: number } }>;
  meta: { frameTags: { name: string; from: number; to: number }[] };
}

const FACINGS = ["down", "up", "left", "right"] as const;
const sheet = JSON.parse(readFileSync("public/stackacres-td/characters/farmer.json", "utf8")) as Sheet;
/** The point the scene anchors him by: sprite origin (0.5, 44/48) of a 48 frame. */
const FEET = { x: 24, y: 44 };

function tag(facing: string) {
  const found = sheet.meta.frameTags.find((t) => t.name === `water_${facing}`);
  expect(found, `water_${facing} on the farmer's sheet`).toBeDefined();
  return found!;
}

describe("the water pours on the tipped frame", () => {
  for (const facing of FACINGS) {
    it(`tips at POUR_MS and holds for POUR_HOLD_MS facing ${facing}`, () => {
      const { from, to } = tag(facing);
      expect(to - from + 1).toBe(POUR_FRAMES_BEFORE + 1);
      let before = 0;
      for (let i = 0; i < POUR_FRAMES_BEFORE; i++) before += sheet.frames[String(from + i)].duration;
      expect(POUR_MS).toBe(before);
      expect(POUR_HOLD_MS).toBe(sheet.frames[String(from + POUR_FRAMES_BEFORE)].duration);
    });
  }

  it("comes out of the can's spout, not beside it", async () => {
    const { data, info } = await sharp("public/stackacres-td/characters/farmer.png")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const facing of FACINGS) {
      const { frame } = sheet.frames[String(tag(facing).from + POUR_FRAMES_BEFORE)];
      const x = frame.x + FEET.x + SPOUT[facing].at.x;
      const y = frame.y + FEET.y + SPOUT[facing].at.y;
      expect(data[(y * info.width + x) * 4 + 3], `spout pixel facing ${facing}`).toBe(255);
    }
  });
});

describe("pourDrops", () => {
  it("lets every drop go while the can is tipped", () => {
    const drops = pourDrops();
    expect(drops[0].delay).toBe(0);
    for (const drop of drops) expect(drop.delay + DROP_FALL_MS / 3).toBeLessThanOrEqual(POUR_HOLD_MS);
  });

  it("lands them on the middle of the square", () => {
    for (const { land } of pourDrops()) {
      expect(Math.abs(land.x)).toBeLessThanOrEqual(SPLASH_SPREAD.x);
      expect(Math.abs(land.y)).toBeLessThanOrEqual(SPLASH_SPREAD.y);
    }
  });

  it("is the same every pour", () => {
    expect(pourDrops()).toEqual(pourDrops());
  });
});

describe("dropPoint", () => {
  const spout = { x: 10, y: 20 };
  const land = { x: 6, y: 28 };

  it("starts at the spout and ends on the soil", () => {
    expect(dropPoint(spout, 6, land, 0)).toEqual(spout);
    expect(dropPoint(spout, 6, land, 1)).toEqual(land);
  });

  it("falls faster as it goes, the way water does", () => {
    const early = dropPoint(spout, 6, land, 0.25).y - dropPoint(spout, 6, land, 0).y;
    const late = dropPoint(spout, 6, land, 1).y - dropPoint(spout, 6, land, 0.75).y;
    expect(late).toBeGreaterThan(early);
  });
});
