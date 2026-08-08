import { describe, expect, it } from "vitest";
import {
  ACT_LEAN,
  ART_FRACTIONS,
  SPRITE_FOLD_RECEDE,
  SPRITE_SEAT_OFFSET_Z,
  spriteSeatOffsetZ,
  BREATH_AMPLITUDE,
  CAMERA_HEADROOM_Y,
  CROWN_RISE,
  HEAD_HEIGHT,
  RAIL_TOP_Y,
  SHOULDER_SPAN,
  SPRITE_ASPECT,
  SPRITE_BASE_Y,
  SPRITE_HEIGHT,
  SPRITE_SET,
  SPRITE_WIDTH,
  spriteCrownWorld,
  setSpriteSourceResolver,
  RAIL_FADE,
  railFadeAlpha,
  railFadeRipple,
  seatNeedsRailFade,
  SWAY_AMPLITUDE,
  WIN_PULSE,
  angleDelta,
  spriteForSeatAngle,
  spriteForSlot,
  spriteSrc,
  worstAngleError,
  type SpriteAngleId,
} from "./avatar-sprites";
import { SEAT_COUNT_3D, seatAngle, seatPosition } from "./seat-layout";
import { cameraBasis, frameCamera, projectToNdc } from "./camera-framing";

const DEG = Math.PI / 180;

describe("the sprite set", () => {
  it("carries one render for each of the six turnaround angles", () => {
    expect(SPRITE_SET).toHaveLength(6);
    expect(new Set(SPRITE_SET.map((s) => s.id)).size).toBe(6);
    expect(new Set(SPRITE_SET.map((s) => s.angle)).size).toBe(6);
  });

  it("points every id at a file under /avatars3d", () => {
    for (const { id } of SPRITE_SET) {
      expect(spriteSrc(id)).toBe(`/avatars3d/${id}.webp`);
    }
  });

  it("lets the artifact swap in inlined data URIs, and restore", () => {
    // The published demo has no server and a CSP that forbids fetches, so
    // its bundle inlines the renders and points the seats at those.
    setSpriteSourceResolver((id) => `data:image/webp;base64,${id}`);
    expect(spriteSrc("front")).toBe("data:image/webp;base64,front");
    setSpriteSourceResolver(null);
    expect(spriteSrc("front")).toBe("/avatars3d/front.webp");
  });

  it("places back at the near seat and front at the far seat", () => {
    // Slot 0 sits at +Z with its back to the camera; slot 3 at -Z faces it.
    expect(SPRITE_SET.find((s) => s.id === "back")!.angle).toBe(0);
    expect(SPRITE_SET.find((s) => s.id === "front")!.angle).toBeCloseTo(Math.PI, 10);
  });
});

