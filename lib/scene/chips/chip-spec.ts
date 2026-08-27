/**
 * What a chip *is*: how big it draws, what it is made of, and how it differs
 * from the chip next to it.
 *
 * THE ONE IDEA IN HERE IS THAT A CHIP IS SIZED IN PIXELS, NOT IN WORLD UNITS.
 *
 * The system this replaced sized the chip in world units and let the
 * projection decide what that came to on screen. That is the physically
 * honest thing to do and it is why the chips read as flat decals. Run the
 * arithmetic: the classic room fits its felt to `.poker-rail`, so a desktop
 * plate lands around 44 CSS pixels per world unit and a portrait phone around
 * 17. A chip's painted edge is its thickness times the projection's vertical
 * rise, so the old 0.05-unit chip showed 1.7px of side wall on a desktop and
 * 0.65px on a phone. Under a pixel of wall there is no cylinder — there is a
 * coloured ellipse, which is exactly what "too flat, too much like a UI
 * element" describes.
 *
 * So the spec is written from the side wall inward. The wall is the load-
 * bearing detail (it is the only thing that says "cylinder" rather than
 * "circle"), it needs 3–5 visible pixels to read as one, and at a sane
 * wall-to-radius ratio that fixes the minimum radius too. Everything else —
 * bevel width, groove radius, insert depth, numeral size — is a fraction of
 * the radius, so the whole chip stays in proportion at any size the clamp
 * hands back.
 *
 * WHAT THE WORLD UNITS ARE STILL FOR. Position and motion, and nothing else.
 * `CHIP_RADIUS` in `scene-config.ts` remains the layer's length unit — it is
 * what `chip-space.ts` pins the racetrack's metres-per-world-unit to, and
 * every arc peak and drop height is expressed in it. This module never moves
 * a chip; it only says how one is drawn once something else has decided where
 * it goes.
 *
 * Pure, deterministic, and in `lib/` because `vitest.config.ts` collects only
 * `lib/` and `app/`. Nothing in here reads a canvas, a DOM node, a clock or
 * `Math.random()`.
 */

/* ------------------------------------------------------------------ *
 * Proportions.
 * ------------------------------------------------------------------ */

/**
 * The drawn radius, as a multiple of the layer's world `CHIP_RADIUS`.
 *
 * The old painter carried 1.35 here to fight the collapse described above.
 * Enlarging a chip does not make it less flat, though — it makes it a wider
 * flat thing, which is the other half of the complaint. The wall clamp below
 * is what actually buys the depth, so this number goes the other way and the
 * token gets *smaller*: about 17% narrower than the chip it replaces, which
 * is what "more compact, more vertical" costs on the horizontal axis.
 */
export const CHIP_DRAW_SCALE = 1.12;

/**
 * Side wall height as a fraction of the drawn radius.
 *
 * A real 39mm clay chip is 3.3mm thick — a ratio of 0.17 against its radius,
 * which at the sizes below would be one or two pixels and invisible. This is
 * a deliberate stylisation, in the same family as the exaggerated card corner
 * radius every poker client draws: the chip is read at 14 pixels across, so
 * the feature that carries its identity has to survive at 14 pixels across.
 */
export const WALL_RATIO = 0.5;

/**
 * The side wall's visible band, in CSS pixels.
 *
 * Below 3px the wall antialiases into a dark rim and the cylinder is gone.
 * The ceiling is 4 rather than 5 because the wall is also the stack pitch (see
 * `stackPitchPx`), and the separation between two chips in a column has its
 * own tighter budget: past four pixels a nine-high stack is a tower rather
 * than a stack of chips, and on a phone plate it would stand taller than the
 * felt is deep. Four holds both requirements at once, so there is one number
 * here instead of two that can drift apart.
 */
export const MIN_WALL_PX = 3;
export const MAX_WALL_PX = 4;

