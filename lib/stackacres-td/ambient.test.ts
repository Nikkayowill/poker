import { describe, expect, it } from "vitest";
import { activeCritters, fireflyAlpha, fishFrame, leafFall, nearbyTile, tileId } from "./ambient";

describe("activeCritters", () => {
  it("puts butterflies, the dragonfly and birds out by day, and no fireflies", () => {
    const noon = activeCritters(12);
    expect(noon.has("butterflies")).toBe(true);
    expect(noon.has("dragonfly")).toBe(true);
    expect(noon.has("birds")).toBe(true);
    expect(noon.has("fireflies")).toBe(false);
  });

  it("brings the fireflies out at night and sends the day critters home", () => {
    const night = activeCritters(23);
    expect([...night]).toEqual(["fireflies"]);
  });

  it("keeps leaves falling and fish jumping into the evening", () => {
    const evening = activeCritters(20);
    expect(evening.has("leaves")).toBe(true);
    expect(evening.has("fish")).toBe(true);
    expect(evening.has("butterflies")).toBe(false);
  });
});

describe("nearbyTile", () => {
  const allowed = new Set([tileId([2, 2]), tileId([3, 2]), tileId([9, 9])]);

  it("only ever picks an allowed tile within reach", () => {
    for (let i = 0; i < 50; i++) {
      const tile = nearbyTile(allowed, [2, 2], 2, Math.random);
      expect(tile).toEqual([3, 2]);
    }
  });

  it("gives up when nothing allowed is near", () => {
    expect(nearbyTile(allowed, [20, 20], 2, Math.random)).toBeNull();
  });
});

describe("fireflyAlpha", () => {
  it("glows, fades in steps, goes dark, and glows again", () => {
    expect(fireflyAlpha(0, 1000, 2000)).toBe(1);
    expect(fireflyAlpha(1050, 1000, 2000)).toBe(0.6);
    expect(fireflyAlpha(1200, 1000, 2000)).toBe(0.3);
    expect(fireflyAlpha(2500, 1000, 2000)).toBe(0);
    expect(fireflyAlpha(3000, 1000, 2000)).toBe(1);
  });
});

describe("leafFall", () => {
  it("falls in whole pixels, lands, rests, then fades out", () => {
    const mid = leafFall(1000, 21);
    expect(Number.isInteger(mid.dx) && Number.isInteger(mid.dy)).toBe(true);
    expect(mid.landed).toBe(false);
    expect(leafFall(3000, 21)).toMatchObject({ landed: true, dy: 21, alpha: 1 });
    expect(leafFall(3000 + 2400, 21).alpha).toBe(0);
  });
});

describe("fishFrame", () => {
  it("plays each frame once", () => {
    expect(fishFrame(0, 5)).toBe(0);
    expect(fishFrame(600, 5)).toBe(4);
    expect(fishFrame(700, 5)).toBeNull();
  });
});
