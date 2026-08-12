import { describe, expect, it } from "vitest";
import {
  CARD_HAND_LATERAL,
  CARD_HAND_SETBACK,
  CARD_HAND_SNUG,
  COMFORTABLE_REACH,
  DRIFT_AMPLITUDE,
  RAIL_HAND_LATERAL,
  WRIST_REST_HEIGHT,
  anchorSeparation,
  handAnchor,
  handPoseWeight,
  idleDrift,
  reachableTarget,
  roleForHand,
  seatFrame,
} from "./hand-anchors";
import { CARD } from "./dimensions";
import { FELT_TOP_Y, SEAT_COUNT_3D, holeCardPosition, seatPosition } from "./seat-layout";
import { dist, dot, len, sub, vec } from "./vec3-math";

const SLOTS = Array.from({ length: SEAT_COUNT_3D }, (_, i) => i);
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("seatFrame", () => {
  it("points every seat at its own cards, not at the table centre", () => {
    for (const slot of SLOTS) {
      const { forward } = seatFrame(slot);
      const seat = seatPosition(slot);
      const card = holeCardPosition(slot);
      const toCard = sub(vec(card.x, 0, card.z), vec(seat.x, 0, seat.z));
      // Same direction as the seat-to-card line, to within floating point.
      expect(dot(forward, toCard) / len(toCard)).toBeCloseTo(1, 6);
      expect(forward.y).toBe(0);
      expect(len(forward)).toBeCloseTo(1, 9);
    }
  });

  /**
   * The felt is a 2:1 ellipse, so at a side seat the direction to the table
   * centre and the direction to that seat's own card spot genuinely differ.
   * If this ever stops being true the module can be simplified; while it is
   * true, aiming hands down the radial line would aim them past the cards.
   */
  it("differs from the seat-to-centre line at a side seat", () => {
    const { forward } = seatFrame(1);
    const seat = seatPosition(1);
    const toCentre = sub(vec(0, 0, 0), vec(seat.x, 0, seat.z));
    const cosine = dot(forward, toCentre) / len(toCentre);
    expect(cosine).toBeLessThan(0.999);
  });

  it("gives a right vector perpendicular to forward and flat", () => {
    for (const slot of SLOTS) {
      const { forward, right } = seatFrame(slot);
      expect(dot(forward, right)).toBeCloseTo(0, 9);
      expect(right.y).toBeCloseTo(0, 12);
      expect(len(right)).toBeCloseTo(1, 9);
    }
  });
});

