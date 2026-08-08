/**
 * The six-angle avatar sprite set: which render a seat shows, and how big
 * it stands.
 *
 * WHY SPRITES, AND WHY SIX. The seats are pre-rendered artwork again, but
 * this is not the old standee. That renderer had exactly one frontal image
 * per character, so it faked orientation by yawing the quad partway toward
 * the seat's true facing and clamping at ~45° — a compromise that made a
 * side seat look like a flat cutout turned edge-on. With a real turnaround
 * (front, ±45 front, ±45 back, back) the compromise is unnecessary: the
 * quad squarely faces the camera and the ARTWORK carries the angle. Nothing
 * is rotated to fake anything.
 *
 * THE PICKER IS ANGLE-BASED, NOT SLOT-BASED. A seat's ring angle already
 * says how far it is turned away from the camera — slot 0 sits at +Z with
 * its back to us, slot 3 at -Z facing us — so `spriteForSeatAngle` simply
 * takes the nearest render on the circle. Keying off the angle rather than
 * the slot index means an eight-max ring (or any reseating) keeps working:
 * angles that fall between two renders round to the closer one instead of
 * indexing off the end of a table.
 *
 * The supplied art sits at 45° increments while a six-max ring puts seats
 * every 60°, so four of the six seats are served by art up to 15° off their
 * true facing. That is deliberate and invisible at table distance; a test
 * pins the worst case so a future ring can't quietly drift further.
 *
 * Pure module — no three.js import — so `npm test` reaches all of it.
 */

import { SEAT_COUNT_3D, seatAngle, seatPosition, type Vec3 } from "./seat-layout";
import { cameraBasis, type CameraFraming } from "./camera-framing";

/* ------------------------------------------------------------------ */
/* The set                                                             */
/* ------------------------------------------------------------------ */

export type SpriteAngleId =
  | "back"
  | "backright45"
  | "frontright45"
  | "front"
  | "frontleft45"
  | "backleft45";

const DEG = Math.PI / 180;

/**
 * Each render placed at the seat-ring angle whose facing it depicts.
 *
 * Read the angles off the geometry rather than the file names: a seat at
 * ring angle θ sits at (sin θ, cos θ) and faces the table centre, so θ=0
 * is the near seat showing us its back and θ=180° is the far seat showing
 * its face. The two "*right45" renders are the ones whose face points to
 * the viewer's LEFT, which is what a seat on the +X (screen-right) side of
 * the ring does when it turns to face the middle.
 */
export const SPRITE_SET: ReadonlyArray<{
  readonly id: SpriteAngleId;
  readonly angle: number;
}> = [
  { id: "back", angle: 0 },
  { id: "backright45", angle: 45 * DEG },
  { id: "frontright45", angle: 135 * DEG },
  { id: "front", angle: 180 * DEG },
  { id: "frontleft45", angle: 225 * DEG },
  { id: "backleft45", angle: 315 * DEG },
] as const;

/**
 * Where the renders are fetched from. Overridable because the published
 * artifact has no server and a CSP that allows no fetches at all: its
 * bundler inlines `.webp` *imports* as data URIs, and a path built at
 * runtime is invisible to a bundler. Without this the demo page renders a
 * table of empty chairs — the artwork simply never arrives.
 */
let sourceResolver: ((id: SpriteAngleId) => string) | null = null;

/**
 * Point the seats at inlined data URIs instead of public paths. The bundler
 * that needed this shipped with the standalone artifact demo and is gone; the
 * seam stays because it is the only way a caller with no server can supply the
 * artwork, and it costs one null check.
 */
export function setSpriteSourceResolver(
  resolve: ((id: SpriteAngleId) => string) | null
): void {
  sourceResolver = resolve;
}

/** Public path for a render, or whatever the resolver says. */
export function spriteSrc(id: SpriteAngleId): string {
  return sourceResolver ? sourceResolver(id) : `/avatars3d/${id}.webp`;
}

/** Shortest signed distance between two angles, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The render for a seat at ring angle `angle` — nearest on the circle.
 * Ties break toward the earlier entry in SPRITE_SET, which only happens at
 * exact midpoints no six- or eight-max ring produces.
 */
