/**
 * How the characters are drawn. They are seen from straight above, so there is one picture
 * of each, facing east, and the game turns it to the facing. Pure so it can be tested.
 *
 * Angles are the sim's: radians, 0 east, positive turning clockwise on screen
 * (y runs down), so pi/2 is south.
 */

/** Shoulder width in the picture's pixels. The body radius is half of what it covers. */
export const SHOULDER_PX = 94;
/** Longest an arm piece can be, joint to joint, in the picture's pixels (scripts/stackstrike-bodies.py). */
export const ARM_PX = 62;
/** Shortest an arm piece is squeezed to when the hands are near the body. */
export const ARM_MIN_PX = 36;
/** Shoulder joints in body pixels from the body's centre. The leading arm is on the left of the aim, the trigger arm on the right. */
export const SHOULDERS = { lead: { x: 2, y: -38 }, rear: { x: 2, y: 38 } } as const;
/** Where the hands hang when nothing is held, in body pixels. */
export const REST_HANDS = { lead: { x: 50, y: -50 }, rear: { x: 50, y: 50 } } as const;
/** Fists held out in front of an unarmed guard. */
export const FISTS = { lead: { x: 58, y: -14 }, rear: { x: 58, y: 14 } } as const;

export interface Pt {
  x: number;
  y: number;
}

export interface ArmPose {
  shoulder: Pt;
  elbow: Pt;
  hand: Pt;
  /** Length of each of the two pieces, joint to joint, in body pixels. */
  length: number;
}

/**
 * Two equal arm pieces from a shoulder to a hand. Close hands bend the elbow out to the side
 * (outward is -1 for the leading arm, +1 for the trigger arm); a far hand straightens it out.
 * If the hand is out of reach it is pulled in to the arm's full stretch.
 */
export function solveArm(shoulder: Pt, hand: Pt, outward: -1 | 1): ArmPose {
  let dx = hand.x - shoulder.x;
  let dy = hand.y - shoulder.y;
  let d = Math.hypot(dx, dy) || 1e-6;
  const reach = ARM_PX * 2 * 0.999;
  if (d > reach) {
    dx *= reach / d;
    dy *= reach / d;
    d = reach;
  }
  const length = Math.min(ARM_PX, Math.max(ARM_MIN_PX, d * 0.54));
  const along = d / 2;
  const bow = Math.sqrt(Math.max(0, length * length - along * along));
  const ux = dx / d;
  const uy = dy / d;
  // The side of the line that points away from the body.
  let px = -uy;
  let py = ux;
  if (py * outward < 0) {
    px = -px;
    py = -py;
  }
  return {
    shoulder,
    elbow: { x: shoulder.x + ux * along + px * bow, y: shoulder.y + uy * along + py * bow },
    hand: { x: shoulder.x + dx, y: shoulder.y + dy },
    length,
  };
}

/** A piece drawn from `from` to `to`: where its joint sits, which way it points, and how much to stretch it along its length. */
export function segmentBetween(from: Pt, to: Pt, naturalLength: number = ARM_PX): { x: number; y: number; rotation: number; stretch: number } {
  return { x: from.x, y: from.y, rotation: Math.atan2(to.y - from.y, to.x - from.x), stretch: Math.hypot(to.x - from.x, to.y - from.y) / naturalLength };
}

/** A body pixel position turned to the facing and scaled, added to the body's centre. */
export function bodyToWorld(centre: Pt, angle: number, scale: number, local: Pt): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: centre.x + (local.x * cos - local.y * sin) * scale, y: centre.y + (local.x * sin + local.y * cos) * scale };
}

/** Both hands for a held gun, in body pixels: trigger hand at `hold`, leading hand out along the gun. */
export function handsOnGun(art: GunArt): { lead: Pt; rear: Pt } {
  return {
    rear: { x: art.hold, y: 0 },
    lead: { x: art.hold + (art.lead.x - art.grip.x), y: art.lead.y - art.grip.y },
  };
}

/** Characters are drawn a little bigger than their hit circle so they read on a phone. */
export const VISUAL_SCALE = 1.3;

/** World units per picture pixel for a body of this radius. Guns use the same scale so they match. */
export function pixelScale(radius: number): number {
  return (radius * 2 * VISUAL_SCALE) / SHOULDER_PX;
}

/** Where the trigger hand is, as an offset from the body's centre, out along the aim. */
export function handOffset(aim: number, radius: number, hold: number): { x: number; y: number } {
  const reach = hold * pixelScale(radius);
  return { x: Math.cos(aim) * reach, y: Math.sin(aim) * reach };
}

/** A small side to side turn of the shoulders while walking, in radians. */
export function walkSway(seconds: number, moving: boolean): number {
  return moving ? Math.sin(seconds * 11) * 0.09 : 0;
}

export interface GunArt {
  w: number;
  h: number;
  /** The glove by the trigger, in the gun picture's pixels. */
  grip: Pt;
  /** The glove out front, in the gun picture's pixels. */
  lead: Pt;
  /** How far in front of the body's centre the trigger hand sits, in body pixels. */
  hold: number;
}

/** Kept in step with public/stackstrike/art/guns.json by a test. */
export const GUN_ART: Record<string, GunArt> = {
  pistol: { w: 112, h: 48, grip: { x: 24, y: 24 }, lead: { x: 44, y: 26 }, hold: 46 },
  smg: { w: 160, h: 52, grip: { x: 34, y: 27 }, lead: { x: 82, y: 26 }, hold: 40 },
  shotgun: { w: 208, h: 48, grip: { x: 44, y: 24 }, lead: { x: 122, y: 24 }, hold: 34 },
};