/**
 * The drawn radius' own bounds, in CSS pixels.
 *
 * The floor is derived, not chosen: `MIN_WALL_PX / WALL_RATIO`. A radius any
 * smaller cannot carry a three-pixel wall without the chip turning into a
 * barrel. This is what puts legible chips on a portrait phone, where the
 * honest projection would draw them two pixels wide.
 *
 * The ceiling stops a very large desktop plate from growing chips into
 * saucers; past it the table gets more chips rather than bigger ones, which
 * is what a real table does too.
 */
export const MIN_RADIUS_PX = MIN_WALL_PX / WALL_RATIO;
export const MAX_RADIUS_PX = 17;

/**
 * The gap between two chips in a stack is exactly the wall. That is not a
 * coincidence to be tuned later — it is what makes a column read as one
 * continuous cylinder with scored lines across it rather than as separate
 * discs floating above each other. It also lands the stack's vertical
 * separation at 3–4px across the sizes that actually ship.
 */
export function stackPitchPx(wallPx: number): number {
  return wallPx;
}

/**
 * The world radius a chip should be drawn at, for this fit.
 *
 * SOLVED ONCE PER FIT AND THEN TREATED AS THE TRUTH, which is the part that
 * matters. The pixel clamp above cannot live only in the painter: if the
 * painter quietly enlarges a chip on a phone while the layout still spaces
 * columns by the unenlarged radius, the pile's columns overlap and its stacks
 * intersect — the felt would be laid out for one chip size and drawn at
 * another. Solving the world radius here and handing it to both the layout
 * and the painter keeps them describing the same object.
 *
 * `pixelsPerUnit` is the projection's scale at the felt. Under the classic
 * room's orthographic tilt that is the whole scene's scale; under the
 * racetrack's pinhole camera it is the scale at the pot, and chips nearer or
 * further than that draw correspondingly larger or smaller — which is the
 * perspective doing its job, not an error to correct.
 */
export function solveChipWorldRadius(baseWorldRadius: number, pixelsPerUnit: number): number {
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) return baseWorldRadius * CHIP_DRAW_SCALE;
  const wanted = baseWorldRadius * CHIP_DRAW_SCALE * pixelsPerUnit;
  return clamp(wanted, MIN_RADIUS_PX, MAX_RADIUS_PX) / pixelsPerUnit;
}

export interface ChipMetrics {
  /** Half the chip's drawn width, in CSS pixels. */
  radiusPx: number;
  /** Half its drawn height — the face, foreshortened by the ground squash. */
  faceRadiusPx: number;
  /** The visible side wall, in CSS pixels. */
  wallPx: number;
  /** Screen rise from one chip in a stack to the next, in CSS pixels. */
  pitchPx: number;
}

/**
 * How big this chip draws, here, on this camera.
 *
 * `worldRadius` is what `solveChipWorldRadius` handed back for this fit, so
 * the draw scale is already in it. `pixelsPerUnit` is the projection's scale
 * **at the chip's own position** — a constant under the classic room's
 * orthographic tilt, and a function of depth under the racetrack's pinhole
 * camera, which is why it is passed per chip rather than read once per frame.
 *
 * The clamp is applied again here, and it is not redundant: under perspective
 * a chip at the far rail projects smaller than one at the pot, and the wall
 * floor has to hold for that chip too.
 *
 * `squash` is the minor/major ratio of a disc lying on the cloth. The face is
 * a circle in the world; on screen it is that circle foreshortened, and the
 * ratio is the sine of the camera's elevation either way.
 */