describe("handAnchor", () => {
  it("rests every wrist at one wrist-thickness above the cloth", () => {
    for (const slot of SLOTS) {
      for (const role of ["cards", "rail"] as const) {
        const anchor = handAnchor(slot, role, 1);
        expect(anchor.wrist.y).toBeCloseTo(FELT_TOP_Y + WRIST_REST_HEIGHT, 9);
      }
    }
  });

  /**
   * The load-bearing property of the whole module: the wrist stops SHORT of
   * the cards, on the player's own side, so that the fingers are what
   * arrives. A wrist placed on the card spot buries the hand in the cards
   * and throws away the reach the setback buys.
   */
  it("puts the card hand between the player and the cards", () => {
    for (const slot of SLOTS) {
      const anchor = handAnchor(slot, "cards", 1);
      const seat = seatPosition(slot);
      const card = holeCardPosition(slot);
      expect(flat(anchor.wrist, seat)).toBeLessThan(flat(card, seat));
      expect(flat(anchor.wrist, card)).toBeGreaterThan(CARD.height / 2);
    }
  });

  it("aims the card hand's fingers at the card spot itself", () => {
    for (const slot of SLOTS) {
      const anchor = handAnchor(slot, "cards", -1);
      const card = holeCardPosition(slot);
      expect(anchor.aim.x).toBeCloseTo(card.x, 9);
      expect(anchor.aim.z).toBeCloseTo(card.z, 9);
    }
  });

  it("aims the off hand into the table rather than off the side of it", () => {
    for (const slot of SLOTS) {
      const anchor = handAnchor(slot, "rail", 1);
      const { forward } = seatFrame(slot);
      const aimDir = sub(anchor.aim, anchor.wrist);
      expect(dot(vec(aimDir.x, 0, aimDir.z), forward)).toBeGreaterThan(0);
    }
  });

  it("mirrors the lateral offset with the sign", () => {
    for (const slot of SLOTS) {
      const right = handAnchor(slot, "cards", 1);
      const left = handAnchor(slot, "cards", -1);
      expect(dist(right.wrist, left.wrist)).toBeCloseTo(2 * CARD_HAND_LATERAL, 9);
    }
  });

  /**
   * The two hands must not be solved to the same place — the failure the
   * offline bake records under WRIST_CENTRELINE_PULL, where both arms
   * converged on one point and came out crossed.
   */
  it("keeps a player's two hands well apart", () => {
    for (const slot of SLOTS) {
      const cardHand = handAnchor(slot, "cards", 1);
      const offHand = handAnchor(slot, "rail", -1);
      expect(anchorSeparation(cardHand, offHand)).toBeGreaterThan(RAIL_HAND_LATERAL);
    }
  });

  it("settles the card hand forward by exactly the snug distance at their turn", () => {
    for (const slot of SLOTS) {
      const resting = handAnchor(slot, "cards", 1, 0);
      const acting = handAnchor(slot, "cards", 1, 1);
      const card = holeCardPosition(slot);
      expect(dist(resting.wrist, acting.wrist)).toBeCloseTo(CARD_HAND_SNUG, 9);
      expect(flat(acting.wrist, card)).toBeLessThan(flat(resting.wrist, card));
    }
  });

  it("clamps snug rather than extrapolating past the cards", () => {
    const beyond = handAnchor(2, "cards", 1, 5);
    const full = handAnchor(2, "cards", 1, 1);
    expect(dist(beyond.wrist, full.wrist)).toBeCloseTo(0, 9);
  });

  it("does not move the off hand when the player is to act", () => {
    const resting = handAnchor(4, "rail", -1, 0);
    const acting = handAnchor(4, "rail", -1, 1);
    expect(dist(resting.wrist, acting.wrist)).toBeCloseTo(0, 9);
  });

  it("keeps the fingertips clear of the near card edge", () => {
    expect(CARD_HAND_SETBACK).toBeGreaterThan(CARD.height / 2);
  });
});

describe("reachableTarget", () => {
  const shoulder = vec(0, 1, 1.4);

  it("leaves a reachable target alone and reports no deficit", () => {
    const target = vec(0, 0.9, 1.1);
    const result = reachableTarget(shoulder, 1, target);
    expect(result.target).toEqual(target);
    expect(result.deficit).toBe(0);
  });

  /**
   * A resting arm must keep a bend. Solving to full extension both reads as
   * reaching rather than resting and leaves the two-bone solve with no
   * defined bend plane, which flips the elbow between frames.
   */
  it("reserves a bend even for a target exactly at full extension", () => {
    const armLength = 0.6;
    const target = vec(0, 1, 1.4 - armLength);
    const result = reachableTarget(shoulder, armLength, target);
    expect(result.deficit).toBeGreaterThan(0);
    expect(dist(shoulder, result.target)).toBeCloseTo(armLength * COMFORTABLE_REACH, 9);
  });

  /**
   * The behaviour that stopped hands hovering in mid-air: an out-of-reach
   * target is shortened along the FLOOR, not along the line of sight, so a
   * hand that cannot make the cards still lands on the table pointing at
   * them.
   */
  it("keeps a short reach at table height instead of lifting it", () => {
    const armLength = 0.5;
    const target = vec(0, 0.894, 0.4);
    const result = reachableTarget(shoulder, armLength, target);
    expect(result.deficit).toBeGreaterThan(0);
    expect(result.target.y).toBeCloseTo(target.y, 9);
    expect(dist(shoulder, result.target)).toBeCloseTo(armLength * COMFORTABLE_REACH, 9);
  });

  it("shortens along the same horizontal bearing", () => {
    const armLength = 0.5;
    const target = vec(0.7, 0.894, 0.4);
    const result = reachableTarget(shoulder, armLength, target);
    const wanted = sub(vec(target.x, 0, target.z), vec(shoulder.x, 0, shoulder.z));
    const got = sub(vec(result.target.x, 0, result.target.z), vec(shoulder.x, 0, shoulder.z));
    expect(dot(wanted, got) / (len(wanted) * len(got))).toBeCloseTo(1, 6);
  });

  /**
   * No character on the roster has an arm shorter than its own height above
   * the felt, but the fallback must not produce a NaN if one ever does.
   */
  it("falls back to a sphere clamp when no point at that height is reachable", () => {
    const result = reachableTarget(shoulder, 0.05, vec(0, 0.5, 0.4));
    expect(Number.isFinite(result.target.x)).toBe(true);
    expect(Number.isFinite(result.target.y)).toBe(true);
    expect(Number.isFinite(result.target.z)).toBe(true);
    expect(dist(shoulder, result.target)).toBeCloseTo(0.05 * COMFORTABLE_REACH, 9);
  });

  it("survives a target sitting exactly on the shoulder", () => {
    const result = reachableTarget(shoulder, 0.5, shoulder);
    expect(result.deficit).toBe(0);
    expect(result.target).toEqual(shoulder);
  });
});