export function spriteForSeatAngle(angle: number): SpriteAngleId {
  let best = SPRITE_SET[0];
  let bestDist = Math.abs(angleDelta(angle, best.angle));
  for (const entry of SPRITE_SET) {
    const dist = Math.abs(angleDelta(angle, entry.angle));
    if (dist < bestDist - 1e-9) {
      best = entry;
      bestDist = dist;
    }
  }
  return best.id;
}

/** The render for a seat slot on the standard ring. */
export function spriteForSlot(slot: number): SpriteAngleId {
  return spriteForSeatAngle(seatAngle(slot));
}

/** Worst-case angular error over a ring of `count` evenly spaced seats. */
export function worstAngleError(count: number = SEAT_COUNT_3D): number {
  let worst = 0;
  for (let slot = 0; slot < count; slot += 1) {
    const angle = (slot / count) * Math.PI * 2;
    const id = spriteForSeatAngle(angle);
    const entry = SPRITE_SET.find((candidate) => candidate.id === id)!;
    worst = Math.max(worst, Math.abs(angleDelta(angle, entry.angle)));
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every render is cropped to one common bust box by scripts/build the
 * avatar sprites: 1200×800 source pixels centred on that render's own
 * measured head centre, starting 20px above its crown. Because the six
 * were generated at one scale (measured crown-to-neck heights agreed to
 * within 5%), a single box keeps the character from growing or bobbing as
 * the ring turns.
 */
export const SPRITE_PIXELS = { width: 900, height: 600 } as const;
export const SPRITE_ASPECT = SPRITE_PIXELS.width / SPRITE_PIXELS.height;

/**
 * Fractions measured off the source renders, kept here so the world-space
 * sizing below is checkable arithmetic rather than a number picked by eye.
 * `shoulderSpan` is the widest row inside the crop; `headHeight` is crown
 * to neck pinch; `crownInset` is the transparent air above the hair.
 */
export const ART_FRACTIONS = {
  shoulderSpan: 1024 / 1200,
  headHeight: 372 / 800,
  headWidth: 500 / 1200,
  crownInset: 20 / 800,
} as const;

/**
 * Width of the quad in world units. Sizing on shoulders rather than on the
 * head is deliberate: the artwork's head is stylised (head-to-shoulder
 * ratio ~0.49 against a real 0.33), so anchoring on the head would inflate
 * the whole figure.
 *
 * The number itself was set on a render, not from a ratio. A first pass
 * put the shoulders at 1.0 unit, reasoning from the mockup's shoulder-to-
 * felt-width proportion — and on screen the players came out visibly
 * smaller than the mockup and were dwarfed by their own chairs. The
 * arithmetic was misleading because the seat ring sits *behind* the felt:
 * a figure at the far seat is much further from the camera than the felt's
 * near edge, so measuring it against the felt's full on-screen width
 * understates it. Judged against the mockup at matching seats instead.
 */
export const SPRITE_WIDTH = 1.3;
export const SPRITE_HEIGHT = SPRITE_WIDTH / SPRITE_ASPECT;

/**
 * Height of the quad's BASE above the floor, before the quad is tipped to
 * face the camera. Low enough that the rail crosses the chest, so the
 * crop's own bottom edge is never the silhouette.
 */
export const SPRITE_BASE_Y = 0.64;

/**
 * How far above the base the head's centre sits, and therefore where the
 * quad pivots when it squares up to the camera.
 *
 * THE HEAD IS THE ANCHOR, not the foot. A screen-aligned quad's up axis
 * leans away from the camera, so whichever point you pivot about is the
 * only one that stays where you put it. Pivoting at the foot looked
 * natural on paper and was wrong on a render: it swung the top of the
 * plane ~0.8 units further from the camera, which pushed every head behind
 * its own chair back and left six faceless silhouettes. Pivoting at the
 * head pins the one part that must not move — correct depth, in front of
 * the chair, at the right height — and swings the foot forward instead,
 * where it is both faded to nothing and below the felt, so it disappears
 * into the table exactly as a body should.
 */
export const HEAD_RISE = SPRITE_HEIGHT * (1 - ART_FRACTIONS.crownInset - ART_FRACTIONS.headHeight / 2);

/** camera-framing.ts solves its fits against this headroom. */
export const CAMERA_HEADROOM_Y = 1.75;

/** Top of the padded rail (table-3d.tsx: FELT_TOP_Y + 0.005 + tube 0.075). */
export const RAIL_TOP_Y = 0.94;

/** Derived world sizes — what the numbers above actually produce. */
export const SHOULDER_SPAN = SPRITE_WIDTH * ART_FRACTIONS.shoulderSpan;
export const HEAD_HEIGHT = SPRITE_HEIGHT * ART_FRACTIONS.headHeight;

/**
 * How far the crown sits from the quad's base, along the quad's own up
 * axis. Not a world height any more — see spriteCrownWorld.
 */
export const CROWN_RISE = SPRITE_HEIGHT * (1 - ART_FRACTIONS.crownInset);

/**
 * Where a seat's crown actually is in world space.
 *
 * The quads are SCREEN-ALIGNED — parallel to the camera's image plane, not
 * standing vertically in the world — so a sprite's up axis is the camera's
 * up axis, and its crown is the base plus CROWN_RISE along that. A fixed
 * world Y would only be right for a vertical quad, and the nameplates have
 * to land on the head the renderer actually drew.
 *
 * Why the quads are screen-aligned at all: a world-vertical billboard does
 * not project to screen-vertical under a camera that is pitched down. It
 * keystones — measured at ±25.8° at the near-side seats on a desktop and
 * ±47.8° upright — which read exactly as the players lounging backwards in
 * their chairs. The same pitch also squashed every figure vertically by
 * ~31%, so aligning to the image plane fixes the proportions as well as
 * the lean.
 */
export function spriteCrownWorld(
  slot: number,
  framing: CameraFraming,
  folded: boolean
): Vec3 {
  const seat = folded ? spriteFoldedSeatPosition(slot) : seatPosition(slot);
  const { up } = cameraBasis(framing);
  // The pivot is the head, at a fixed world height; the crown is that plus
  // the rest of the way up the quad's own (camera-aligned) axis.
  const rise = CROWN_RISE - HEAD_RISE;
  return {
    x: seat.x + up.x * rise,
    y: seat.y + SPRITE_BASE_Y + HEAD_RISE + up.y * rise,
    z: seat.z + up.z * rise,
  };
}

/*
 * NOTE: the bottom falloff that seats each figure in its chair is NOT a
 * constant here. It is baked into the assets by
 * scripts/build-avatar-sprites.sh, because it is per-region — the torso
 * dissolves before the hoodie, and the sleeves outlast both — which no
 * single number expresses and no runtime canvas ramp can reproduce. That
 * script owns it, and its header explains the shape.
 */

/* ------------------------------------------------------------------ */
/* The near seats' rail fade                                           */
/* ------------------------------------------------------------------ */

/**
 * The two foreground seats need a second, steeper falloff that the baked
 * asset fade cannot provide, and the reason is the head pivot. Squaring a
 * quad to the pitched-down camera tips its bottom TOWARD the viewer, and
 * at the near-side seats that swings the plane's lower half out in front
 * of the padded rail. The lower body's still-opaque pixels then win the
 * depth test against the rail and paint across it, with the quad's own
 * straight edges exposed as hard cutouts through the rim.
 *
 * The fix is in the sprite's local UV space, per seat, at runtime — the
 * baked fade is shared by all six seats and most of them sit behind the
 * rail correctly, so baking this in would dissolve bodies that are not in
 * front of anything.
 *
 * The boundary is not horizontal: from the 46° camera the rail crosses
 * these sprites on a curve that rides higher toward the plane's outer
 * corners (they tip furthest forward), so the start height is a parabola
 * in |u|, plus a low-frequency ripple so the edge is organic rather than
 * geometric. Everything above the band — face, shoulders — is untouched.
 */
export const RAIL_FADE = {
  /** Where the falloff starts at the centre column, as a fraction of the
   * sprite's height above its bottom edge. */
  centreStart: 0.36,
  /** Where it starts at the outer columns — higher, because the corners
   * lead the tip toward the camera and meet the rail first. */
  cornerStart: 0.52,
  /** Fully transparent below this height. */
  solidBelow: 0.1,
  /** Amplitude of the organic ripple on the start height. */
  noise: 0.045,
} as const;

/** Deterministic ripple in [-1, 1] along the sprite's width — never
 * Math.random(); a rebuilt texture must be identical. */
export function railFadeRipple(u: number): number {
  return (
    Math.sin(u * Math.PI * 5.1) * 0.6 +
    Math.sin(u * Math.PI * 11.7 + 1.9) * 0.4
  );
}

/**
 * Alpha multiplier at a sprite-local point: u across (0..1), vFromBottom
 * up from the quad's bottom edge (0..1). Smoothstepped between the curved
 * start height and the solid floor.
 */
export function railFadeAlpha(u: number, vFromBottom: number): number {
  const centred = 2 * u - 1;
  const start =
    RAIL_FADE.centreStart +
    (RAIL_FADE.cornerStart - RAIL_FADE.centreStart) * centred * centred +
    RAIL_FADE.noise * railFadeRipple(u);
  if (vFromBottom >= start) return 1;
  const t = Math.max(
    0,
    (vFromBottom - RAIL_FADE.solidBelow) / Math.max(1e-6, start - RAIL_FADE.solidBelow)
  );
  return t * t * (3 - 2 * t);
}

/**
 * Which seats carry the rail fade: the ones in the near half of the ring,
 * off to the sides — their planes are the ones that tip out over the rim.
 * By geometry rather than by slot list, so a different ring keeps working.
 * The local seat (slot 0) is excluded: its quad also tips forward, but
 * toward the camera below the frame, never across the rail.
 */
export function seatNeedsRailFade(slot: number): boolean {
  const seat = seatPosition(slot);
  return seat.z > 0.4 && Math.abs(seat.x) > 0.5;
}

/* ------------------------------------------------------------------ */
/* The far seats' warm rim                                             */
/* ------------------------------------------------------------------ */

/**
 * The three far seats sit deepest in the room's shadow — deliberately,
 * that is the grounding direction — but it costs their faces light. This
 * is the compensation: a warm multiplier over those seats' tint, biased
 * red-over-blue like the studio's own warm kick light, applied at the
 * material rather than the lights so the shadow pools the near seats sit
 * in stay untouched. The channels can exceed 1 because the sprites render
 * un-tone-mapped; the lift is a grade, not a glow.
 */
export const FAR_SEAT_WARM_RIM = { r: 1.16, g: 1.06, b: 0.95 } as const;

/** Far half of the ring, by geometry — the seats behind the table. */
export function seatGetsWarmRim(slot: number): boolean {
  return seatPosition(slot).z < 0;
}

/* ------------------------------------------------------------------ */
/* Motion — unchanged contract: alive, not animated                    */
/* ------------------------------------------------------------------ */

/** Breathing: vertical scale amplitude and rate. */
export const BREATH_AMPLITUDE = 0.007;
export const BREATH_HZ = 0.2;

/** Slow idle sway, radians of roll. */
export const SWAY_AMPLITUDE = 0.01;
export const SWAY_HZ = 0.06;

/** Lean toward the felt while acting. A posture, not a move. */
export const ACT_LEAN = 0.05;

/**
 * How far a folded figure settles back from the rail, world units.
 *
 * Deliberately NOT the studio's FOLD_SLIDE (0.55). That value was written
 * for a small geometric figure walking back out of the spotlight; applied
 * to artwork this size it pushes the two near-side seats clean off the
 * frame, because a seat at ±60° recedes outward *and* toward the camera,
 * and both magnify how far out it projects. Measured: at 0.55 a folded
 * near seat's head reached NDC 1.08 — off screen. A fold is told by the
 * grey tint and the mucked cards; this only stops the silhouette crowding
 * the rail. `spriteFoldedSeatPosition` is the one place it is applied, so
 * the nameplates cannot drift from the figure.
 */
export const SPRITE_FOLD_RECEDE = 0.14;

/**
 * Where the quad stands along the seat's local Z (+Z is toward the felt).
 *
 * NEGATIVE: every figure sits recessed behind its seat origin (product
 * direction — "emphasise the player space"), so the table's edge and its
 * shadow band do the grounding. The far seats tuck a step behind the
 * table's silhouette; the near seats settle deeper into the dark
 * foreground pool the raised camera brings down the frame. The value used
 * to be +0.16 to clear the chairs' backrests — the chairs are gone, and
 * with them the constraint.
 */
export const SPRITE_SEAT_OFFSET_Z = -0.08;

/**
 * The local seat TUCKS TOWARD the table instead of receding.
 *
 * "Back into the shadow" means the opposite direction at this one seat.
 * Every other chair moves away from the table to sink into darkness; the
 * local seat is on the camera's side of the table, so away-from-table is
 * toward the camera — which projects it DOWN the frame, and at the shared
 * offset the raised elevation sank the player's back into the action HUD
 * (the Check button painted across it — a first cut recessed it like the
 * others and made this worse, which is how the sign error was caught).
 * Moving toward the table is what carries this seat up-screen, parking
 * the crown at the near rail where the mockup puts it, with the rail's
 * shadow band swallowing the chest.
 */
export const LOCAL_SEAT_TUCK = 0.35;

/**
 * The two near-side seats tuck toward the table as well (product
 * direction: "bring backleft and backright in more"). Their toward-table
 * direction points up-frame and inward, so the tuck pulls them out of the
 * frame's corners and closer to the rail, where the rail fade grounds
 * them. Smaller than the local seat's tuck — they are further from the
 * camera, so the same world distance moves them further on screen.
 */
export const NEAR_SIDE_TUCK = 0.22;

/** Where the quad sits along seat-local Z for a given state. */
export function spriteSeatOffsetZ(
  slot: number,
  folded: boolean,
  betting: boolean
): number {
  const tuck =
    slot === 0 ? LOCAL_SEAT_TUCK : seatNeedsRailFade(slot) ? NEAR_SIDE_TUCK : 0;
  const base = SPRITE_SEAT_OFFSET_Z + tuck;
  if (folded) return base - SPRITE_FOLD_RECEDE;
  if (betting) return base + 0.12;
  return base;
}

/** Winner pulse: peak extra scale. */
export const WIN_PULSE = 0.02;
export const WIN_PULSE_HZ = 1.4;

/**
 * Tint multiplied over the artwork per state.
 *
 * TINT_FOLDED is far lighter than the value the standee used (#55515c) and
 * that is not a softening of the signal — it is the same signal against
 * different art. These renders are a black leather jacket and near-black
 * hair lit by a rim, so a 0.33 multiply took a folded player to roughly
 * felt-black: on a render the folded seats read as empty chairs rather
 * than as people sitting out. A fold has three other tells (the recede,
 * the mucked cards, the nameplate reading "Folded"), so the tint only has
 * to say "not in this one", not erase them.
 */
export const TINT_IDLE = "#e9e5ec";
export const TINT_ACTING = "#ffffff";
export const TINT_FOLDED = "#9b95a3";

/** Damping rate for THREE.MathUtils.damp on pose and tint. */
export const POSE_DAMP = 3.2;

/**
 * Where a slot's figure ends up once folded — the seat position pushed out
 * along its own radial by SPRITE_FOLD_RECEDE. The renderer damps toward
 * this and the nameplates project it, so a plate can never float away from
 * the head it names.
 */
export function spriteFoldedSeatPosition(slot: number): Vec3 {
  const seat = seatPosition(slot);
  const planLength = Math.hypot(seat.x, seat.z) || 1;
  return {
    x: seat.x + (seat.x / planLength) * SPRITE_FOLD_RECEDE,
    y: seat.y,
    z: seat.z + (seat.z / planLength) * SPRITE_FOLD_RECEDE,
  };
}