describe("angleDelta", () => {
  it("returns the shortest signed distance and wraps", () => {
    expect(angleDelta(0, 0)).toBe(0);
    expect(angleDelta(10 * DEG, 350 * DEG)).toBeCloseTo(20 * DEG, 10);
    expect(angleDelta(350 * DEG, 10 * DEG)).toBeCloseTo(-20 * DEG, 10);
    expect(Math.abs(angleDelta(0, Math.PI))).toBeCloseTo(Math.PI, 10);
  });

  it("never exceeds half a turn", () => {
    for (let a = -720; a <= 720; a += 7) {
      for (let b = -180; b <= 180; b += 23) {
        expect(Math.abs(angleDelta(a * DEG, b * DEG))).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });
});

describe("spriteForSeatAngle", () => {
  it("returns each render exactly at its own angle", () => {
    for (const { id, angle } of SPRITE_SET) {
      expect(spriteForSeatAngle(angle)).toBe(id);
    }
  });

  it("is invariant to full turns", () => {
    for (const { id, angle } of SPRITE_SET) {
      expect(spriteForSeatAngle(angle + Math.PI * 2)).toBe(id);
      expect(spriteForSeatAngle(angle - Math.PI * 2)).toBe(id);
      expect(spriteForSeatAngle(angle + Math.PI * 8)).toBe(id);
    }
  });

  it("rounds to the nearer render, including across the 0/360 seam", () => {
    expect(spriteForSeatAngle(5 * DEG)).toBe("back");
    expect(spriteForSeatAngle(-5 * DEG)).toBe("back");
    expect(spriteForSeatAngle(355 * DEG)).toBe("back");
    expect(spriteForSeatAngle(40 * DEG)).toBe("backright45");
    expect(spriteForSeatAngle(320 * DEG)).toBe("backleft45");
    expect(spriteForSeatAngle(170 * DEG)).toBe("front");
  });

  it("never returns an id outside the set", () => {
    const ids = new Set<SpriteAngleId>(SPRITE_SET.map((s) => s.id));
    for (let deg = -360; deg <= 720; deg += 1) {
      expect(ids.has(spriteForSeatAngle(deg * DEG))).toBe(true);
    }
  });
});

describe("the six-max seat mapping", () => {
  it("gives every seat a different render", () => {
    const picked = Array.from({ length: SEAT_COUNT_3D }, (_, slot) => spriteForSlot(slot));
    expect(new Set(picked).size).toBe(SEAT_COUNT_3D);
  });

  it("shows the local player their own back and the far seat its face", () => {
    expect(spriteForSlot(0)).toBe("back");
    expect(spriteForSlot(3)).toBe("front");
  });

  it("puts the face-points-left renders on the +X (screen-right) side", () => {
    // A seat on +X turns toward the middle, i.e. toward screen-left, so the
    // render whose face points that way belongs there. This is the mapping
    // that is easiest to get mirrored, so it is pinned against the geometry
    // rather than against the file names.
    for (const slot of [1, 2]) {
      expect(seatPosition(slot).x).toBeGreaterThan(0);
    }
    for (const slot of [4, 5]) {
      expect(seatPosition(slot).x).toBeLessThan(0);
    }
    expect(spriteForSlot(1)).toBe("backright45");
    expect(spriteForSlot(2)).toBe("frontright45");
    expect(spriteForSlot(4)).toBe("frontleft45");
    expect(spriteForSlot(5)).toBe("backleft45");
  });

  it("mirrors left and right across the table's centre line", () => {
    const mirrored: Array<[number, number]> = [
      [1, 5],
      [2, 4],
    ];
    for (const [right, left] of mirrored) {
      expect(seatPosition(right).x).toBeCloseTo(-seatPosition(left).x, 10);
      expect(spriteForSlot(right).replace("right", "")).toBe(
        spriteForSlot(left).replace("left", "")
      );
    }
  });

  it("keeps every seat within 15° of a real render", () => {
    // The art is at 45° steps and a six-max ring at 60°, so four seats are
    // served slightly off-axis. Invisible at table distance — but pinned so
    // a future ring cannot quietly drift further.
    expect(worstAngleError(SEAT_COUNT_3D)).toBeLessThanOrEqual(15 * DEG + 1e-9);
  });

  it("degrades sanely to an eight-max ring", () => {
    // Eight seats at 45° land exactly on the art for six of them; the other
    // two are the worst case and must still be under a half-step.
    expect(worstAngleError(8)).toBeLessThanOrEqual(45 * DEG);
    for (let slot = 0; slot < 8; slot += 1) {
      expect(spriteForSeatAngle((slot / 8) * Math.PI * 2)).toBeTruthy();
    }
  });

  it("agrees with seatAngle for every slot", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      expect(spriteForSlot(slot)).toBe(spriteForSeatAngle(seatAngle(slot)));
    }
  });
});

describe("sprite metrics", () => {
  it("keeps every seat's crown under the camera's headroom guarantee", () => {
    // The quad rises along the camera's up axis, so the crown's world
    // height depends on the framing — check it at each viewport rather
    // than against a single constant.
    for (const aspect of [1440 / 900, 844 / 390, 390 / 844]) {
      const framing = frameCamera(aspect);
      for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
        expect(spriteCrownWorld(slot, framing, false).y).toBeLessThan(CAMERA_HEADROOM_Y);
      }
    }
  });

  it("puts the crown a real bust's height above the foot", () => {
    expect(CROWN_RISE).toBeGreaterThan(SPRITE_HEIGHT * 0.9);
    expect(CROWN_RISE).toBeLessThanOrEqual(SPRITE_HEIGHT);
  });

  it("tucks the crop's bottom edge behind the rail", () => {
    // The art ends at mid-chest; if that edge floated above the rail the
    // figure would read as a cut-out card standing on the cloth.
    expect(SPRITE_BASE_Y).toBeLessThan(RAIL_TOP_Y);
  });

  it("derives world sizes that match the art's own proportions", () => {
    expect(SPRITE_HEIGHT).toBeCloseTo(SPRITE_WIDTH / SPRITE_ASPECT, 10);
    expect(SHOULDER_SPAN).toBeCloseTo(SPRITE_WIDTH * ART_FRACTIONS.shoulderSpan, 10);
    expect(HEAD_HEIGHT).toBeCloseTo(SPRITE_HEIGHT * ART_FRACTIONS.headHeight, 10);
  });

  it("gives each figure real presence against the felt", () => {
    // Set on a render: at half of this the players read as dolls behind
    // their own chairs, at twice it they crowd the cloth. Stated against
    // the felt's 4.3-unit width so the bound means something.
    const feltWidth = 4.3;
    expect(SHOULDER_SPAN / feltWidth).toBeGreaterThan(0.25);
    expect(SHOULDER_SPAN / feltWidth).toBeLessThan(0.45);
  });

  it("keeps the head stylised but not swollen", () => {
    expect(HEAD_HEIGHT).toBeGreaterThan(0.35);
    expect(HEAD_HEIGHT).toBeLessThan(0.75);
    // The art's head-to-shoulder ratio is the stylisation itself.
    expect(ART_FRACTIONS.headWidth / ART_FRACTIONS.shoulderSpan).toBeGreaterThan(0.4);
    expect(ART_FRACTIONS.headWidth / ART_FRACTIONS.shoulderSpan).toBeLessThan(0.6);
  });

});