describe("idleDrift", () => {
  it("stays inside the stated amplitude", () => {
    for (const slot of SLOTS) {
      for (const sign of [-1, 1]) {
        for (let t = 0; t < 60; t += 0.37) {
          const drift = idleDrift(slot, sign, t);
          expect(Math.abs(drift.x)).toBeLessThanOrEqual(DRIFT_AMPLITUDE + 1e-12);
          expect(Math.abs(drift.y)).toBeLessThanOrEqual(DRIFT_AMPLITUDE + 1e-12);
          expect(Math.abs(drift.z)).toBeLessThanOrEqual(DRIFT_AMPLITUDE + 1e-12);
        }
      }
    }
  });

  it("is deterministic — the same seat, side and time give the same offset", () => {
    expect(idleDrift(3, 1, 12.5)).toEqual(idleDrift(3, 1, 12.5));
  });

  /**
   * Twelve hands drifting in unison is worse than twelve still ones, so the
   * phase has to differ per seat AND per side.
   */
  it("puts every hand on its own phase", () => {
    const samples = new Set<string>();
    for (const slot of SLOTS) {
      for (const sign of [-1, 1]) {
        samples.add(JSON.stringify(idleDrift(slot, sign, 4)));
      }
    }
    expect(samples.size).toBe(SEAT_COUNT_3D * 2);
  });

  it("wanders around the anchor rather than away from it", () => {
    let sum = 0;
    const steps = 4000;
    for (let i = 0; i < steps; i += 1) sum += idleDrift(0, 1, i * 0.05).x;
    expect(Math.abs(sum / steps)).toBeLessThan(DRIFT_AMPLITUDE * 0.1);
  });
});

describe("handPoseWeight", () => {
  const base = { folded: false, celebrating: false, gesturing: false };

  it("drives the rest pose fully while a player is just sitting there", () => {
    expect(handPoseWeight(base)).toBe(1);
  });

  /**
   * Zero is the important answer. Fold and celebrate are the only two
   * authored clips whose content IS what the arms do; blending a table rest
   * pose over them flattens the roster's only real gestures.
   */
  it("stands down entirely for the authored one-shots", () => {
    expect(handPoseWeight({ ...base, folded: true })).toBe(0);
    expect(handPoseWeight({ ...base, celebrating: true })).toBe(0);
    expect(handPoseWeight({ ...base, folded: true, gesturing: true })).toBe(0);
  });

  it("mostly yields to a live bet or raise", () => {
    const weight = handPoseWeight({ ...base, gesturing: true });
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(0.5);
  });
});

describe("roleForHand", () => {
  it("only gives the card role to a hand whose seat has cards", () => {
    expect(roleForHand(true, true)).toBe("cards");
    expect(roleForHand(true, false)).toBe("rail");
    expect(roleForHand(false, true)).toBe("rail");
    expect(roleForHand(false, false)).toBe("rail");
  });
});
