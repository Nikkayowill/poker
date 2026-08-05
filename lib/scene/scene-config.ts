/**
 * Every number the 2.5D room is built from, in one file.
 *
 * The scene is a *fixed* camera looking down at a table. Nothing here is a
 * runtime control -- there is no orbit, no zoom, no pan -- so these constants
 * are the whole geometry contract between the WebGL room and the DOM HUD
 * drawn over it. They live in `lib/` rather than beside the renderer because
 * `vitest.config.ts` only collects tests under `lib/` and `app/`; anything in
 * `components/` is unreachable by `npm test`, and the projection maths below
 * is exactly the sort of thing that must not drift silently.
 *
 * Units are stylised, not architectural, and it is worth being straight about
 * that. A real table is 75cm tall and 2m wide -- a ratio of about 1:2.7 --
 * and a scene modelled that way, shot from a camera fixed at y = 12, would
 * show the players' legs and half the room. This table is a 9.0 x 5.2 top
 * standing 0.9 off the floor, which is a squat plinth in section and reads as
 * a poker table in frame, because the only cue the camera gives for height is
 * the shadow under the rim.
 *
 * What *is* held to scale is everything relative to the felt: a chip is a
 * 0.4-radius disc against a 9.0 half-width table (a 39mm chip on a 2.1m
 * table, near enough exactly right), and a seated player is 3.6 tall against
 * that same 9.0. Those two ratios are what make the room read; the absolute
 * heights are free, and are set by what frames well.
 */

/** A plain XYZ triple. Deliberately not THREE.Vector3: this module stays pure. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The cockpit camera.
 *
 * Back and above the table centre, tilted down. The lookAt sits at z = -1
 * rather than the origin so the table's near edge falls a little below the
 * middle of the frame, which is where it sits when you are the one at the
 * rail -- aiming at dead centre puts as much empty floor below the table as
 * above it and the shot reads as a diagram rather than a chair.
 */
export const CAMERA = {
  fov: 45,
  near: 0.1,
  /**
   * The floor plane is 100x100 and the camera is 19.2 units from the table,
   * so the far corner of the room is ~85 units away. 200 clears it with room
   * to spare while keeping the depth buffer tight enough that the rim and the
   * avatars behind it never z-fight.
   */
  far: 200,
  position: { x: 0, y: 12, z: 14 } as Vec3,
  target: { x: 0, y: 0, z: -1 } as Vec3,
} as const;

/**
 * The overhead lamp, and the only real light in the room.
 *
 * Intensity 5 with a 47-degree cone and a soft penumbra puts a bright pool on
 * the felt and lets everything past the rim fall away. That falloff is the
 * entire look: the chips and the board stay legible because they are inside
 * the pool, and the floor, the chair backs and the far half of every player
 * roll off into the dark without a single extra texture being loaded.
 */
export const SPOTLIGHT = {
  color: 0xfff5e6,
  /**
   * The illuminance wanted *at the felt* -- not the number handed to
   * `THREE.SpotLight`. See `spotlightIntensityFor` below for why those are
   * different, and by a factor of two hundred.
   */
  intensity: 5.0,
  /**
   * Widened from the spec's PI/3.8, and the penumbra softened from its 0.85,
   * for one measured reason.
   *
   * `penumbra` is the *fraction of the cone* given over to the fade, so with
   * p = 0.85 full brightness ends at 15% of the cone's half-angle -- about
   * 2.3 world units out on a felt whose radius is 11. The result is not a
   * moody table: it is a bright coin in the middle of a black one, with no
   * readable edge and no visible rail. Verified in a render, not reasoned
   * about.
   *
   * At these two values full brightness reaches roughly 7 units and the fade
   * runs out past 18, so the cloth carries a real gradient from centre to
   * rail while the floor beyond the chairs still falls away to nothing --
   * which is the effect the spec's prose asks for even though its numbers
   * describe a different one.
   */
  angle: Math.PI / 3.4,
  penumbra: 0.55,
  /**
   * Physical falloff, so the pool has an edge. With decay 2 the lamp obeys
   * the inverse-square law and the felt is meaningfully brighter than the
   * rail 6 units further out; with the default decay of 1 the whole room lifts
   * evenly and the contrast this scene is built on disappears.
   */
  decay: 2,
  /** Past this the lamp contributes nothing, which lets the room stay dark. */
  distance: 60,
  position: { x: 0, y: 15, z: 0 } as Vec3,
  target: { x: 0, y: 0, z: 0 } as Vec3,
} as const;

/**
 * The number `THREE.SpotLight` actually wants, for a lamp `distance` away
 * from the surface it is meant to light at `SPOTLIGHT.intensity`.
 *
 * Since r155 three's lights are physically based and there is no legacy
 * lighting mode left to switch back to: a spotlight with `decay: 2` obeys the
 * inverse-square law, so the illuminance reaching a surface is
 * `intensity / distance^2`, and "intensity" is a candela figure rather than
 * the unitless brightness dial it used to be. Handing it a flat 5.0 -- the
 * figure the design spec states, and a perfectly reasonable one under the
 * pre-r155 convention -- puts 5/14.1^2, or about 0.025, on the felt. That is
 * not a dim table; it is a black rectangle, which is exactly what the first
 * render of this scene produced.
 *
 * Multiplying back out by the square of the distance restores the spec's
 * intent (a felt lit at 5) while keeping the physical falloff that everything
 * *past* the felt depends on -- the rail, the chairs and the floor still roll
 * off with distance, which is the entire mood of the room.
 *
 * Derived rather than hardcoded so that moving the lamp cannot silently
 * darken the table: change `SPOTLIGHT.position.y` and the exposure follows.
 */
