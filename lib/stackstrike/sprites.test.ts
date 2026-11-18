import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WEAPONS } from "./content";
import { ARM_MIN_PX, ARM_PX, bodyToWorld, GUN_ART, handOffset, handsOnGun, pixelScale, SHOULDER_PX, SHOULDERS, segmentBetween, solveArm, VISUAL_SCALE, walkSway } from "./sprites";

describe("sprite sizing", () => {
  it("draws the shoulders a bit wider than the hit circle", () => {
    expect(pixelScale(14) * SHOULDER_PX).toBeCloseTo(28 * VISUAL_SCALE);
    expect(pixelScale(14)).toBeGreaterThan(pixelScale(12));
  });

  it("puts the hands out along the aim, a little past the body's edge", () => {
    const east = handOffset(0, 14, 46);
    expect(east.x).toBeGreaterThan(14);
    expect(east.y).toBeCloseTo(0);
    const west = handOffset(Math.PI, 14, 46);
    expect(west.x).toBeLessThan(-10);
    const south = handOffset(Math.PI / 2, 14, 46);
    expect(south.y).toBeCloseTo(east.x);
  });
});

describe("arms", () => {
  it("reaches the hand exactly when it is within reach", () => {
    const pose = solveArm(SHOULDERS.lead, { x: 90, y: 0 }, -1);
    expect(pose.hand).toEqual({ x: 90, y: 0 });
    expect(Math.hypot(pose.elbow.x - pose.shoulder.x, pose.elbow.y - pose.shoulder.y)).toBeCloseTo(pose.length);
    expect(Math.hypot(pose.hand.x - pose.elbow.x, pose.hand.y - pose.elbow.y)).toBeCloseTo(pose.length);
  });

  it("bows the elbow away from the body, on each side", () => {
    expect(solveArm(SHOULDERS.lead, { x: 60, y: 0 }, -1).elbow.y).toBeLessThan(SHOULDERS.lead.y * 0.5);
    expect(solveArm(SHOULDERS.rear, { x: 60, y: 0 }, 1).elbow.y).toBeGreaterThan(SHOULDERS.rear.y * 0.5);
  });

  it("pulls a hand that is too far back to full stretch instead of tearing the arm", () => {
    const pose = solveArm(SHOULDERS.lead, { x: 400, y: 0 }, -1);
    expect(Math.hypot(pose.hand.x - pose.shoulder.x, pose.hand.y - pose.shoulder.y)).toBeLessThanOrEqual(ARM_PX * 2);
    expect(pose.length).toBe(ARM_PX);
  });

  it("squeezes the pieces rather than bowing far out when the hands are close", () => {
    const pose = solveArm(SHOULDERS.lead, { x: 20, y: -10 }, -1);
    expect(pose.length).toBeGreaterThanOrEqual(ARM_MIN_PX);
    expect(pose.length).toBeLessThanOrEqual(ARM_PX);
  });

  it("reaches both hands of every gun with room to spare", () => {
    for (const [id, art] of Object.entries(GUN_ART)) {
      const hands = handsOnGun(art);
      for (const [side, outward] of [["lead", -1], ["rear", 1]] as const) {
        const pose = solveArm(SHOULDERS[side], hands[side], outward);
        const gap = Math.hypot(pose.hand.x - hands[side].x, pose.hand.y - hands[side].y);
        expect(gap, `${id} ${side}`).toBeLessThan(0.01);
        expect(Math.abs(pose.elbow.y), `${id} ${side}`).toBeLessThan(70);
      }
    }
  });

  it("places a piece from a joint to the next, stretched to fit", () => {
    const seg = segmentBetween({ x: 0, y: 0 }, { x: 31, y: 0 });
    expect(seg.rotation).toBeCloseTo(0);
    expect(seg.stretch).toBeCloseTo(0.5);
    expect(segmentBetween({ x: 5, y: 5 }, { x: 5, y: 105 }).rotation).toBeCloseTo(Math.PI / 2);
  });

  it("turns a body position to the facing", () => {
    const p = bodyToWorld({ x: 100, y: 100 }, Math.PI / 2, 2, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(120);
  });
});

describe("walkSway", () => {
  it("is still when standing", () => {
    expect(walkSway(1.234, false)).toBe(0);
  });

  it("turns the shoulders a little when walking", () => {
    let widest = 0;
    for (let t = 0; t < 2; t += 0.02) widest = Math.max(widest, Math.abs(walkSway(t, true)));
    expect(widest).toBeGreaterThan(0.05);
    expect(widest).toBeLessThanOrEqual(0.09 + 1e-9);
  });
});

describe("the art on disk", () => {
  it("has a top-down picture of both characters", () => {
    for (const who of ["operative", "guard"]) expect(existsSync(`public/stackstrike/art/${who}.png`), who).toBe(true);
  });

  it("has a gun picture for every weapon, with the grip the code expects", () => {
    const manifest = JSON.parse(readFileSync("public/stackstrike/art/guns.json", "utf8")) as typeof GUN_ART;
    for (const piece of ["operative-upper", "operative-fore", "guard-upper", "guard-fore"]) {
      expect(existsSync(`public/stackstrike/art/arm-${piece}.png`), piece).toBe(true);
    }
    for (const id of Object.keys(WEAPONS)) {
      expect(existsSync(`public/stackstrike/art/gun-${id}.png`), id).toBe(true);
      expect(GUN_ART[id], id).toEqual(manifest[id]);
    }
    expect(GUN_ART.pistol).toBeDefined();
  });
});
