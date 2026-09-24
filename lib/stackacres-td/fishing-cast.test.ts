import { describe, expect, it } from "vitest";
import farmerRig from "@/public/stackacres-td/characters/farmer.json";
import {
  NIBBLE_MAX_MS,
  NIBBLE_MIN_MS,
  CAST_SHOWN_ABOVE_FEET,
  bobberSpot,
  castHeadroom,
  castAnimKey,
  castAnims,
  castSideFor,
  isCancellable,
  rodOutFrame,
  rollNibbleMs,
  type CastPhase,
} from "./fishing-cast";

/** The rig's own tag table, so a re-export of the sheet moves these tests. */
const TAGS = new Map(farmerRig.meta.frameTags.map((tag) => [tag.name, tag] as const));

describe("castAnims", () => {
  it("only ever names frames the rig actually has", () => {
    // The sheet keys its frames by index as a string, which is also how
    // Phaser names them once the aseprite loader has it.
    const last = Object.keys(farmerRig.frames).length - 1;
    for (const anim of castAnims()) {
      for (const frame of anim.frames) {
        expect(frame).toBeGreaterThanOrEqual(0);
        expect(frame).toBeLessThanOrEqual(last);
      }
    }
  });

  it("cuts the cast and the reel from the rig's own fishing tag", () => {
    const tag = TAGS.get("fish_left")!;
    const cast = castAnims().find((a) => a.key === castAnimKey("cast", "left"))!;
    const reel = castAnims().find((a) => a.key === castAnimKey("reel", "left"))!;
    expect(cast.frames).toEqual([tag.from, tag.from + 1, tag.from + 2, tag.to]);
    expect(reel.frames).toEqual([...cast.frames].reverse());
  });

  it("fights on the last two frames, looping and ping-ponged", () => {
    const tag = TAGS.get("fish_right")!;
    const tension = castAnims().find((a) => a.key === castAnimKey("tension", "right"))!;
    expect(tension.frames).toEqual([tag.to - 1, tag.to]);
    expect(tension.repeat).toBe(-1);
    expect(tension.yoyo).toBe(true);
  });

  it("registers both sides of every beat under a unique key", () => {
    const keys = castAnims().map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(6);
  });
});

describe("rodOutFrame", () => {
  it("holds the last frame of the swing, where the rod is already out", () => {
    expect(rodOutFrame("left")).toBe(String(TAGS.get("fish_left")!.to));
    expect(rodOutFrame("right")).toBe(String(TAGS.get("fish_right")!.to));
  });
});

describe("rollNibbleMs", () => {
  it("stays inside the wait the suspense is tuned for", () => {
    expect(rollNibbleMs(() => 0)).toBe(NIBBLE_MIN_MS);
    expect(rollNibbleMs(() => 0.5)).toBe((NIBBLE_MIN_MS + NIBBLE_MAX_MS) / 2);
    // Math.random never returns 1, so the top of the range is the open end.
    expect(rollNibbleMs(() => 0.999)).toBeLessThan(NIBBLE_MAX_MS);
  });
});

describe("castSideFor", () => {
  it("turns toward the water, not toward the walk that got him there", () => {
    expect(castSideFor(232, 196)).toBe("left");
    expect(castSideFor(160, 240)).toBe("right");
  });

  it("faces left when he is standing on the water's own column", () => {
    expect(castSideFor(200, 200)).toBe("left");
  });
});

describe("bobberSpot", () => {
  it("throws the line out over the water on the side he is facing", () => {
    const stand = { x: 232, y: 424 };
    expect(bobberSpot(stand, "left").x).toBeLessThan(stand.x);
    expect(bobberSpot(stand, "right").x).toBeGreaterThan(stand.x);
    expect(bobberSpot(stand, "left").y).toBe(bobberSpot(stand, "right").y);
  });
});

describe("isCancellable", () => {
  it("lets a player back out before the fish is on, and not after", () => {
    const cancellable: CastPhase[] = ["cast", "nibble"];
    const locked: CastPhase[] = ["tension", "landing", "show", "reel", "snap"];
    for (const phase of cancellable) expect(isCancellable(phase)).toBe(true);
    for (const phase of locked) expect(isCancellable(phase)).toBe(false);
  });
});

describe("castHeadroom", () => {
  it("lifts the camera just far enough to clear the HUD at the end of the dock", () => {
    const hud = 57;
    const room = castHeadroom(44, hud);
    // The view's top edge can now sit this far above the map, which leaves
    // the caption over his fish exactly at the HUD's bottom edge.
    expect(44 - CAST_SHOWN_ABOVE_FEET - -room).toBe(hud);
  });

  it("leaves the camera on the map when he is nowhere near its top", () => {
    expect(castHeadroom(400, 57)).toBe(0);
  });
});