describe("every seat's head stays on screen", () => {
  // env() is 0 headless and a canvas cannot be measured in a unit test, so
  // this is the same arithmetic the camera itself is solved with — the only
  // way to check all six seats against a screen shape nobody has opened.
  // It exists because the first cut used the studio's FOLD_SLIDE (0.55) and
  // the two near-side seats' heads left the frame the moment they folded,
  // which no existing test could see.
  const headHalf = (SPRITE_WIDTH * ART_FRACTIONS.headWidth) / 2;

  /**
   * The head's centre in world space: the crown, dropped half a head back
   * down the camera's up axis — the same axis the quad is built on.
   */
  function headCentre(slot: number, folded: boolean, framing: ReturnType<typeof frameCamera>) {
    const crown = spriteCrownWorld(slot, framing, folded);
    const { up } = cameraBasis(framing);
    const drop = (SPRITE_HEIGHT * ART_FRACTIONS.headHeight) / 2;
    return {
      x: crown.x - up.x * drop,
      y: crown.y - up.y * drop,
      z: crown.z - up.z * drop,
    };
  }

  function headSpan(slot: number, folded: boolean, aspect: number) {
    const framing = frameCamera(aspect);
    const c = headCentre(slot, folded, framing);
    const { right } = cameraBasis(framing);
    // Widen along the camera's right axis, which is where the quad's width
    // actually lies now that it is screen-aligned.
    const a = projectToNdc(
      { x: c.x - right.x * headHalf, y: c.y - right.y * headHalf, z: c.z - right.z * headHalf },
      framing,
      aspect
    );
    const b = projectToNdc(
      { x: c.x + right.x * headHalf, y: c.y + right.y * headHalf, z: c.z + right.z * headHalf },
      framing,
      aspect
    );
    return Math.max(Math.abs(a.x), Math.abs(b.x));
  }

  it("keeps whole heads in frame on a landscape desktop, seated or folded", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      for (const folded of [false, true]) {
        expect(headSpan(slot, folded, 1440 / 900)).toBeLessThan(1);
      }
    }
  });

  it("keeps whole heads in frame on a landscape phone", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      for (const folded of [false, true]) {
        expect(headSpan(slot, folded, 844 / 390)).toBeLessThan(1);
      }
    }
  });

  it("folding never pushes a seat further out than seating it", () => {
    // The fold recede moves a near-side seat outward AND toward the camera,
    // so its cost at the frame edge is more than its world-space length.
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      const seated = headSpan(slot, false, 1440 / 900);
      const folded = headSpan(slot, true, 1440 / 900);
      expect(folded - seated).toBeLessThan(0.1);
    }
  });

  it("keeps crowns inside the frame vertically", () => {
    for (const aspect of [1440 / 900, 844 / 390, 390 / 844]) {
      const framing = frameCamera(aspect);
      for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
        const crown = spriteCrownWorld(slot, framing, false);
        expect(Math.abs(projectToNdc(crown, framing, aspect).y)).toBeLessThan(1);
      }
    }
  });

  it("lets an upright phone graze the side seats, but no more than that", () => {
    // camera-framing.ts states the upright profile as a deliberate trade:
    // it guarantees the table and lets the side seats run off the edges.
    // So a little overhang is expected here and only here — this pins how
    // much. Anything past a tenth means something grew or moved, not that
    // the trade got slightly worse.
    const worst = Math.max(...[1, 5].map((slot) => headSpan(slot, false, 390 / 844)));
    expect(worst).toBeLessThan(1.1);
  });
});