export function chipMetrics(
  pixelsPerUnit: number,
  squash: number,
  worldRadius: number,
  sizeVariance = 1,
): ChipMetrics {
  const raw = worldRadius * pixelsPerUnit * sizeVariance;
  const radiusPx = clamp(Number.isFinite(raw) ? raw : MIN_RADIUS_PX, MIN_RADIUS_PX, MAX_RADIUS_PX);
  const wallPx = clamp(radiusPx * WALL_RATIO, MIN_WALL_PX, MAX_WALL_PX);
  return {
    radiusPx,
    faceRadiusPx: radiusPx * clamp(squash, 0.15, 1),
    wallPx,
    pitchPx: stackPitchPx(wallPx),
  };
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/* ------------------------------------------------------------------ *
 * Material.
 * ------------------------------------------------------------------ */

/**
 * A chip's material, as the five colours the painter actually needs.
 *
 * Compressed clay, not plastic and not ceramic: the values are desaturated a
 * step from the primaries a vector chip would use and the lightest of them is
 * bone rather than white, because a matte surface never returns a full
 * specular and a chip drawn with one reads as a glossy arcade token.
 *
 * `inlay` deliberately sits close to `body` on every denomination above the
 * one-chip. A high-contrast centre disc is the tell of a printed sticker
 * pressed into a moulded blank; a compression-moulded chip's inlay is the
 * same clay under a different pass, so it differs in value and barely in hue.
 */
export interface ChipMaterial {
  /** The face and the lit side of the wall. */
  body: number;
  /** The alternating edge inserts, on the face's rim and around the wall. */
  spot: number;
  /** The pressed centre disc. */
  inlay: number;
  /** The denomination, printed on the inlay. */
  ink: number;
}

export const CHIP_MATERIALS: Record<number, ChipMaterial> = {
  1: { body: 0xd9d3c3, spot: 0x4a6f9c, inlay: 0xe9e4d6, ink: 0x2f2a20 },
  5: { body: 0x9e2b2f, spot: 0xe6ddcb, inlay: 0xb13a3e, ink: 0xf3ece0 },
  25: { body: 0x1f6a48, spot: 0xe6ddcb, inlay: 0x2a7e57, ink: 0xf3ece0 },
  100: { body: 0x1b1c1f, spot: 0xb99a4e, inlay: 0x26282c, ink: 0xe6d59a },
};

/** The material for a denomination, falling back to the smallest chip. */
export function chipMaterial(denomination: number): ChipMaterial {
  return CHIP_MATERIALS[denomination] ?? CHIP_MATERIALS[1];
}

/**
 * A colour pushed toward white (positive) or black (negative).
 *
 * Every highlight, bevel and wall shade in the painter is arithmetic on the
 * four colours above rather than a fifth, sixth and seventh palette entry.
 * That is what keeps a denomination's look consistent when one of its colours
 * is retuned — the whole chip moves with it.
 */
export function shade(color: number, amount: number): number {
  const clamped = clamp(amount, -1, 1);
  const toward = clamped >= 0 ? 255 : 0;
  const mix = (channel: number) => Math.round(channel + (toward - channel) * Math.abs(clamped));
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}

/** `0x1b1c1f` as `#1b1c1f`. */
export function css(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
}

/** The same colour with an alpha, for the shadows and the soft highlights. */
export function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}, ${clamp(alpha, 0, 1)})`;
}

/* ------------------------------------------------------------------ *
 * Face anatomy.
 * ------------------------------------------------------------------ */

/**
 * How many edge inserts a chip carries.
 *
 * Eight is the cadence the house chip has worn through every renderer this
 * game has had, and it is also the count that survives the smallest size:
 * twelve inserts on a 12px-wide face are a dotted line.
 */
export const INSERT_COUNT = 8;

/** Where the face's features sit, as fractions of the drawn radius. */
export const FACE = {
  /** Outside this the rim bevel turns down toward the wall. */
  bevel: 0.93,
  /** The insert ring: between these two the alternating spots are stamped. */
  insertOuter: 0.97,
  insertInner: 0.74,
  /** The scored groove between the inserts and the inlay. */
  groove: 0.7,
  /** The pressed inlay disc. */
  inlay: 0.55,
  /**
   * The rosette stamped into the inlay, behind the denomination: two thin
   * scored rings and a five-point star, sized to sit inside `inlay` with
   * room to spare rather than crowd its own edge.
   */
  rosetteOuter: 0.42,
  rosetteInner: 0.32,
} as const;

/**
 * Below this drawn radius the denomination is a smudge rather than a numeral,
 * and the chip is better off with a clean inlay.
 *
 * Learned on the dealer avatars and re-learned here: art is judged at the
 * size it actually renders. A three-pixel-tall serif "100" is four grey
 * pixels, which reads as dirt on the chip.
 */
export const NUMERAL_MIN_RADIUS_PX = 9;

/**
 * Below this drawn radius the rosette's two rings collapse into one smeared
 * line and the star into a blob -- the same "art judged at the size it
 * renders" rule `NUMERAL_MIN_RADIUS_PX` states, at the threshold the
 * pressed-inlay depression ring already uses (`paintFace`'s own `rx >= 7`).
 */
export const ROSETTE_MIN_RADIUS_PX = 7;

/* ------------------------------------------------------------------ *
 * Imperfection.
 * ------------------------------------------------------------------ */

/**
 * A stable pseudo-random unit value from an integer seed.
 *
 * Seeded rather than random for the reason every position in this system is:
 * the pile is rebuilt from the pot on every snapshot, so a chip that has
 * already settled has to be handed its identical imperfections again or the
 * whole stack shimmers every time anybody bets. It also means a test can
 * assert an exact trajectory, and two tabs watching one table see the same
 * felt.
 */
export function hash01(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** `hash01` mapped onto [-1, 1]. */
function signed(seed: number, salt: number): number {
  return hash01(seed, salt) * 2 - 1;
}

/**
 * What makes this chip not the chip beside it.
 *
 * Perfect alignment is the single loudest tell that a stack is a repeated
 * sprite, and it is the one thing a real dealer's hand cannot produce. These
 * are all small — a fraction of a pixel of slide, a couple of degrees of
 * tilt — because the goal is a hand-stacked column, not a collapsed one.
 */
export interface ChipVariance {
  /**
   * The face pattern's own orientation, over the full circle.
   *
   * Unbounded on purpose, where every other field here is tiny: chips in a
   * real stack are rotated arbitrarily against each other, and a column whose
   * eight inserts line up perfectly from top to bottom is the most synthetic
   * thing on the felt. This costs nothing to vary and buys more than the rest
   * of this interface put together.
   */
  spinRad: number;
  /** Silhouette tilt, ±2°. The chip not sitting quite true on the one below. */
  tiltRad: number;
  /** Slide across the column, ±0.5px. */
  slidePx: number;
  /** Size, 0.97–1.03. Individually invisible; collectively it kills the clone look. */
  sizeScale: number;
}

export const MAX_TILT_DEG = 2;
export const MAX_SLIDE_PX = 0.5;
export const SIZE_VARIANCE = 0.03;

export function chipVariance(seed: number): ChipVariance {
  return {
    spinRad: hash01(seed, 1) * Math.PI * 2,
    tiltRad: (signed(seed, 2) * MAX_TILT_DEG * Math.PI) / 180,
    slidePx: signed(seed, 3) * MAX_SLIDE_PX,
    sizeScale: 1 + signed(seed, 4) * SIZE_VARIANCE,
  };
}

/**
 * What makes this chip's *flight* not the flight beside it.
 *
 * Bigger numbers than the resting variance, and they belong to the journey
 * rather than to the chip: a spray in which every disc traces the same
 * parabola is a particle emitter, not ten objects thrown by a hand. The drift
 * is a mid-flight deviation that returns to zero (see `chip-motion.ts`), so
 * the landing stays exactly where the layout put it — a scattered trajectory
 * must not become a scattered stack.
 */
export interface FlightVariance {
  /** Tumble through the air, ±8°. */
  rollRad: number;
  /** Sideways deviation at mid-flight, ±4px. */
  driftXPx: number;
  /** Vertical deviation at mid-flight, ±3px. */
  driftYPx: number;
  /** Where in the arc this chip is at its widest deviation, 0.35–0.65. */
  driftPhase: number;
}

export const MAX_ROLL_DEG = 8;
export const MAX_DRIFT_X_PX = 4;
export const MAX_DRIFT_Y_PX = 3;

export function flightVariance(seed: number): FlightVariance {
  return {
    rollRad: (signed(seed, 5) * MAX_ROLL_DEG * Math.PI) / 180,
    driftXPx: signed(seed, 6) * MAX_DRIFT_X_PX,
    driftYPx: signed(seed, 7) * MAX_DRIFT_Y_PX,
    driftPhase: 0.35 + hash01(seed, 8) * 0.3,
  };
}
