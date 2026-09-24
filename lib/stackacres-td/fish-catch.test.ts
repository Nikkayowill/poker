import sharp from "sharp";
import { describe, expect, it } from "vitest";
import farmerRig from "@/public/stackacres-td/characters/farmer.json";
import { FISH_SPECIES } from "@/lib/stackacres/fishing";
import {
  FISH_AT_CHEST,
  FISH_CELL,
  FISH_OVERHEAD,
  FISH_TURN_MS,
  HOLD_FRAME_MS,
  LIFT_END_MS,
  LIFT_START_MS,
  fishFlight,
  fishFrame,
  heldOffset,
} from "./fish-catch";
import { bobberSpot } from "./fishing-cast";

/** Where a character's feet are in a 48px frame (the sprite's origin in scene.ts). */
const FEET = { x: 24, y: 44 };
const FRAME = 48;

interface Pixels {
  data: Buffer;
  width: number;
  height: number;
}

async function png(path: string): Promise<Pixels> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function alpha(image: Pixels, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3];
}

const farmer = await png("public/stackacres-td/characters/farmer.png");
const fish = await png("public/stackacres-td/common/fish.png");
const hold = farmerRig.meta.frameTags.find((tag) => tag.name === "hold_down")!;

function framePos(index: number): { x: number; y: number } {
  const { frame } = (farmerRig.frames as Record<string, { frame: { x: number; y: number } }>)[String(index)];
  return frame;
}

/** The first drawn row of a sheet frame, as a distance above his feet. */
function topAboveFeet(index: number): number {
  const at = framePos(index);
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) if (alpha(farmer, at.x + x, at.y + y) > 0) return FEET.y - y;
  }
  throw new Error(`frame ${index} is empty`);
}

describe("the farmer's hold_down frames", () => {
  it("are on the sheet with the holds the lift is timed against", () => {
    expect(hold).toBeDefined();
    const holds = [];
    for (let i = hold.from; i <= hold.to; i++) {
      holds.push((farmerRig.frames as Record<string, { duration: number }>)[String(i)].duration);
    }
    expect(holds).toEqual([...HOLD_FRAME_MS]);
  });

  it("hold the fish clear of his hat, not through his face", () => {
    const hatTop = topAboveFeet(hold.to);
    for (const species of FISH_SPECIES) {
      // The fish is drawn centred on FISH_OVERHEAD; find its lowest drawn row.
      const cellX = fishFrame(species) * FISH_CELL;
      let bottom = -1;
      for (let y = 0; y < FISH_CELL; y++) {
        for (let x = 0; x < FISH_CELL; x++) if (alpha(fish, cellX + x, y) > 0) bottom = y;
      }
      const belly = -FISH_OVERHEAD.y - (bottom - FISH_CELL / 2);
      expect(belly, species).toBeGreaterThanOrEqual(hatTop);
      expect(belly - hatTop, species).toBeLessThanOrEqual(2);
    }
  });

  it("start with his hands together at his chest, where the fish lands", () => {
    const at = framePos(hold.from);
    const row = FEET.y + FISH_AT_CHEST.y;
    // Something is drawn there, dead centre.
    expect(alpha(farmer, at.x + FEET.x, at.y + row)).toBeGreaterThan(0);
  });
});

describe("common/fish.png", () => {
  it("has one cell per species, in the order fishFrame reads them", () => {
    expect(fish.height).toBe(FISH_CELL);
    expect(fish.width).toBe(FISH_CELL * FISH_SPECIES.length);
    expect(FISH_SPECIES.map(fishFrame)).toEqual([0, 1, 2]);
  });
});

describe("fishFlight", () => {
  const stand = { x: 200, y: 100 };
  const from = bobberSpot(stand, "left");
  const to = { x: stand.x + FISH_AT_CHEST.x, y: stand.y + FISH_AT_CHEST.y };
  const flight = fishFlight(from, to);

  it("starts at the float and ends in his hands", () => {
    expect(flight.at(0)).toEqual(from);
    expect(flight.at(flight.ms).x).toBeCloseTo(to.x, 6);
    expect(flight.at(flight.ms).y).toBeCloseTo(to.y, 6);
    expect(flight.at(flight.ms + 500)).toEqual(flight.at(flight.ms));
  });

  it("takes about as long as a Stardew catch, long enough for him to turn first", () => {
    expect(flight.ms).toBeGreaterThan(600);
    expect(flight.ms).toBeLessThan(1200);
    expect(flight.ms).toBeGreaterThan(FISH_TURN_MS);
  });

  it("peaks above his hands and heads toward him", () => {
    let top = Infinity;
    for (let t = 0; t <= flight.ms; t += 5) top = Math.min(top, flight.at(t).y);
    expect(top).toBeLessThan(to.y - 20);
    expect(flight.heading).toBe(1);
    expect(fishFlight(bobberSpot(stand, "right"), to).heading).toBe(-1);
  });
});

describe("heldOffset", () => {
  it("sits at his chest, rises with his arms, then stays up", () => {
    expect(heldOffset(0)).toEqual(FISH_AT_CHEST);
    expect(heldOffset(LIFT_START_MS)).toEqual(FISH_AT_CHEST);
    const mid = heldOffset((LIFT_START_MS + LIFT_END_MS) / 2);
    expect(mid.y).toBeLessThan(FISH_AT_CHEST.y);
    expect(mid.y).toBeGreaterThan(FISH_OVERHEAD.y);
    expect(heldOffset(LIFT_END_MS)).toEqual(FISH_OVERHEAD);
    expect(heldOffset(LIFT_END_MS + 1000)).toEqual(FISH_OVERHEAD);
  });
});