describe("the seat offset", () => {
  it("recesses every pose behind the seat origin except an active bet", () => {
    // Product direction: figures sink into the room's shadow — the far
    // seats behind the table's edge, the near ones into the foreground
    // pool. Only a live bet leans up to (at most) the origin.
    expect(SPRITE_SEAT_OFFSET_Z).toBeLessThan(0);
    for (const slot of [2, 3, 4]) {
      expect(spriteSeatOffsetZ(slot, false, false)).toBeLessThan(0);
      expect(spriteSeatOffsetZ(slot, true, false)).toBeLessThan(0);
      expect(spriteSeatOffsetZ(slot, false, true)).toBeLessThanOrEqual(0.06);
    }
  });

  it("tucks the near-side pair in toward the rail, less than the local seat", () => {
    // Their toward-table direction points up-frame and inward, pulling
    // them out of the frame's corners; being nearer the camera than the
    // far seats but further than slot 0, their tuck sits between.
    for (const slot of [1, 5]) {
      expect(spriteSeatOffsetZ(slot, false, false)).toBeGreaterThan(0);
      expect(spriteSeatOffsetZ(slot, false, false)).toBeLessThan(
        spriteSeatOffsetZ(0, false, false)
      );
    }
  });

  it("tucks the local seat TOWARD the table — the one seat where away is toward the camera", () => {
    // Away-from-table projects this seat DOWN the frame (a first cut
    // recessed it like the others and sank it into the action HUD).
    // Toward the table is what carries it up-screen to the near rail.
    expect(spriteSeatOffsetZ(0, false, false)).toBeGreaterThan(
      spriteSeatOffsetZ(1, false, false)
    );
    expect(spriteSeatOffsetZ(0, false, false)).toBeGreaterThan(0);
  });

  it("still moves back when folded and forward when betting", () => {
    for (const slot of [0, 1]) {
      expect(spriteSeatOffsetZ(slot, true, false)).toBeLessThan(
        spriteSeatOffsetZ(slot, false, false)
      );
      expect(spriteSeatOffsetZ(slot, false, true)).toBeGreaterThan(
        spriteSeatOffsetZ(slot, false, false)
      );
      expect(
        spriteSeatOffsetZ(slot, false, false) - spriteSeatOffsetZ(slot, true, false)
      ).toBeCloseTo(SPRITE_FOLD_RECEDE, 10);
    }
  });
});

describe("the near seats' rail fade", () => {
  // Exists because the head-pivoted, screen-aligned quads tip their lower
  // halves out in front of the padded rail at the two foreground seats,
  // and the opaque lower body painted across the rim with hard quad edges.
  it("applies exactly to the near-side seats, by geometry", () => {
    expect(seatNeedsRailFade(1)).toBe(true);
    expect(seatNeedsRailFade(5)).toBe(true);
    for (const slot of [0, 2, 3, 4]) {
      expect(seatNeedsRailFade(slot)).toBe(false);
    }
  });

  it("never touches the face or shoulders", () => {
    // The highest the boundary can reach, ripple included, stays in the
    // lower half of the sprite; everything above is fully opaque.
    const ceiling = RAIL_FADE.cornerStart + RAIL_FADE.noise;
    expect(ceiling).toBeLessThan(0.6);
    for (let u = 0; u <= 1.001; u += 0.05) {
      for (let v = ceiling; v <= 1.001; v += 0.05) {
        expect(railFadeAlpha(u, v)).toBe(1);
      }
    }
  });

  it("dissolves the bottom band to nothing", () => {
    for (let u = 0; u <= 1.001; u += 0.05) {
      expect(railFadeAlpha(u, 0)).toBe(0);
      expect(railFadeAlpha(u, RAIL_FADE.solidBelow * 0.9)).toBe(0);
    }
  });

  it("is monotonic going down any column — a fade, not a banding artifact", () => {
    for (let u = 0; u <= 1.001; u += 0.1) {
      let prev = 1;
      for (let v = 1; v >= 0; v -= 0.02) {
        const a = railFadeAlpha(u, v);
        expect(a).toBeLessThanOrEqual(prev + 1e-9);
        prev = a;
      }
    }
  });

  it("starts higher at the corners than at the centre", () => {
    // The corners lead the tip toward the camera and meet the rail first.
    // Sampled through the ripple: at the centre-start height, the corner
    // columns must already be fading while the centre column is not.
    const v = RAIL_FADE.centreStart + RAIL_FADE.noise + 0.01;
    expect(railFadeAlpha(0.5, v)).toBe(1);
    expect(railFadeAlpha(0.02, v)).toBeLessThan(1);
    expect(railFadeAlpha(0.98, v)).toBeLessThan(1);
  });

  it("ripples deterministically and within its stated amplitude", () => {
    for (let u = 0; u <= 1.001; u += 0.03) {
      expect(railFadeRipple(u)).toBe(railFadeRipple(u));
      expect(Math.abs(railFadeRipple(u))).toBeLessThanOrEqual(1);
    }
  });
});

describe("the motion contract stays subtle", () => {
  it("pins every amplitude under its ceiling", () => {
    expect(BREATH_AMPLITUDE).toBeLessThanOrEqual(0.02);
    expect(SWAY_AMPLITUDE).toBeLessThanOrEqual(0.02);
    expect(ACT_LEAN).toBeLessThanOrEqual(0.08);
    expect(WIN_PULSE).toBeLessThanOrEqual(0.04);
  });
});