export function spotlightIntensityFor(distance: number): number {
  return SPOTLIGHT.intensity * distance * distance;
}

/**
 * The floor of the exposure, not a fill light.
 *
 * A cold near-black at 0.4 keeps the shadows blue rather than crushed, so an
 * avatar's shoulders outside the lamp's pool still read as a silhouette
 * instead of a hole in the frame.
 */
export const AMBIENT = {
  color: 0x1a1a24,
  intensity: 0.4,
} as const;

/**
 * The sandwich, back to front.
 *
 * These are world-space Y and Z offsets, not render-order integers -- the
 * scene is genuinely three-dimensional, so the layering is done by putting
 * things where they physically are and letting the depth buffer sort it out.
 * The one thing that *is* a stated ordering is that the rim's front arc has a
 * greater Z than the near seats' sprites, which is what lets it cut across
 * their chests (see LAYERS.rim below).
 */
export const LAYERS = {
  /** Layer A. Flat, at y = 0, far below everything. */
  floor: { y: 0, size: 100 },
  /** Layer B. Chair backs, outside the seat ring, leaning slightly in. */
  chair: { ringScale: 1.16, height: 2.6, width: 3.0, y: 0.0 },
  /** Layer C. The avatar sprites themselves. */
  avatar: { ringScale: 1.0, y: 0.0 },
  /**
   * Layer D. The upholstered armrest.
   *
   * Its top surface sits at y = 1.15, which is above the felt (y = 0.9) and
   * -- for the near seats -- in front of the avatar plane in Z. That is the
   * whole depth illusion: a flat sprite passes *behind* a solid ring, and the
   * ring cuts it off at the stomach exactly the way a real rail does.
   */
  rim: { y: 1.15, innerScale: 1.0, thickness: 1.25 },
} as const;

/**
 * The felt's ellipse, in world units. Everything else on the table is
 * expressed as a multiple of these two radii, so the table can be restyled
 * into a wider or rounder oval by editing exactly two numbers.
 */
export const FELT = {
  radiusX: 9.0,
  radiusZ: 5.2,
  /** Table height. Chips, cards and the pot all rest on this plane. */
  y: 0.9,
} as const;

/**
 * Where the players sit, as a multiple of FELT's radii.
 *
 * Greater than 1 by design -- a seat is outside the felt, at the rail. The
 * chair ring (LAYERS.chair.ringScale) is further out again so a backrest is
 * always behind the person in front of it no matter which side of the table
 * they are on.
 */
export const SEAT_RING = {
  radiusScale: 1.19,
  /**
   * The height of a seated half-body, against the felt's 9.0 half-width.
   * Only the width is per-avatar: each sprite derives its own from its
   * texture's aspect, because the artwork runs from 512x630 to 512x755 and a
   * shared width would stretch the narrow ones into different people.
   */
  figureHeight: 2.6,
  /**
   * How far the bottom of the sprite sits below the rim's top surface.
   *
   * The artwork is a half-body that begins at the waist, so "the bottom of
   * the sprite" is the player's stomach -- it has to start below the rail or
   * Layer D has nothing to cut across. At 0.8 against a 3.6 figure the rail
   * crosses about 22% up, which is the lower chest.
   *
   * Note that a sprite's `position` is its *base*, not its centre: the
   * renderer sets `sprite.center` to (0.5, 0) so this number means what it
   * says. Left at the default (0.5, 0.5) the same value would bury half of
   * every player under the floor.
   */
  figureSink: 0.62,
} as const;

/**
 * The blurred disc under each seat that grounds a flat sprite to its chair.
 *
 * Without it a billboarded cut-out reads as a sticker hovering in the room --
 * this is the single cheapest thing in the scene that makes a person look
 * like they are sitting somewhere.
 */
export const SHADOW_ANCHOR = {
  radius: 1.5,
  opacity: 0.55,
  /** Just clear of the floor, so it never z-fights with it. */
  y: 0.012,
} as const;

/**
 * Hard ceiling on every texture this scene loads.
 *
 * Stated here and asserted in `scene-config.test.ts` rather than left as a
 * habit, because the cost of breaking it is invisible in development: a
 * 2048px carpet costs 16MB of VRAM after upload and nothing about it looks
 * wrong on a desktop GPU, while on the low-end phones this scene is built for
 * it is the difference between a smooth table and a reload.
 */
export const MAX_TEXTURE_PX = 1024;

/**
 * Device pixel ratio ceiling.
 *
 * A modern phone reports 3 or 4, which would have the GPU shading nine to
 * sixteen times the pixels of a CSS-pixel-for-pixel render for a scene whose
 * entire content is soft gradients and blurred shadows. Two is where the
 * returns stop being visible on this material.
 */
export const MAX_PIXEL_RATIO = 2;

/**
 * The colour of the room itself. The floor is a deep, desaturated mahogany
 * rather than a black, so the lamp has something to fall off *into*: a pure
 * black floor gives the spotlight nothing to grade against and the pool's
 * edge turns into a hard circle.
 */
export const ROOM = {
  floorColor: 0x140f10,
  floorRoughness: 0.92,
  /** Low, but not zero: a lounge carpet has a faint sheen under a lamp. */
  floorMetalness: 0.04,
  feltColor: 0x0f4c33,
  feltRoughness: 0.96,
  railColor: 0x241a17,
  railRoughness: 0.55,
  chairColor: 0x1b1315,
  chairRoughness: 0.78,
} as const;

/** Fog, so the far wall of the room is darkness rather than an edge. */
export const FOG = {
  color: 0x07070b,
  near: 18,
  far: 62,
} as const;
