// A namespace import, not a default one: the package's ESM build (what the
// bundler picks for the browser) has only named exports, and `import Phaser
// from "phaser"` fails at build time with "export default doesn't exist".
import * as Phaser from "phaser";
import { scytheSound } from "@/lib/audio/stackacres-sfx";
import {
  isLivestock,
  type StackAcresLivestock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import {
  ISO_EDGE_ANGLE,
  isoProject,
  isoUnproject,
  projectedBounds,
  projectedCorners,
  unprojectBoundsApprox,
  type DiamondCorners,
} from "@/lib/stackacres/iso";
import { worldBoundsScreenRect } from "@/lib/stackacres/bounds";
import { FARM_PATHS } from "@/lib/stackacres/paths";
import { PROP_SHADOW, WINDMILL_HUB, WINDMILL_SPEED, YARD_PROPS } from "@/lib/stackacres/props";
import type { StackAcresTool } from "@/lib/stackacres/tools";
import { scytheReachFor, type StackAcresToolTier } from "@/lib/stackacres/equipment";
import {
  SPARKLE_MAX,
  godRayAlpha,
  sparkleAlpha,
  sparkleField,
  sparkleScale,
  type Sparkle,
} from "@/lib/stackacres/sunlight";
import { DOCK, DUCK_ORBIT, LILY_PADS, POND, REEDS, RIPPLE_SPOTS } from "@/lib/stackacres/water";
import {
  MEADOW_TILE,
  OUTER_ZONE_IDS,
  STACKACRES_ZONES,
  ZONE_IDS,
  meadowBaseDensity,
  meadowDensityAt,
  meadowTileAt,
  meadowTileKey,
  mowStroke,
  zoneAt,
  zoneFrame,
  zoneGroundTiles,
  zoneHerd,
  zoneScenery,
  type ZoneId,
} from "@/lib/stackacres/zones";
import {
  STACKACRES_CHUNK,
  STACKACRES_MARGIN,
  WORLD_BOUND_MARGIN,
  barnHitAt,
  chunkScenery,
  clampZoom,
  critterSpeed,
  cropSpot,
  growAreaAt,
  growAreaBounds,
  growAreaInterior,
  growthStage,
  scrollToKeepUnderPointer,
  seededRandom,
  spawnCritter,
  stepCritter,
  stockZone,
  stocksInZone,
  type Critter,
  type SceneryKind,
  type WorldPoint,
  type WorldRect,
} from "@/lib/stackacres/world";
import {
  cropArtFor,
  cropFootprintHalf,
  cropGroundOffset,
  cropSpriteAlpha,
  cropSpriteScale,
} from "@/lib/stackacres/crop-visuals";
import { FENCE_BAY } from "@/lib/stackacres/fence";
import {
  FARMHAND_SPEED,
  enqueueFarmhandTask,
  farmhandStandoff,
  farmhandWalking,
  pruneFarmhandTasks,
  spawnFarmhand,
  stepFarmhand,
  type Farmhand,
  type FarmhandTask,
} from "@/lib/stackacres/farmhand";
import {
  FARMHAND_BOOT,
  FARMHAND_HIP_Y,
  legJoints,
  spawnWalk,
  stepWalk,
  type WalkPose,
} from "@/lib/stackacres/farmhand-walk";
import { spawnGait, stepGait, type Gait } from "@/lib/stackacres/gait";
import { SECTOR_FOG, sectorOvergrowth, type SectorId } from "@/lib/stackacres/sectors";
import {
  ART_FRAME,
  ART_SCALE,
  GRASS_PX,
  PAINTERS,
  bakeArt,
  bakeGodRays,
  bakeGrass,
  bakeSparkle,
  bakeVignette,
  type PainterName,
} from "./stackacres-art";
import { SPRITE_ART, SPRITE_NAMES, spriteLoadKey } from "./stackacres-sprites";
import { RAMPS, rampHex } from "./art-palette";
import { bakePathTexture } from "./art-paths";
import { bakePondTexture } from "./art-water";

/**
 * The farm as a place you look around in.
 *
 * One Phaser scene draws the whole world -- the barn yard, every district,
 * the owned units standing in them, and the woodland the farm was cut out
 * of -- and the camera is what the player moves: drag to pan, pinch or wheel
 * to zoom. The camera is bounded (lib/stackacres/bounds.ts, wired in here at
 * the top of `create()`): a hard edge sits a margin past the outermost
 * district, and Phaser simply will not scroll the camera across it. Roaming
 * off the edge of a district is still not an error state to fence off --
 * the whole point of a map over a grid is that there is somewhere to walk to
 * -- so short of that hard edge the world is still grown in chunks around
 * wherever the camera is (`tendWorld`) and thrown away again once it is well
 * out of sight; the bound just gives that growth a finite range to ever be
 * asked for.
 *
 * Nothing is downloaded. Every picture is a Canvas2D painter from
 * ./stackacres-art.ts, baked once at boot into a texture at ART_SCALE device
 * pixels per unit and then only ever scaled DOWN by the camera, which is what
 * keeps it smooth at 5x where a 16px tile sheet went to mush.
 *
 * This file paints. It owns no rules: every unit arrives already decided
 * (what it is, what state it is in, how far along it is) from the React
 * shell, which reads that straight off lib/stackacres/units.ts. THERE IS NO
 * PLOT GRID ANY MORE (see 2026-09-03's CLAUDE.md entry -- "districts hold
 * stock, not plots"), but the farm IS tappable again: a tap that lands on a
 * unit's own picture collects, feeds or clears it where it stands, and a tap
 * on a district's empty fenced ground offers to seed something there. The
 * scene reports WHICH unit and WHERE (`onUnitTap`, `onGroundTap`) and
 * nothing else -- it still owns no rules, and lib/stackacres/tap-action.ts
 * is what decides whether that finger is worth a network call.
 *
 * The HUD, the toolbelt and the district sidebar are NOT in here. They stay
 * as DOM, pinned over the canvas by CSS, because a `<button>` is reachable by
 * a screen reader and a thumb alike, and a Phaser Text object is neither --
 * so the sidebar's own unit rows remain the keyboard and screen-reader path
 * to everything a tap on the map now does faster.
 * Those overlays are siblings of the canvas host rather than children of it,
 * so a press on one never reaches the map at all -- which is also why
 * Phaser's own input is switched off entirely (see stackacres-world.tsx) and
 * every gesture is read straight off the host element with native pointer
 * events. See `bindInput` for why that matters more than tidiness, and
 * `unitAt` for why a tap on a unit is resolved by hand at release rather
 * than by a `GAMEOBJECT_POINTER_DOWN` on each sprite.
 *
 * Three coordinate systems meet here and it matters which one is in hand.
 *
 * `world.ts` space is the true Cartesian plane every game rule lives in: a
 * district's grow area is a rectangle at `growAreaBounds(zone)`, an animal
 * walks inside `growAreaInterior(zone)`, a crop sits at a fixed
 * `cropSpot(zone, unitId)`. Nothing in that file, or in `paths.ts` /
 * `water.ts` / `props.ts` / `zones.ts`, knows the camera is isometric -- it
 * never has to.
 *
 * `iso.ts` is the seam: `isoProject` turns a world point into the sheared,
 * diamond-tiled space this scene actually draws into ("scene space" below),
 * and `isoUnproject` is its exact inverse. Every literal world-space number
 * this file reads from `world.ts`/`paths.ts`/`water.ts`/`props.ts`/
 * `zones.ts` -- a grow area's corner, a prop's feet, an animal's walk
 * position -- goes through `isoProject` before it becomes a Phaser position
 * or a depth key. Every point Phaser hands back (a pointer's world point,
 * `cam.getWorldPoint`) goes through `isoUnproject` before it is allowed near
 * `meadowTileAt` or any other function that wants true world space -- the
 * scythe's own drag is the only gesture left that still needs this round
 * trip.
 *
 * On top of that, the canvas is DPR times denser than the screen (that
 * density is what makes the vector art crisp), so Phaser's camera width and
 * zoom are in device pixels, while a pointer event is in CSS pixels. The
 * `viewW`/`viewH`/`zoomL`/`toScreen` helpers are the CSS-pixel side; the
 * `cam.*` values are the device-pixel side.
 */

/**
 * One owned animal or crop, as the scene draws it. Successor to the old
 * per-plot `StackAcresSceneCell`: a unit has no position of its own to carry
 * in (an animal wanders inside its district's `growAreaInterior`, a crop
 * sits at a deterministic `cropSpot`), so there is no `plotIndex`, `afford`,
 * `selected` or `purchasable` here -- those all existed to answer "what
 * would the held tool do to this square", and there is no square any more.
 */
export interface StackAcresSceneUnit {
  id: string;
  stock: StackAcresStock;
  state: "working" | "hungry" | "dry" | "ready" | "mucked";
  /** 0..1 while working, 1 once ready, null while mucked. */
  progress: number | null;
  /** True once bought outright with Gold -- drawn no differently, kept only
   *  because it is part of what makes a unit's own picture change (see
   *  `signatureOf`), the same way it was on the old cell. */
  permanent: boolean;
}

/** Where a tap landed, in CSS pixels relative to the canvas host -- which is
 *  also the box every DOM overlay on this screen is positioned in, so the
 *  shell can drop a menu or a label straight onto these numbers. */
export interface TapPoint {
  x: number;
  y: number;
}

export interface StackAcresSceneCallbacks {
  /** Fired once the first frame with units on it has been drawn. */
  onReady: () => void;
  /**
   * A tap that landed on an owned unit's own picture. The scene reports WHICH
   * unit and WHERE; it does not know what tapping one is worth, and the shell
   * decides that through lib/stackacres/tap-action.ts.
   */
  onUnitTap: (unitId: string, at: TapPoint) => void;
  /**
   * A tap on a district's own fenced ground that hit no unit -- an offer to
   * seed something there, answered by the radial menu in stackacres-farm.tsx.
   */
  onGroundTap: (zone: ZoneId, at: TapPoint) => void;
  /**
   * A tap that landed on the barn -- Ray's Museum's own entryway. Checked
   * after a unit (a unit's own picture always wins over the structure
   * standing behind it) and before the district ground fallback, the same
   * ordering `unitAt` already documents for "the farm itself" taps.
   */
  onBarnTap: () => void;
  /**
   * A tap ANYWHERE on a district the player has not cleared yet.
   *
   * Deliberately the whole district rather than the narrow fenced box
   * `onGroundTap` uses, and that difference is the entire discovery story for
   * this feature. There is nothing drawn on locked land to aim at -- no pen,
   * no plot, no padlock, just trees -- so the target has to be the trees, and
   * every one of them has to answer. A player who taps a wood and gets
   * nothing has learned that the wood is scenery, and will not tap it again.
   */
  onLockedSectorTap: (zone: ZoneId, at: TapPoint) => void;
  /**
   * The view moved under whatever the shell has pinned to it. A menu dropped
   * at a finger is anchored to the screen, not to the world, so it has to go
   * away rather than drift off the thing it was opened on.
   */
  onViewMoved: () => void;
}

export interface StackAcresSceneOptions {
  reducedMotion: boolean;
  /** The equipment rung the player holds, which is what sets the scythe's
   *  swathe. Mutable through `setToolTier` -- buying an upgrade must widen
   *  the swathe without tearing the scene down and losing the mown map. */
  toolTier: StackAcresToolTier;
  /**
   * The element the canvas is mounted into. Gestures are read off this rather
   * than off the window or the canvas, so the map only ever hears a press that
   * actually landed on it.
   */
  host: HTMLElement;
}

/**
 * Device pixels per CSS pixel, capped at 2. The cap is the usual one: a 3x
 * phone gains nothing visible over 2x and pays for it in fill rate. Read at
 * import, which is safe because this module only ever loads through
 * stackacres-world.tsx's dynamic import, in a browser.
 */
export const DPR = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);

const S = ART_SCALE;

/** Chrome colours, as the canvas needs them. Same values as 01-tokens.css.
 *  Only the three a unit's own state ring still needs -- the old
 *  `selected`/`blocked` colours (chalk, red) and the afford/progress accent
 *  (violet) went with the plot-tap system they existed for. */
const GOLD = 0xffd23f;
const AMBER = 0xff8a3d;
const MUCK = 0x785830;
/** The dry-soil ring, off RAMPS.water.side -- a crop waiting for a drink is
 *  marked in the colour of the thing it is waiting for. */
const WATER = 0x3fa6cc;

/** How far a finger may wander before a press stops counting as a tap. In CSS
 *  pixels, because pointer events are. */
const TAP_SLOP = 8;
/**
 * Shortest gap between two scythe swishes. A little under the cue's own
 * length, so a continuous sweep overlaps into one sustained cut rather than
 * sounding like separate chops.
 */
const SWISH_GAP_MS = 190;

/** How far outside its own art a unit still answers a tap, in CSS pixels. A
 *  hen at the zoomed-out end of the range is a thumbnail; without this the
 *  only way to collect one is to zoom in first, which is exactly the friction
 *  this whole surface exists to remove. Constant on SCREEN, not in the world
 *  -- it is sized against a fingertip, and a fingertip does not zoom. */
const TAP_PAD = 12;

/** How far the world may slide, in CSS pixels, before anything the shell has
 *  pinned to a screen position is told the ground has moved out from under
 *  it. See `notifyViewMoved`. */
const VIEW_MOVE_SLOP = 4;

/** Inertia after a flick. Speeds are CSS pixels per millisecond. */
const FLICK_WINDOW_MS = 80;
/** Anything faster than this was a swipe at the screen, not a throw. */
const FLICK_SPEED_CAP = 4;
const FLICK_SPEED_MIN = 0.12;
/** Per 16ms, so the coast is frame-rate independent. */
const GLIDE_DECAY = 0.92;
const GLIDE_STOP = 0.02;

// The barn stands north of the Farmstead's own grow area with a yard
// between: its feet are on y 34, and the lane and road (lib/stackacres/
// paths.ts) run through that gap.
const BARN_X = STACKACRES_MARGIN + 44;
const BARN_Y = STACKACRES_MARGIN - 30;

// Ground art sits just above the grass and well below anything with feet:
// the paths at -1e8, the pond one above them so its sand paints over the
// spur's end cap, and the water's surface (glints, ripples) one above that.
/** The districts' own ground sits under the paths: a road is laid ON a
 *  field, so the field has to be beneath it, and both are above the lawn. */
const ZONE_GROUND_DEPTH = -1e8 - 10;
/** A district's grow-area floor (see `paintDistrictBoundary`) sits one step
 *  above the district's own base ground, so a Hen Coop's straw reads as laid
 *  ON the Farmstead rather than floating over it -- still far below every
 *  real object in the scene, by the same always-behind-everything logic
 *  `ZONE_GROUND_DEPTH` itself uses. */
const GROW_AREA_GROUND_DEPTH = ZONE_GROUND_DEPTH + 1;
const PATH_DEPTH = -1e8;
const POND_DEPTH = PATH_DEPTH + 1;
const POND_SURFACE_DEPTH = PATH_DEPTH + 2;

/** How many glints drift across the pond at once. */
const GLINT_COUNT = 5;

/** Which animal stands in which district's grow area. Exhaustive over
 *  livestock only (never crops) -- every read of this table is already
 *  behind an `isLivestock` check, so there is nothing to fall back to. */
const STOCK_ART: Readonly<Record<StackAcresLivestock, PainterName>> = {
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

/**
 * Which way each animal's own art already faces, before anything mirrors it.
 * Only the exceptions are listed; everything else was drawn facing right.
 *
 * The sheep is the one that came back from the sprite batch (see
 * stackacres-sprites.ts) facing the other way, and it was kept as drawn --
 * so which way to mirror is a fact about the picture, not a constant. Both
 * animal draw sites used to hard-code it, and hard-code it differently: the
 * pens flipped on one sign and the districts' herds on the other, which meant
 * one of the two had every animal walking backwards. This is the single
 * answer both of them now ask.
 */
const ART_FACES: Readonly<Partial<Record<PainterName, 1 | -1>>> = { sheep: -1 };

/** The sprite x-scale sign that turns `art` to face `heading` (`Critter.facing`
 *  -- 1 for screen-right). A mirror is a negative x scale rather than
 *  `setFlipX` so it composes with the breathing scale in one call. */
function mirrorFor(art: PainterName, heading: 1 | -1): 1 | -1 {
  return heading === (ART_FACES[art] ?? 1) ? 1 : -1;
}

/** A Phaser packed colour, lightened (positive) or darkened (negative) by a
 *  flat channel amount. The one-sun shading every isometric structure below
 *  uses: a roof lit from directly above, a left wall toward the light, a
 *  right wall away from it -- the same three-tone convention `litMass` uses
 *  elsewhere in this codebase, done by hand because these are one-off
 *  Graphics shapes rather than a baked painter. */
function shadeColor(hex: number, amt: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((hex >> 16) & 0xff) + amt);
  const g = clamp(((hex >> 8) & 0xff) + amt);
  const b = clamp((hex & 0xff) + amt);
  return (r << 16) | (g << 8) | b;
}

/** Only things with height get a shadow: a canopy, a fallen log, a boulder.
 *  A rock, a tuft or a mushroom sitting on a smudge of its own reads as
 *  hovering, not as standing. */
function castsShadow(kind: SceneryKind): boolean {
  return kind.startsWith("tree") || kind === "pine" || kind === "bush" || kind === "log" || kind === "boulder";
}

/** How wide and tall a wild thing's ground shadow is, as a scale of the
 *  36x16 `shadow` painter: a tree's pool is most of it, a log's a low slot. */
function sceneryShadowScale(kind: SceneryKind): readonly [number, number] {
  switch (kind) {
    case "bush":
      return [0.95, 1.25];
    case "log":
      return [0.7, 0.5];
    case "boulder":
      return [0.85, 0.7];
    default:
      // Trees and pines, tracking the painters themselves (24 units wide
      // originally, then 42, now 64). A pool sized to a tree that no longer
      // exists leaves a big canopy standing on a saucer.
      return [2.05, 1.75];
  }
}

/**
 * Which district furniture casts a ground shadow, and how big a pool, as a
 * scale of the 36x16 `shadow` painter. Anything lying flat on the ground --
 * a furrow, a mud pool -- is absent on purpose: a shadow under a thing with
 * no height reads as a smudge.
 */
const ZONE_SHADOW: Partial<Record<string, readonly [number, number]>> = {
  hitchPost: [0.28, 0.35],
  hayBale: [0.8, 0.85],
  plough: [0.75, 0.55],
  oxTrough: [0.7, 0.5],
  wallowPost: [0.26, 0.32],
  shadeCanopy: [1.15, 0.9],
  hogTrough: [0.6, 0.45],
};

/** The picture for a meadow tile at a given grass height. Density 0 has no
 *  painter -- the sprite is simply hidden, so a cut tile costs no texture
 *  swap and shows the ground the district already painted. */
function grassArt(density: number): PainterName {
  return density >= 3 ? "grassTall" : density === 2 ? "grassMid" : "grassStubble";
}

/** A finger this map is currently holding, in CSS pixels. */
interface Finger {
  x: number;
  y: number;
}

interface TrailPoint {
  t: number;
  x: number;
  y: number;
}

/**
 * One finger down: a press until it has moved TAP_SLOP, then either a pan
 * (the map moves) or a mow (the scythe cuts a swathe across the Long
 * Meadow) -- decided once, at that moment, by whether the press began on
 * standing grass with the scythe held. There is no plot left for a drag to
 * sweep across instead (buying and tending a unit is the district sidebar's
 * job now), so every press that is not the scythe's own gesture simply pans.
 */
interface DragGesture {
  kind: "press" | "pan" | "mow";
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** The last ~80ms of movement, which is what the flick is measured from. */
  trail: TrailPoint[];
  /**
   * True when the press began on standing grass with the scythe held, which
   * is what lets a drag from there cut instead of panning.
   *
   * Both halves matter. Gating on the tool alone would make the meadow
   * un-pannable while the scythe is out; gating on the grass alone would
   * have every tool mowing. Anywhere else, a drag pans exactly as it always
   * has -- which is also how the player still crosses the meadow to look
   * around: start the drag on a path or a cut patch.
   */
  startMow?: boolean;
}


/**
 * What one grown chunk owns. `items` is everything to destroy when the chunk
 * is pruned; `grassKeys` is the meadow tiles it registered in `grassTiles`,
 * kept alongside because a destroyed sprite cannot be looked up by the key
 * it was filed under.
 */
interface ChunkContent {
  items: Phaser.GameObjects.GameObject[];
  grassKeys: string[];
}

/** One animal in a district's herd. Same shape as a pen's critter, minus the
 *  cell-local business -- these walk in absolute world space. */
interface HerdSprite {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  /** Which painter this one is drawn with, so its walk knows which way the
   *  art already faces. */
  art: PainterName;
  state: Critter;
  /** The weight shift it walks with. See lib/stackacres/gait.ts. */
  gait: Gait;
}

/**
 * The farmhand: one man, always present, and the only thing on this map drawn
 * as a RIG rather than as a picture.
 *
 * `sprite` is his upper body and nothing else -- the generated art cut off at
 * the crotch (see the painters in art-props.ts). `legs` is a Graphics redrawn
 * every frame from the angles in lib/stackacres/farmhand-walk.ts, which is
 * what makes him actually walk instead of sliding about as a frozen pose with
 * a bounce on it. Six shapes a frame for one character is not worth caching.
 *
 * The container/sprite split is the same one `UnitNode` uses and for the same
 * reason: `update` rewrites the sprite's scale every frame for the facing
 * mirror, so anything scaling the SPRITE from outside that line is overwritten
 * within a frame (the trap `popUnit` documents). Position and depth go on the
 * container; the shadow is a fixed local child so it stays on the grass.
 */
interface FarmhandNode {
  container: Phaser.GameObjects.Container;
  /** Retextured in place when he turns toward or away from the camera: the
   *  two painters are different pictures, not two flips of one. */
  sprite: Phaser.GameObjects.Image;
  /** Both legs, redrawn per frame. Added to the container BEFORE the torso so
   *  the hip joint is covered by the overalls rather than by a visible cap. */
  legs: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Image;
  /** Which of the two painters `sprite` is currently showing. */
  art: PainterName;
  state: Farmhand;
  walk: WalkPose;
}

/**
 * The denim and the leather, sampled off the generated art by
 * `rig_farmhand.py` so a drawn leg is the render's own colour and the cut at
 * the hip has no seam to see. One pair per view because the two renders are
 * lit differently: the back's denim is a shade cooler.
 *
 * If the PNG ever fails to load, the drawn fallback torso uses `RAMPS.water`
 * and these are a little off it -- an acceptable mismatch in the case where
 * the art is missing entirely.
 */
const FARMHAND_LIMBS: Readonly<Record<string, { denim: number; boot: number }>> = {
  farmhand: { denim: 0x436f8d, boot: 0x512a14 },
  farmhandBack: { denim: 0x435e80, boot: 0x4c2912 },
};

/** Two fingers down: zoom by the gap between them, pan by their midpoint. */
interface PinchGesture {
  kind: "pinch";
  distance: number;
  zoom: number;
  world: WorldPoint;
}

type Gesture = DragGesture | PinchGesture;

interface UnitNode {
  container: Phaser.GameObjects.Container;
  /** State ring: ready, hungry, mucked. There is no "selected"/"afford"
   *  ring any more -- a unit either shows what it is doing or it does not,
   *  and nothing on the canvas is ever chosen or blocked. */
  ring: Phaser.GameObjects.Graphics;
  /** The unit's own picture: the animal, the crop, or (mucked) the mess
   *  standing in for either. */
  sprite: Phaser.GameObjects.Image;
  /**
   * Present for livestock, driving the same wander `stepCritter` already
   * drives everywhere else on this map (the pond's duck, the districts'
   * ambient herds) -- null for a crop, which is planted at one fixed spot
   * and never moves, and null for a mucked unit of any kind, which has
   * stopped wandering along with everything else it was doing.
   */
  critter: Critter | null;
  /** Out-of-phase breathing offset, so units of the same kind never pulse in
   *  lockstep. */
  phase: number;
  /** The weight shift this one walks with, null for anything that does not
   *  walk. Carried across a rebuild alongside `critter`, so an animal whose
   *  picture is redrawn mid-stride does not snap back to level. */
  gait: Gait | null;
  tweens: Phaser.Tweens.Tween[];
  /** The squash-and-stretch answering the last tap on this unit, if it is
   *  still running. Held on its own rather than pushed onto `tweens`: a unit
   *  can be tapped over and over between rebuilds, and a list nothing ever
   *  prunes would grow one dead chain per tap. */
  pop: Phaser.Tweens.TweenChain | null;
  signature: string;
  unit: StackAcresSceneUnit;
}

/** What a unit's own picture is signed by: only its state, kind, growth
 *  stage and permanence change what gets drawn, so `setUnits` rebuilds a
 *  node exactly when one of these four actually changes. */
function signatureOf(unit: StackAcresSceneUnit): string {
  const stage = growthStage(unit.progress, unit.state === "ready");
  return [unit.state, unit.stock, stage, unit.permanent ? 1 : 0].join("|");
}

export class StackAcresScene extends Phaser.Scene {
  private readonly callbacks: StackAcresSceneCallbacks;
  private readonly options: StackAcresSceneOptions;
  private nodes = new Map<string, UnitNode>();
  private units: StackAcresSceneUnit[] = [];
  private pending: StackAcresSceneUnit[] | null = null;
  private created = false;
  private opened = false;
  private random = seededRandom(Date.now() % 100_000);

  /** Every finger this map is holding, by pointer id, in CSS pixels. A finger
   *  is in here only while the host itself has it -- nothing is inferred. */
  private pts = new Map<number, Finger>();
  private gesture: Gesture | null = null;
  /** Pan inertia, in CSS pixels per millisecond. Null when nothing is coasting. */
  private glide: { x: number; y: number } | null = null;
  /** The host's top-left, re-measured at the start of every gesture. */
  private hostOrigin = { left: 0, top: 0 };
  private unbindInput: (() => void) | null = null;
  /** Wall-clock time of the last scythe swish, throttling the cue. See `mowSegment`. */
  private lastSwishAt = 0;

  private grass: Phaser.GameObjects.TileSprite | null = null;
  /** The screen-pinned wash over everything: darker corners, warm sun corner. */
  private vignette: Phaser.GameObjects.Image | null = null;

  /** The sunbeam layer: one screen-pinned sprite whose only per-frame work is
   *  an alpha assignment. See `bakeGodRays` for why it is one baked texture
   *  rather than a Graphics redraw. */
  private godRays: Phaser.GameObjects.Image | null = null;

  /** The ground-sparkle pool. Exactly SPARKLE_MAX sprites, allocated once in
   *  `create` and recycled forever -- a frame never makes a game object, so
   *  the effect costs the same in the last minute of a session as the first.
   *  Empty under reduced motion: the pool is never built at all. */
  private sparkleSprites: Phaser.GameObjects.Image[] = [];

  /** The live flecks, one per pool slot, driven by lib/stackacres/sunlight.ts. */
  private sparkles: Sparkle[] = [];
  /** The world's own hard edge, in the same projected screen space as
   *  `camera.setBounds()` and `viewRect()` -- set once in `create()`, read
   *  every frame by `fitEdgeGuides()` to know how close the view is to it. */
  private worldBounds: WorldRect | null = null;
  /** The four "you've gone far enough" nudges, one per screen edge, faded in
   *  by `fitEdgeGuides()` as the view nears that edge of `worldBounds`. */
  private edgeGuides: Record<"n" | "e" | "s" | "w", Phaser.GameObjects.Image> | null = null;
  /** Scene time as of the last update(), for anything a pointer event starts. */
  private now = 0;
  /** Grown scenery, by "cx:cy". The open world, one chunk at a time -- the
   *  woodland's trees, and inside a district its own furniture and grass. */
  private chunks = new Map<string, ChunkContent>();

  /**
   * The Long Meadow's living grass, by tile key: the sprite currently
   * standing on that tile, so a scythe stroke can repaint exactly the tiles
   * it cut without walking the whole field.
   *
   * Only tiles inside a grown chunk are in here. A tile the camera has never
   * visited has no sprite and needs none -- `mown` is the state, this is only
   * the picture of it.
   */
  private grassTiles = new Map<string, Phaser.GameObjects.Image>();

  /**
   * When each meadow tile was last cut, by tile key. The one piece of world
   * state the player owns, and it is deliberately client-side and unsaved:
   * cutting grass moves no Bushels, so there is nothing here worth a server
   * round trip, a rate limit or a row. It resets on reload, which is the
   * honest cost of that choice.
   */
  private mown = new Map<string, number>();
  /** Wall-clock of the last regrowth sweep, so the field is refreshed a few
   *  times a minute rather than every frame. */
  private lastRegrow = 0;

  /** The districts' animals: the oxen in their furrows, the hogs in the mud.
   *  Driven by the same `stepCritter` the owned units use. */
  private herds: HerdSprite[] = [];

  /** The farmhand, and the jobs waiting for him. Null until `create` has run.
   *  `farmhandTask` is the one he has claimed, held out of the queue so a
   *  prune cannot forget the unit he is walking to right now. */
  private farmhand: FarmhandNode | null = null;
  private farmhandQueue: readonly FarmhandTask[] = [];
  private farmhandTask: FarmhandTask | null = null;

  /**
   * Land the player has not cleared (lib/stackacres/sectors.ts).
   *
   * Starts as ALL THREE outer districts, and that default is deliberate. The
   * shell pushes the real answer with `setSectors` as soon as its first read
   * lands, and until then the safe thing to draw is wild ground: painting a
   * pen and then taking it away a frame later is worse than painting a wood
   * and then clearing it, because only one of those two looks like a bug.
   */
  private locked = new Set<ZoneId>(OUTER_ZONE_IDS);

  /**
   * Everything currently standing on one district because of its lock state:
   * either its own ground, fence and furrow work (cleared) or the wild growth
   * and haze over it (locked). Held per district so `setSectors` can tear one
   * down and rebuild it without touching the other three.
   */
  private sectorArt = new Map<ZoneId, Phaser.GameObjects.GameObject[]>();

  /** The pond's surface, built once in paintPond and walked by index in
   *  update() so a frame allocates nothing: the drifting glints, the lily
   *  pads with their resting y beside them, the flowers with the index of
   *  the pad each rides, and the duck. */
  private glints: Phaser.GameObjects.Image[] = [];
  private lilies: Phaser.GameObjects.Image[] = [];
  private lilyBaseY: number[] = [];
  private lilyFlowers: Phaser.GameObjects.Image[] = [];
  private lilyFlowerPad: number[] = [];
  private duck: Phaser.GameObjects.Image | null = null;
  private duckWest = false;
  /** The ripples' looping tweens, removed on shutdown. */
  private pondTweens: Phaser.Tweens.Tween[] = [];

  /** The windmill's sails, turned in update(); still under reduced motion. */
  private blades: Phaser.GameObjects.Image | null = null;

  /** The held tool's own picture, floating over a finger that is mid-mow --
   *  the scythe is the only tool left with a canvas gesture of its own.
   *  Kept the name `toolGhost` (not `mowGhost`): it once also floated over a
   *  plot-sweep drag, and that gesture is gone, this is what is left of it. */
  private toolGhost: Phaser.GameObjects.Image | null = null;
  private toolGhostTween: Phaser.Tweens.Tween | null = null;
  private toolIconName: PainterName = "ico-look";
  /** The held tool. Only the scythe changes what a gesture MEANS here; every
   *  other tool does nothing on the canvas at all. */
  private tool: StackAcresTool = "inspect";

  /**
   * The camera as of the last frame, so `update` can tell the shell when the
   * view has moved. Watched here rather than fired from each of the half
   * dozen places that move the camera (a drag, a pinch, a wheel, the zoom
   * buttons, "home", travelling to a district, and the inertia that outlives
   * all of them) -- most of those hand off to a tween that keeps moving after
   * the call returns, so the only honest place to notice is the frame.
   */
  private lastView = { x: 0, y: 0, zoom: 0 };

  /**
   * The farm's own display face, read off the host element rather than
   * hardcoded -- `.sa-theme` sets `--sa-font` and the canvas host inherits it,
   * so a label drawn INTO the picture speaks in the same voice as every
   * button pinned over it. next/font mints the family name at build time
   * (see stackacres-font.ts), which is exactly why this cannot be a literal.
   * Read once, on first use: it never changes for the life of a scene.
   */
  private displayFont: string | null = null;

  constructor(callbacks: StackAcresSceneCallbacks, options: StackAcresSceneOptions) {
    super({ key: "StackAcresScene" });
    this.callbacks = callbacks;
    this.options = options;
  }

  /** The only files StackAcres fetches: the four generated sprites (see
   *  stackacres-sprites.ts). Everything else is still drawn at boot. Loading
   *  them here rather than letting the painters pick them up asynchronously
   *  is what stops the world baking a cow, then a different cow a moment
   *  later -- Phaser guarantees `preload` finishes before `create`. A file
   *  that fails to load is not fatal: `bakeArt` paints the drawn version. */
  preload(): void {
    for (const name of SPRITE_NAMES) {
      this.load.image(spriteLoadKey(name), SPRITE_ART[name]);
    }
  }

  create(): void {
    // Every texture is drawn here, at boot. Most icons are still painted
    // straight into DOM canvases by stackacres-icon.tsx and never need a
    // Phaser texture -- but the toolbelt set also has to exist here, as the
    // picture `toolGhost` floats over a finger mid-mow, so all of PAINTERS
    // is baked now. The image sprites are baked from what `preload`
    // fetched; everything else from its painter.
    for (const name of Object.keys(PAINTERS) as PainterName[]) {
      bakeArt(this, name);
    }
    bakeGrass(this);

    // Depth is the world y of a thing's feet, so it can go far negative north
    // of the farm: the grass has to sit below anything the player can roam to.
    this.grass = this.add.tileSprite(0, 0, 100, 100, "grass").setOrigin(0).setDepth(-1e9);
    this.grass.tileScaleX = 1 / GRASS_PX;
    this.grass.tileScaleY = 1 / GRASS_PX;

    // The world's own hard edge, set before anything else about its shape:
    // every later camera move (drag, glide, pinch-zoom, focusZone, the
    // opening homeView() itself) is already written in this same projected
    // screen space, so none of them need to know bounds exist -- Phaser
    // clamps scrollX/scrollY against this rect on every frame regardless of
    // which of them moved the camera there.
    const bounds = worldBoundsScreenRect();
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    this.worldBounds = bounds;

    // Districts before paths: a road is laid on a field, and the ground the
    // road runs over has to exist underneath it.
    this.paintPaths();
    this.paintPond();
    this.paintBarn();
    this.paintProps();
    this.spawnHerds();
    this.spawnFarmhandNode();
    // Each district's own layer, which is either its farm (ground, fence,
    // grow area) or the wild growth standing where that farm is not built
    // yet. Rebuilt per district by `setSectors` when land is cleared.
    for (const id of ZONE_IDS) this.paintSector(id);

    this.toolGhost = this.add
      .image(0, 0, this.toolIconName, ART_FRAME)
      .setOrigin(0.5, 1)
      .setScale(1.5 / S)
      .setDepth(9001)
      .setVisible(false);
    // Pinned to the screen, not the world, and above every world object
    // (the DOM chrome is a separate layer entirely, so nothing of the
    // player's is under it). Sized to the camera in update().
    this.vignette = this.add
      .image(0, 0, bakeVignette(this))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1e9);

    this.buildSunlight();

    // The "you've gone far enough" nudges -- same screen-pinned treatment as
    // the vignette, one above it (a higher depth) so they read against its
    // darkened corners. Built invisible; `fitEdgeGuides()` (called every
    // frame alongside `fitVignette()`) is what fades each one in as the view
    // nears that edge of `worldBounds` and positions/sizes them for the
    // current zoom.
    const edgeGuide = () =>
      this.add.image(0, 0, "edgeArrow", ART_FRAME).setOrigin(0.5).setScrollFactor(0).setDepth(2e9).setAlpha(0);
    this.edgeGuides = {
      n: edgeGuide().setRotation(Math.PI / 2),
      e: edgeGuide().setRotation(Math.PI),
      s: edgeGuide().setRotation(-Math.PI / 2),
      w: edgeGuide().setRotation(0),
    };

    this.bindInput();

    this.created = true;
    if (this.pending) {
      const units = this.pending;
      this.pending = null;
      this.setUnits(units);
    }
  }


  /**
   * The scene-space depth key for a world point: the projected y, which is
   * monotonic in (worldX + worldY) by construction (see iso.ts), so it is
   * the correct isometric near/far ordering and not just a stand-in for one.
   * `nudge` is a small scene-space tie-breaker for two things anchored at
   * the same point -- it is added AFTER projection, never before, because a
   * tie-break has no direction in world space to be projected from.
   */
  private depthAt(x: number, y: number, nudge = 0): number {
    return isoProject(x, y).y + nudge;
  }

  /** One painter, placed at a world-space anchor (projected here, the one
   *  place callers do not have to think about it) and sorted by the ground
   *  it stands on. Everything in the world goes through here. */
  private put(name: PainterName, x: number, y: number, depth?: number): Phaser.GameObjects.Image {
    const p = PAINTERS[name];
    const s = isoProject(x, y);
    return this.add
      .image(s.x, s.y, name, ART_FRAME)
      .setOrigin(p.ax, p.ay)
      .setScale(1 / S)
      .setDepth(depth ?? s.y);
  }

  /* ---------------------------------------------------------------- */
  /* The districts                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Each outer district's ground, as one Graphics object of projected
   * diamonds (lib/stackacres/zones.ts's `zoneGroundTiles`).
   *
   * Graphics rather than a baked texture, deliberately. A district is
   * hundreds of units across, and a baked rectangle laid on a diamond grid
   * is the exact thing that still reads wrong about the path and pond bakes
   * -- at a plot's size it passes, at a district's it would be the most
   * obvious object on the map. Diamonds cost three draw calls in total and
   * are correct under the tilt by construction.
   *
   * Painted per district, and repainted only when that district's lock state
   * changes: the districts do not move, and the whole set is a few hundred
   * fills. Returns null for a district that paints no ground of its own (the
   * Farmstead, whose `cover` is 0 -- see `ZoneGround`).
   */
  private paintZoneGround(id: ZoneId): Phaser.GameObjects.Graphics | null {
    const tiles = zoneGroundTiles(id);
    if (tiles.length === 0) return null;
    const g = this.add.graphics().setDepth(ZONE_GROUND_DEPTH);
    for (const tile of tiles) {
      // Exactly the tile's own size, NOT a hair over. Overlapping these was
      // the first cut and it was visibly wrong: they are translucent, so
      // every overlap composited twice and the district ended up drawn with
      // a lighter lattice over it -- the tile grid made visible by the very
      // thing meant to hide its seams. Abutting diamonds share an edge
      // exactly, and the anti-aliased seam that leaves is invisible next to
      // the doubled alpha it replaces.
      const c = projectedCorners({
        x: tile.x,
        y: tile.y,
        width: tile.size,
        height: tile.size,
      });
      g.fillStyle(tile.colour, tile.alpha);
      g.beginPath();
      g.moveTo(c.n.x, c.n.y);
      g.lineTo(c.e.x, c.e.y);
      g.lineTo(c.s.x, c.s.y);
      g.lineTo(c.w.x, c.w.y);
      g.closePath();
      g.fillPath();
    }
    return g;
  }

  /**
   * The districts' animals, placed once at boot rather than grown with the
   * chunks around them.
   *
   * Nine sprites in all, and they carry walk state that a prune would throw
   * away -- an ox that resets to a fresh spawn every time the camera looks
   * away is an ox that teleports. They are cheap enough to simply always
   * exist, and Phaser culls what is off camera anyway.
   */
  private spawnHerds(): void {
    for (const id of OUTER_ZONE_IDS) {
      const herd = zoneHerd(id);
      if (!herd) continue;
      const art: PainterName = herd.art;
      const random = seededRandom(id.length * 7919 + herd.count * 31 + 5);
      for (let i = 0; i < herd.count; i += 1) {
        const state = spawnCritter(herd.range, random);
        const shadow = this.put("shadow", state.x, state.y + 1, 0).setAlpha(0.75);
        shadow.setScale((herd.art === "ox" ? 0.85 : 0.55) / S, (herd.art === "ox" ? 0.5 : 0.4) / S);
        const sprite = this.put(art, state.x, state.y, 0);
        this.herds.push({ sprite, shadow, art, state, gait: spawnGait(random() * Math.PI * 2) });
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* The farmhand                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * The one man on the map, standing at his post from boot.
   *
   * Built like a `UnitNode` and not like a herd animal, for one reason: his
   * sprite's scale is rewritten every frame by `walkFarmhand` for the facing
   * mirror, so position, depth and the shadow have to live somewhere that line
   * cannot reach. That is the container. The shadow is a fixed local child at
   * world (0, 1), set once here and never moved, exactly as `buildUnit` does
   * it -- which keeps it planted on the grass under him.
   *
   * Child order is load-bearing: shadow, then legs, then torso. The torso has
   * to be painted OVER the tops of the legs so the hip joints disappear under
   * the overalls instead of showing as two rotating stubs.
   */
  private spawnFarmhandNode(): void {
    const state = spawnFarmhand();
    const container = this.add.container(0, 0);
    // The same pool Ray casts. He is the same build, and a second set of
    // numbers here would be a second set of numbers to drift.
    const pool = PROP_SHADOW.grandfatherRay;
    const shadow = this.addLocal("shadow", 0, 1, container)
      .setScale(pool.w / 33 / S, pool.h / 13 / S)
      .setAlpha(0.8);
    const legs = this.add.graphics();
    container.add(legs);
    const art: PainterName = "farmhand";
    const sprite = this.addLocal(art, 0, 0, container);
    // The painter's anchor is the hip midpoint (its x) on the cut line (its
    // y), so this one offset is the whole placement: put the pelvis where the
    // pelvis goes. Straight up the SCREEN, never through the projection -- a
    // vertical offset has no ground-plane direction to be sheared along, same
    // reasoning as `WINDMILL_HUB`.
    sprite.setY(-FARMHAND_HIP_Y);
    const screen = isoProject(state.x, state.y);
    container.setPosition(screen.x, screen.y);
    container.setDepth(this.depthAt(state.x, state.y));
    this.farmhand = { container, sprite, legs, shadow, art, state, walk: spawnWalk() };
  }

  /**
   * Both legs, from the hip down, for one frame.
   *
   * Drawn rather than tweened, and drawn from scratch each frame rather than
   * rotated as pieces: two bones plus a boot is four strokes a leg, and a
   * Graphics redraw of eight short capsules costs less than the bookkeeping
   * of eight game objects whose rotations have to compose. `mirror` flips the
   * whole rig in x so the legs turn with the torso above them, since the
   * sprite's own mirror is a scale on the image and cannot reach a sibling.
   */
  private drawFarmhandLegs(node: FarmhandNode, mirror: 1 | -1): void {
    const g = node.legs;
    const limbs = FARMHAND_LIMBS[node.art] ?? FARMHAND_LIMBS.farmhand;
    const hipY = -(FARMHAND_HIP_Y + node.walk.rise);
    g.clear();

    // Far leg first and a shade darker, so the near one reads as nearer -- the
    // same trick the painters use for the far arm.
    for (const i of [1, 0] as const) {
      const far = i === 1;
      const hipX = mirror * (far ? -1.25 : 1.25);
      const leg = legJoints(hipX, mirror * node.walk.hips[i], node.walk.knees[i]);
      const denim = far ? Phaser.Display.Color.ValueToColor(limbs.denim).darken(14).color : limbs.denim;
      const boot = far ? Phaser.Display.Color.ValueToColor(limbs.boot).darken(14).color : limbs.boot;

      g.lineStyle(4.1, denim, 1);
      g.beginPath();
      g.moveTo(leg.hip.x, hipY + leg.hip.y);
      g.lineTo(leg.knee.x, hipY + leg.knee.y);
      g.strokePath();

      g.lineStyle(3.5, denim, 1);
      g.beginPath();
      g.moveTo(leg.knee.x, hipY + leg.knee.y);
      g.lineTo(leg.ankle.x, hipY + leg.ankle.y);
      g.strokePath();

      // The boot: down the shin's own line to the sole, then a toe stub in the
      // direction he is facing, which is what stops a bare stroke end reading
      // as an amputation at this size.
      const sole = {
        x: leg.ankle.x + leg.toe.x * FARMHAND_BOOT,
        y: hipY + leg.ankle.y + leg.toe.y * FARMHAND_BOOT,
      };
      g.lineStyle(4.2, boot, 1);
      g.beginPath();
      g.moveTo(leg.ankle.x, hipY + leg.ankle.y);
      g.lineTo(sole.x, sole.y);
      g.strokePath();
      g.fillStyle(boot, 1);
      g.fillCircle(sole.x + mirror * 1.25, sole.y, 2.05);
    }
  }

  /**
   * Send the farmhand to a unit, if he is the right man for it.
   *
   * Called on a tap that was ACCEPTED, after the request has already left the
   * browser -- see `onWorldUnitTap` in stackacres-farm.tsx. He is decoration
   * on a write that has already happened, so everything here is allowed to
   * refuse silently: a full queue, a unit in another district, a unit that
   * has since gone. None of those can cost the player anything.
   *
   * FARMSTEAD ONLY. The four districts are hundreds of units apart, so a job
   * out at Ox Fields or the Wallow would be most of a minute of watching a
   * man cross a field -- and the camera is usually not even pointed at him
   * while he does it.
   */
  sendFarmhand(unitId: string): void {
    const node = this.nodes.get(unitId);
    if (!node || stockZone(node.unit.stock) !== "farmstead") return;
    // Already on it, or already holding it: `enqueueFarmhandTask` dedupes the
    // queue, and this covers the one it cannot see.
    if (this.farmhandTask?.unitId === unitId) return;
    const at = farmhandStandoff(this.unitWorldSpot(node));
    this.farmhandQueue = enqueueFarmhandTask(this.farmhandQueue, { unitId, x: at.x, y: at.y });
  }

  /** A job's target, re-read this frame: livestock keeps wandering while he
   *  crosses the yard, so he chases where the hen IS rather than where it was
   *  standing when the finger landed. Null once the unit has gone. */
  private freshenFarmhandTask(task: FarmhandTask): FarmhandTask | null {
    const node = this.nodes.get(task.unitId);
    if (!node) return null;
    const at = farmhandStandoff(this.unitWorldSpot(node));
    return { unitId: task.unitId, x: at.x, y: at.y };
  }

  /** One frame of the farmhand's day. Stepped from `update` alongside the
   *  herds, which puts it inside the reduced-motion gate: with motion off he
   *  simply stands at his post. */
  private walkFarmhand(delta: number): void {
    const node = this.farmhand;
    if (!node) return;

    // Jobs whose unit has gone -- collected, cleared, or refetched away.
    this.farmhandQueue = pruneFarmhandTasks(this.farmhandQueue, (id) => this.nodes.has(id));
    const claimed = this.farmhandTask ? this.freshenFarmhandTask(this.farmhandTask) : null;
    if (this.farmhandTask && !claimed) this.farmhandTask = null;

    const head = this.farmhandQueue[0];
    const next = claimed ?? (head ? this.freshenFarmhandTask(head) : null);
    const step = stepFarmhand(node.state, next, delta);
    if (step.claimed) {
      this.farmhandTask = head ?? null;
      this.farmhandQueue = this.farmhandQueue.slice(1);
    }
    if (step.finished) this.farmhandTask = null;
    node.state = step.hand;

    const walking = farmhandWalking(node.state);
    node.walk = stepWalk(node.walk, walking, FARMHAND_SPEED, delta);

    // Toward the camera or away from it is a different PICTURE, not a flip:
    // see the pair of painters in art-props.ts.
    const art: PainterName = node.state.towards === 1 ? "farmhand" : "farmhandBack";
    if (art !== node.art) {
      const p = PAINTERS[art];
      node.sprite.setTexture(art, ART_FRAME).setOrigin(p.ax, p.ay);
      node.art = art;
    }

    const at = isoProject(node.state.x, node.state.y);
    node.container.setPosition(at.x, at.y);
    node.container.setDepth(this.depthAt(node.state.x, node.state.y));
    const mirror = mirrorFor(art, node.state.facing);
    node.sprite.setScale(mirror / S, 1 / S);
    // The torso rides the hips, so the walk's own rise lifts it -- and the
    // legs are solved from the same point, which is what keeps the stance
    // foot on the grass while it happens. Straight up the SCREEN, never
    // through the projection (see `spawnFarmhandNode`).
    node.sprite.setY(-(FARMHAND_HIP_Y + node.walk.rise));
    this.drawFarmhandLegs(node, mirror);
  }

  /**
   * The dirt paths, as ground art just above the grass: lane, road, track,
   * in that order. Phaser's depth sort is stable, so three images at one
   * depth draw in creation order, and each path after the first repaints
   * the junction it shares with an earlier one (see bakePathTexture), which
   * only works if the earlier one is underneath.
   */
  // The baked texture is drawn directly in projected (sheared) space now --
  // see bakePathTexture's own header -- so `bake.x`/`bake.y` are already
  // screen-space coordinates, the same space isoProject's own output lives
  // in. No isoProject call here: doing that would project an already-
  // projected point a second time.
  private paintPaths(): void {
    FARM_PATHS.forEach((spec, i) => {
      const bake = bakePathTexture(this, spec, FARM_PATHS.slice(0, i));
      if (!bake) return;
      this.add
        .image(bake.x, bake.y, bake.key, ART_FRAME)
        .setOrigin(0)
        .setScale(1 / GRASS_PX)
        .setDepth(PATH_DEPTH);
    });
  }

  /**
   * The pond on the west verge: the water and its sand as ground art just
   * above the paths (so the shore paints over the spur's end cap), then the
   * dock, the reeds and the lily pads sorted by their feet like everything
   * else. The surface is a handful of sprites -- glints, ripples, a duck --
   * kept in plain arrays for update() to move.
   */
  private paintPond(): void {
    const bake = bakePondTexture(this);
    if (bake) {
      // The paths were carrying this same trade-off until they were moved to
      // a sheared bake (see art-paths.ts's bakePathTexture); the pond's own
      // shore texture is still the flat top-down bake that leaves, only its
      // anchor projected -- the same follow-up applies here, not done yet.
      const s = isoProject(bake.x, bake.y);
      this.add
        .image(s.x, s.y, bake.key, ART_FRAME)
        .setOrigin(0)
        .setScale(1 / GRASS_PX)
        .setDepth(POND_DEPTH);
    }
    const still = this.options.reducedMotion;

    // Sun on the water. Five drift east to west across the sun side; under
    // reduced motion they simply lie there, each at a different point of its
    // run (all five at mid-run stack into one dotted column).
    for (let i = 0; i < GLINT_COUNT; i += 1) {
      this.glints.push(this.put("glint", 0, 0, POND_SURFACE_DEPTH));
      this.placeGlint(i, 0.28 + i * 0.11);
    }
    // Ripples spread and fade on a loop. None at all when motion is reduced.
    if (!still) {
      RIPPLE_SPOTS.forEach((spot, i) => {
        // Scales are in the painter's own unit (1 / S), the way pokePlot's
        // squash is: a bare 0.4 would be three times the painted size.
        const ripple = this.put("ripple", spot.x, spot.y, POND_SURFACE_DEPTH)
          .setScale(0.35 / S)
          .setAlpha(0.45);
        this.pondTweens.push(
          this.tweens.add({
            targets: ripple,
            scaleX: 1.1 / S,
            scaleY: 1.1 / S,
            alpha: 0,
            duration: 2_600,
            delay: i * 870,
            repeat: -1,
            ease: "Sine.easeOut",
          }),
        );
      });
    }
    // The duck's depth is fixed at the bottom of its loop rather than set
    // every frame; nothing else floats inside the loop.
    this.duck = this.put(
      "duck",
      DUCK_ORBIT.x + DUCK_ORBIT.rx,
      DUCK_ORBIT.y,
      this.depthAt(DUCK_ORBIT.x, DUCK_ORBIT.y + DUCK_ORBIT.ry, 1),
    );

    this.put("dock", DOCK.x, DOCK.y, this.depthAt(DOCK.x, DOCK.y));
    for (const reed of REEDS) {
      this.put("shadow", reed.x, reed.y + 1, this.depthAt(reed.x, reed.y, -0.5))
        .setScale(0.4 / S, 0.5 / S)
        .setAlpha(0.7);
      this.put("reeds", reed.x, reed.y, this.depthAt(reed.x, reed.y));
    }
    LILY_PADS.forEach((pad, i) => {
      this.lilies.push(this.put("lily", pad.x, pad.y, this.depthAt(pad.x, pad.y)));
      this.lilyBaseY.push(pad.y);
      if (pad.flower) {
        this.lilyFlowers.push(
          this.put("lilyFlower", pad.x - 0.8, pad.y - 1.4, this.depthAt(pad.x, pad.y, 0.1)),
        );
        this.lilyFlowerPad.push(i);
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.releasePond, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.releasePond, this);
  }

  private releasePond(): void {
    for (const tween of this.pondTweens) tween.remove();
    this.pondTweens = [];
  }

  /**
   * Where glint `i` is at fraction `p` of its run: a chord across the sun
   * side of the water, east to west, on a shallow sine, fading in and out
   * at the ends so a run never pops. Computed in world space, projected once
   * at the end -- everything upstream of the final `isoProject` here is the
   * same world-space ellipse math the flat camera used.
   */
  private placeGlint(i: number, p: number): void {
    const glint = this.glints[i];
    const y = POND.y - 32 + i * 8 + Math.sin(p * Math.PI * 3 + i) * 1.5;
    const dy = (y - POND.y) / POND.ry;
    const half = POND.rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    const world = isoProject(POND.x + half * (0.3 - 1.1 * p), y);
    glint.setPosition(world.x, world.y);
    glint.setAlpha(Math.sin(p * Math.PI) ** 2 * 0.85);
  }

  /** Sun drifting across the water, pads bobbing, the duck on its loop.
   *  Indexed loops over arrays built once: nothing here allocates. All of it
   *  is world-space math, same as the flat camera had, projected only at the
   *  point each sprite's position is actually set. */
  private animatePond(time: number): void {
    for (let i = 0; i < this.glints.length; i += 1) {
      this.placeGlint(i, (time * 0.00004 + i * 0.2) % 1);
    }
    for (let i = 0; i < this.lilies.length; i += 1) {
      const worldY = this.lilyBaseY[i] + Math.sin(time * 0.0012 + i * 1.3) * 0.4;
      const s = isoProject(LILY_PADS[i].x, worldY);
      this.lilies[i].setPosition(s.x, s.y);
    }
    for (let j = 0; j < this.lilyFlowers.length; j += 1) {
      const padIndex = this.lilyFlowerPad[j];
      const worldY = this.lilyBaseY[padIndex] + Math.sin(time * 0.0012 + padIndex * 1.3) * 0.4 - 1.4;
      const s = isoProject(LILY_PADS[padIndex].x - 0.8, worldY);
      this.lilyFlowers[j].setPosition(s.x, s.y);
    }
    const duck = this.duck;
    if (duck) {
      const t = time * 0.00022;
      const worldX = DUCK_ORBIT.x + Math.cos(t) * DUCK_ORBIT.rx;
      const worldY = DUCK_ORBIT.y + Math.sin(t) * DUCK_ORBIT.ry + Math.sin(time * 0.003) * 0.3;
      const s = isoProject(worldX, worldY);
      duck.setPosition(s.x, s.y);
      // Heading west while x is falling; the art faces east.
      const west = Math.sin(t) > 0;
      if (west !== this.duckWest) {
        this.duckWest = west;
        duck.setFlipX(west);
      }
    }
  }

  /**
   * A footprint's four corners, isometrically projected and raised by
   * `wallH` -- the shared shape every volumetric structure below (the barn,
   * the silo, the windmill tower) is built from. `cx`/`cy` are the
   * footprint's own world-space centre, `w`/`h` its world-space size.
   */
  private isoFootprint(cx: number, cy: number, w: number, h: number): DiamondCorners {
    return projectedCorners({ x: cx - w / 2, y: cy - h / 2, width: w, height: h });
  }

  /**
   * The two visible walls of an isometric box: the near-left face (between
   * the W and S footprint corners) and the near-right face (S and E). The
   * far two faces are never drawn -- they are permanently behind the
   * building, the same reason a flat top-down icon never drew a back wall
   * either. Returns the raised top plate for a roof to sit on.
   */
  private drawIsoWalls(
    g: Phaser.GameObjects.Graphics,
    footprint: DiamondCorners,
    wallH: number,
    wallColor: number,
  ): DiamondCorners {
    const lift = (p: WorldPoint): WorldPoint => ({ x: p.x, y: p.y - wallH });
    const top: DiamondCorners = {
      n: lift(footprint.n),
      e: lift(footprint.e),
      s: lift(footprint.s),
      w: lift(footprint.w),
    };
    const quad = (a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint, color: number): void => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineTo(c.x, c.y);
      g.lineTo(d.x, d.y);
      g.closePath();
      g.fillPath();
    };
    quad(footprint.w, footprint.s, top.s, top.w, shadeColor(wallColor, -30));
    quad(footprint.s, footprint.e, top.e, top.s, shadeColor(wallColor, -68));
    return top;
  }

  /** A flat roof plate: the top face lit brightest (it faces the one sun
   *  most directly of anything on the building), edged in its own shadow. */
  private drawIsoFlatRoof(g: Phaser.GameObjects.Graphics, top: DiamondCorners, roofColor: number): void {
    g.fillStyle(shadeColor(roofColor, 18), 1);
    g.beginPath();
    g.moveTo(top.n.x, top.n.y);
    g.lineTo(top.e.x, top.e.y);
    g.lineTo(top.s.x, top.s.y);
    g.lineTo(top.w.x, top.w.y);
    g.closePath();
    g.fillPath();
    g.lineStyle(1.4, shadeColor(roofColor, -30), 1);
    g.strokePath();
  }

  /** A gable roof over an isometric box: two ridge-facing slopes and two
   *  gable-end slopes, each its own tone off the one sun, same shape as the
   *  camera-preview mockup this pass was built against. */
  private drawIsoGableRoof(
    g: Phaser.GameObjects.Graphics,
    top: DiamondCorners,
    ridgeH: number,
    roofColor: number,
  ): void {
    const mid1: WorldPoint = { x: (top.n.x + top.e.x) / 2, y: (top.n.y + top.e.y) / 2 - ridgeH };
    const mid2: WorldPoint = { x: (top.w.x + top.s.x) / 2, y: (top.w.y + top.s.y) / 2 - ridgeH };
    const face = (pts: readonly WorldPoint[], color: number): void => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
    };
    face([top.n, top.e, mid1], shadeColor(roofColor, 14));
    face([top.e, top.s, mid2, mid1], shadeColor(roofColor, -18));
    face([top.s, top.w, mid2], shadeColor(roofColor, -34));
    face([top.w, top.n, mid1, mid2], shadeColor(roofColor, 2));
    g.lineStyle(1.6, shadeColor(roofColor, 34), 1);
    g.beginPath();
    g.moveTo(mid1.x, mid1.y);
    g.lineTo(mid2.x, mid2.y);
    g.strokePath();
  }

  /**
   * A barn, a silo and some clutter in the margin above the first row, so the
   * farm has a home rather than a top-left corner. It is the one fixed
   * landmark out here: the opening shot frames it along with the plots.
   *
   * The barn is the generated sprite (`PAINTERS.barn`, a straight-on
   * elevation) placed flat, the same `put()` every yard prop already uses
   * in this isometric world -- Kayo's call, over the earlier isometric-
   * volume treatment this function used to draw by hand: it is a known,
   * accepted tradeoff pending a proper isometric repaint of the sprite kit.
   * The silo has no generated art of its own, so it stays a hand-drawn
   * isometric volume, matching the mockup this pass was previewed against.
   */
  private paintBarn(): void {
    this.put("shadow", BARN_X, BARN_Y + 1, this.depthAt(BARN_X, BARN_Y, -100))
      .setScale(3.4 / S, 1.6 / S)
      .setAlpha(0.9);

    // Same depth nudge the combined structure used before the barn became a
    // flat sprite, so it keeps sorting against nearby world objects the way
    // the approved mockup did.
    this.put("barn", BARN_X, BARN_Y, this.depthAt(BARN_X, BARN_Y + 17));

    // Silo: a plain cylinder-ish box (no gable) with a shallow domed cap,
    // standing where the flat barn's own silo painter used to.
    const g = this.add.graphics().setDepth(this.depthAt(BARN_X, BARN_Y + 17));
    const mix = (a: WorldPoint, b: WorldPoint, k: number): WorldPoint => ({
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
    });
    const siloCentre = { x: BARN_X + 40, y: BARN_Y - 4 };
    const siloFootprint = this.isoFootprint(siloCentre.x, siloCentre.y, 20, 20);
    const siloTop = this.drawIsoWalls(g, siloFootprint, 50, rampHex("metal").side);
    const capCentre = mix(siloTop.n, siloTop.s, 0.5);
    const capRx = Math.abs(siloTop.e.x - siloTop.w.x) / 2;
    const capRy = Math.abs(siloTop.s.y - siloTop.n.y) / 2;
    g.fillStyle(rampHex("metal").top, 1);
    g.fillEllipse(capCentre.x, capCentre.y, capRx * 2, Math.max(capRy * 2, 6));
    g.lineStyle(1.2, rampHex("metal").rim, 1);
    g.strokeEllipse(capCentre.x, capCentre.y, capRx * 2, Math.max(capRy * 2, 6));
    g.fillStyle(rampHex("roof").top, 1);
    g.beginPath();
    g.moveTo(siloTop.w.x, siloTop.w.y);
    g.lineTo(siloTop.n.x, siloTop.n.y);
    g.lineTo(siloTop.e.x, siloTop.e.y);
    g.lineTo(capCentre.x, capCentre.y - 16);
    g.closePath();
    g.fillPath();

    this.put("hay", BARN_X + 58, BARN_Y - 11, this.depthAt(BARN_X, BARN_Y, 0.5));
    this.put("hay", BARN_X + 66, BARN_Y - 11, this.depthAt(BARN_X, BARN_Y, 0.6));
    this.put("barrel", BARN_X - 48, BARN_Y - 14, this.depthAt(BARN_X - 48, BARN_Y - 14));
  }

  /**
   * The yard's fixed props and the lamps down the lane (lib/stackacres/
   * props.ts), each on a soft ground shadow and sorted by its feet like
   * everything else. The windmill still routes through its own method (see
   * `paintWindmill`) because its blades need pinning on top of the tower --
   * not because the tower itself is drawn any differently: it is
   * `PAINTERS.windmill`, the generated sprite, placed flat like every other
   * prop here.
   */
  private paintProps(): void {
    for (const prop of YARD_PROPS) {
      const pool = PROP_SHADOW[prop.kind];
      // The shadow painter's pool is 33 by 13 units at scale 1.
      this.put("shadow", prop.x, prop.y + 1, this.depthAt(prop.x, prop.y, -0.5))
        .setScale(pool.w / 33 / S, pool.h / 13 / S)
        .setAlpha(0.8);
      if (prop.kind === "windmill") {
        this.paintWindmill(prop.x, prop.y);
        continue;
      }
      this.put(prop.kind, prop.x, prop.y, this.depthAt(prop.x, prop.y));
    }
  }

  /**
   * The windmill tower, placed flat like any other prop, plus the existing
   * baked `windmillBlades` sprite pinned to its cap so update()'s per-frame
   * rotation still just works. The pin uses `WINDMILL_HUB` -- an offset from
   * the tower's own feet, added directly to the tower's already-projected
   * screen point rather than fed through `isoProject` a second time, because
   * a vertical offset in screen terms would be dragged sideways by shearing
   * it the way a ground-plane offset needs to (see the class doc's note on
   * the three coordinate systems).
   */
  private paintWindmill(x: number, y: number): void {
    this.put("windmill", x, y, this.depthAt(x, y, 0.4));
    const s = isoProject(x, y);
    const bladeFrame = PAINTERS.windmillBlades;
    this.blades = this.add
      .image(s.x + WINDMILL_HUB.x, s.y + WINDMILL_HUB.y, "windmillBlades", ART_FRAME)
      .setOrigin(bladeFrame.ax, bladeFrame.ay)
      .setScale(1 / S)
      .setDepth(this.depthAt(x, y, 0.5));
  }


  /* ---------------------------------------------------------------- */
  /* Units                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * One owned animal or crop's world node, replacing the old per-plot
   * `buildCell`/`CellNode` pair now that a unit has no plot underneath it
   * (see lib/stackacres/units.ts's own header). A district's grow area
   * itself -- its ground and, for livestock, its fence -- is drawn ONCE per
   * district at boot (`paintDistrictBoundary`, called from `create()`), not
   * per unit: there is no fixed number of "slots" to draw empty or waiting
   * any more, only exactly `units.length` pictures, one each, standing in
   * whichever district `stockZone` says they belong in.
   */
  setUnits(units: StackAcresSceneUnit[]): void {
    if (!this.created) {
      this.pending = units;
      return;
    }
    this.units = units;
    const seen = new Set<string>();
    for (const unit of units) {
      seen.add(unit.id);
      const signature = signatureOf(unit);
      const existing = this.nodes.get(unit.id);
      if (existing && existing.signature === signature) {
        existing.unit = unit;
        continue;
      }
      this.buildUnit(unit, signature, existing);
    }
    // A unit that is no longer in the list -- collected and consumed, or
    // retired -- has nothing left to draw. `units` above only ever touches
    // ids that ARE still owned, so anything left unseen here is gone.
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      this.destroyNode(node);
      this.nodes.delete(id);
    }

    if (!this.opened) {
      this.opened = true;
      this.openCamera();
      this.callbacks.onReady();
    }
  }

  /** A world-space child of `container`, positioned and scaled the way every
   *  painter placement in this file is -- projected once here so callers
   *  hand over plain world-space numbers, same as the rest of the scene. */
  private addLocal(
    name: PainterName,
    x: number,
    y: number,
    container: Phaser.GameObjects.Container,
  ): Phaser.GameObjects.Image {
    const p = PAINTERS[name];
    const s = isoProject(x, y);
    const image = this.add
      .image(s.x, s.y, name, ART_FRAME)
      .setOrigin(p.ax, p.ay)
      .setScale(1 / S);
    container.add(image);
    return image;
  }

  /**
   * A unit's own fixed spot: a crop's `cropSpot`, or -- new here -- where a
   * MUCKED unit stands, livestock or crop. Muck stops an animal wandering
   * the same way it stops a crop growing, so both settle at the same kind of
   * deterministic point a crop already uses; there is nothing left about a
   * mucked unit's own kind that needs representing once it has stopped.
   */
  private staticSpotFor(unit: StackAcresSceneUnit): WorldPoint {
    return cropSpot(stockZone(unit.stock), unit.id);
  }

  private buildUnit(unit: StackAcresSceneUnit, signature: string, previous: UnitNode | undefined): void {
    const zone = stockZone(unit.stock);
    // An animal survives a repaint of its own picture (a ring changing, a
    // clock tick crossing a growth stage) so it does not jump to a fresh
    // spawn point every time its state changes -- the same carry-over
    // `buildCell` used to give a pen's animals, just one critter instead of
    // several sharing a pen.
    const carriedCritter = previous?.critter ?? null;
    const carriedGait = previous?.gait ?? null;
    if (previous) this.destroyNode(previous);

    const container = this.add.container(0, 0);
    let sprite: Phaser.GameObjects.Image;
    let critter: Critter | null = null;

    if (unit.state === "mucked") {
      // A mess to clear, not something with legs -- livestock or crop, a
      // mucked unit stands at the same kind of fixed spot a crop always
      // uses and stops doing whatever it was doing.
      const at = this.staticSpotFor(unit);
      this.addLocal("puddle", -3, 6, container);
      this.addLocal("rock", -9, -3, container);
      sprite = this.addLocal("stump", 5, -2, container);
      const screen = isoProject(at.x, at.y);
      container.setPosition(screen.x, screen.y);
      container.setDepth(this.depthAt(at.x, at.y));
    } else if (isLivestock(unit.stock)) {
      const art = STOCK_ART[unit.stock];
      critter = carriedCritter ?? spawnCritter(growAreaInterior(zone), this.random);
      // Shadow scale mirrors the old per-species pool sizes exactly: cattle
      // widest and shortest, a hen narrowest and tallest.
      const [shadowW, shadowH] =
        art === "cow" ? [0.75, 0.7] : art === "sheep" ? [0.6, 0.6] : [0.45, 0.5];
      // A fixed local offset -- (0, 1) in world units, projected once here --
      // since the container itself already tracks the critter's true ground
      // position every frame (see update()); the shadow never has to move
      // again after this.
      this.addLocal("shadow", 0, 1, container).setScale(shadowW / S, shadowH / S).setAlpha(0.8);
      sprite = this.addLocal(art, 0, 0, container);
      if (unit.state === "hungry") sprite.setTint(0xb9b4ae);
      const screen = isoProject(critter.x, critter.y);
      container.setPosition(screen.x, screen.y);
      container.setDepth(this.depthAt(critter.x, critter.y));
    } else {
      const at = this.staticSpotFor(unit);
      const stage = growthStage(unit.progress, unit.state === "ready");
      // Non-null for every non-livestock kind, which is the branch we are in.
      const crop = cropArtFor(unit.stock) ?? "carrot";
      sprite = this.addLocal(`${crop}${stage}` as PainterName, 0, 0, container);
      // Crops -- and only crops -- are drawn well off the world's own scale,
      // so a ripe row is findable on a phone. `addLocal` has already set the
      // painter's natural 1 / S; this replaces it, and pushes the sprite back
      // down by however much scaling lifted its feet off the soil. Both
      // numbers come from lib/stackacres/crop-visuals.ts, which is where the
      // reasoning and the tests for them live.
      const grown = cropSpriteScale(stage);
      sprite.setScale(grown / S);
      sprite.y += cropGroundOffset(crop, stage);
      // Dry soil reads as a faded plant. The ring says it too, but a ring is
      // a thin outline on a small target and the fill is what carries at a
      // glance.
      sprite.setAlpha(cropSpriteAlpha(unit.state !== "dry"));
      const screen = isoProject(at.x, at.y);
      container.setPosition(screen.x, screen.y);
      container.setDepth(this.depthAt(at.x, at.y));
    }

    const ring = this.add.graphics();
    container.add(ring);

    const phase = this.random() * Math.PI * 2;
    const node: UnitNode = {
      container,
      ring,
      sprite,
      critter,
      phase,
      gait: critter ? (carriedGait ?? spawnGait(phase)) : null,
      tweens: [],
      pop: null,
      signature,
      unit,
    };
    this.paintUnitRing(node, unit);
    if (unit.state === "ready" && !isLivestock(unit.stock)) this.bob(node, [sprite]);
    this.nodes.set(unit.id, node);
  }

  /**
   * Cancels a live pop bounce.
   *
   * `stop()`, and NOT the `remove()` every other tween in this file is taken
   * off with. `pop` is a TweenChain, and TweenChain OVERRIDES `remove` with a
   * different meaning: on a plain Tween it is "take me off the manager", on a
   * chain it is "take this CHILD tween off me". So the no-argument call ran
   * `TweenChain.remove(undefined)` and threw on `undefined.setRemovedState()`,
   * which reached the player as the whole page dying with "a client-side
   * exception has occurred" -- every time a bounce was still running when its
   * unit was tapped again or rebuilt, which is exactly what repeatedly tapping
   * a ready unit to harvest it does. `stop` is on BaseTween, unshadowed: it
   * flags the chain for removal, and a flagged chain writes to its targets no
   * more and never fires `onComplete`.
   */
  private cancelPop(node: UnitNode): void {
    node.pop?.stop();
    node.pop = null;
  }

  private destroyNode(node: UnitNode): void {
    for (const tween of node.tweens) tween.remove();
    this.cancelPop(node);
    node.container.destroy(true);
  }

  /**
   * A district's own grow-area floor and (livestock only) its fence,
   * painted ONCE at boot -- see the "Units" section's own note on why there
   * is no more per-plot fence-merge. Crops (the Long Meadow) get tilled,
   * furrowed soil and no rails, the same as an old field-zoned plot never
   * had a pen fence either; every livestock district gets a full boundary,
   * traced unconditionally on all four sides since a whole-area boundary has
   * no interior seam left to merge away the way four separate 2x2 plots did
   * -- its ground material follows which animal actually lives there
   * (churned dirt for Cattle, trodden mud for Sheep, straw for Hens), the
   * same distinction the plot-grid era's `paintPenGround` drew.
   */
  /* ---------------------------------------------------------------- */
  /* Land, cleared and not                                              */
  /* ---------------------------------------------------------------- */

  /**
   * One district's whole layer, drawn as one thing or the other.
   *
   * CLEARED: the district's own ground wash, its grow-area floor and (for a
   * livestock district) its fence -- the farm, exactly as it was before this
   * feature existed.
   *
   * LOCKED: wild growth and a pale haze, and NOTHING ELSE. No fence, no
   * furrowed floor, no ground wash, no ghosted outline of what could be here
   * -- the farm is not built yet, so there is nothing to grey out. That is
   * the whole visual argument: a locked sector reads as somewhere the player
   * has not been rather than as a control they are not allowed to press, and
   * the only way to find out it is for sale is to tap the trees.
   */
  private paintSector(zone: ZoneId): void {
    this.clearSectorArt(zone);
    const built: Phaser.GameObjects.GameObject[] = [];
    if (this.locked.has(zone)) {
      built.push(...this.paintOvergrowth(zone));
    } else {
      const ground = this.paintZoneGround(zone);
      if (ground) built.push(ground);
      built.push(...this.paintDistrictBoundary(zone));
    }
    this.sectorArt.set(zone, built);
  }

  /** Tears down whatever a district was last drawn as. */
  private clearSectorArt(zone: ZoneId): void {
    const built = this.sectorArt.get(zone);
    if (!built) return;
    for (const object of built) object.destroy();
    this.sectorArt.delete(zone);
  }

  /**
   * What stands on land nobody has cleared: trees, scrub, ground cover, and a
   * haze over the lot.
   *
   * Grown from `sectorOvergrowth`, which deals the whole district in one go
   * rather than per chunk -- see its own note on why. Every piece takes the
   * ordinary feet-based depth, so an animal in a neighbouring cleared
   * district sorts against this growth correctly with nothing special done
   * for it, and the haze sits at the district ground depth underneath
   * everything standing in it.
   */
  private paintOvergrowth(zone: ZoneId): Phaser.GameObjects.GameObject[] {
    const built: Phaser.GameObjects.GameObject[] = [];
    const haze = this.add.graphics().setDepth(ZONE_GROUND_DEPTH);
    const corners = projectedCorners(STACKACRES_ZONES[zone].bounds);
    haze.fillStyle(SECTOR_FOG.colour, SECTOR_FOG.alpha);
    haze.beginPath();
    haze.moveTo(corners.n.x, corners.n.y);
    haze.lineTo(corners.e.x, corners.e.y);
    haze.lineTo(corners.s.x, corners.s.y);
    haze.lineTo(corners.w.x, corners.w.y);
    haze.closePath();
    haze.fillPath();
    built.push(haze);

    for (const item of sectorOvergrowth(zone)) {
      if (castsShadow(item.kind)) {
        const [wide, tall] = sceneryShadowScale(item.kind);
        built.push(
          this.put("shadow", item.x, item.y + 1, this.depthAt(item.x, item.y, -0.5))
            .setScale((wide * item.scale) / S, (tall * item.scale) / S)
            .setAlpha(0.8),
        );
      }
      built.push(
        this.put(item.kind, item.x, item.y, this.depthAt(item.x, item.y)).setScale(item.scale / S),
      );
    }
    return built;
  }

  /**
   * Which land the player may work now.
   *
   * Called by the shell every time a read or an action lands, so it has to be
   * cheap when nothing moved -- and it is: it diffs against what is currently
   * drawn and repaints only the districts whose answer actually changed.
   * Clearing the Long Meadow must not silently rebuild the other three.
   *
   * The grown chunks are thrown away when anything changes, because
   * `growChunk` deals a district's farm furniture (a plough, a trough, a
   * furrow) and that furniture is exactly what must not stand on land nobody
   * has taken on. `tendWorld` regrows what is on screen on the very next
   * frame, so the cost is one frame of empty ground at the moment of a
   * purchase -- which is under the clearing animation anyway.
   */
  setSectors(unlocked: readonly SectorId[]): void {
    // Home is never wild, whatever arrives. Belt and braces against a
    // malformed payload: the one failure this cannot be allowed to have is
    // growing a wood over the player's own barn, which they would have no way
    // to buy back because the Farmstead is not for sale.
    const next = new Set<ZoneId>(
      OUTER_ZONE_IDS.filter((id) => !unlocked.includes(id)),
    );
    const changed = ZONE_IDS.filter((id) => next.has(id) !== this.locked.has(id));
    if (changed.length === 0) return;
    this.locked = next;
    if (!this.created) return;
    for (const id of changed) this.paintSector(id);
    for (const content of this.chunks.values()) {
      for (const item of content.items) item.destroy();
      for (const tile of content.grassKeys) this.grassTiles.delete(tile);
    }
    this.chunks.clear();
  }

  private paintDistrictBoundary(zone: ZoneId): Phaser.GameObjects.GameObject[] {
    const built: Phaser.GameObjects.GameObject[] = [];
    const area = growAreaBounds(zone);
    const livestock = stocksInZone(zone).find((stock) => isLivestock(stock));
    if (!livestock) {
      // No livestock kind here at all -- the Long Meadow's Crop Fields,
      // tilled and furrowed, no fence.
      built.push(...this.paintAreaGround(area, "soil", true));
      return built;
    }
    const ground = livestock === "cattle" ? "soil" : livestock === "pig" ? "muck" : "straw";
    built.push(...this.paintAreaGround(area, ground));

    // Bays sit on the boundary itself now. The old 9-unit inset was headroom
    // for a flat sprite's footprint; a standing bay anchors on the foot of
    // its first post, and `growAreaInterior` already keeps animals 12 units
    // clear of the rail.
    //
    // Each bay takes the ordinary feet-based `put()` depth, so a wandering
    // animal sorts against it on its own -- in front of the near rail,
    // behind the far one. Depth is measured at the bay's midpoint, not its
    // anchor post: a bay spans half a tile of screen depth, and sorting it
    // by one end tips every animal beside it the same way.
    const step = FENCE_BAY;
    const east = area.x + area.width;
    const south = area.y + area.height;
    const half = step / 2;
    // The one gate, in the middle of the near (south) run, snapped to a bay.
    const gateX = area.x + Math.round(area.width / 2 / step) * step;
    for (let x = area.x; x < east; x += step) {
      built.push(this.put("railX", x, area.y, this.depthAt(x + half, area.y)));
      built.push(this.put(x === gateX ? "gateX" : "railX", x, south, this.depthAt(x + half, south)));
    }
    for (let y = area.y; y < south; y += step) {
      built.push(this.put("railY", area.x, y, this.depthAt(area.x, y + half)));
      built.push(this.put("railY", east, y, this.depthAt(east, y + half)));
    }
    return built;
  }

  /**
   * A district's grow-area floor, as one diamond fill rather than the flat
   * baked rectangle painters (`straw`/`soil`/`muck`) those colours come
   * from -- see `paintZoneGround`'s own note on why a district-sized flat
   * texture on a diamond grid reads as a bug. Drawn far below everything
   * else (`GROW_AREA_GROUND_DEPTH`, the same always-behind-everything
   * scheme `ZONE_GROUND_DEPTH` uses) rather than at the area's own varying
   * isometric depth, because ground never needs to sort against anything
   * standing on it -- it is always furthest back, by construction.
   *
   * Material follows the zone, the same call the plot-grid era's
   * `paintPenGround` made and worth keeping now the ground is one district-
   * sized fill instead of sixteen plot-sized ones: churned dirt for the
   * Cattle Pens (Ox Fields is worked soil, not a barn floor), trodden mud
   * for the Sheep Pens (the Fold is wet ground), straw for the Hen Coops
   * (genuinely barnyard bedding), and tilled soil (with furrows) for the
   * Long Meadow's Crop Fields.
   *
   * There used to be a scatter of small worn patches over the base fill,
   * meant to break up the flat colour -- Kayo's call, cut outright: at
   * district scale the patches just read as a spatter of stray brown
   * blotches over the field, not texture.
   *
   * `furrowed` is separate from `kind`, not implied by `kind === "soil"`:
   * the Cattle Pens use the same worked-dirt colour Ox Fields already paints
   * with (churned, not row-tilled), where only the Long Meadow's Crop
   * Fields are actually ploughed into rows. Reusing one colour for two
   * different textures is deliberate -- a Cattle Pen is not a second crop
   * field wearing the same dye.
   *
   * A furrowed area draws the generated `soilTile` once it has loaded,
   * masked to the diamond's own polygon (a `TileSprite` clipped by a
   * `GeometryMask` traced from the same corners the flat fill used) instead
   * of the flat colour + drawn furrow lines -- the same "generated art
   * REPLACES the procedural pass, does not sit under it" bargain `bakeGrass`
   * makes for the lawn. Rotated by `ISO_EDGE_ANGLE.alongX` so the texture's
   * own furrow stripes run along the diamond's grain rather than square to
   * the screen, the same correction `ISO_EDGE_ANGLE` already gives a
   * "furrow" prop's sprite elsewhere. Unfurrowed areas, and a furrowed one
   * before the tile has loaded, keep the exact old flat-fill behaviour --
   * nothing here is allowed to leave a district undrawn.
   */
  private paintAreaGround(
    area: WorldRect,
    kind: "straw" | "soil" | "muck",
    furrowed = false,
  ): Phaser.GameObjects.GameObject[] {
    const corners = projectedCorners(area);
    const ramp = rampHex(kind);
    const built: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics().setDepth(GROW_AREA_GROUND_DEPTH);
    built.push(g);

    const tileKey = spriteLoadKey("soilTile");
    const useTexture = furrowed && this.textures.exists(tileKey);
    if (!useTexture) g.fillStyle(ramp.top, 1);
    g.beginPath();
    g.moveTo(corners.n.x, corners.n.y);
    g.lineTo(corners.e.x, corners.e.y);
    g.lineTo(corners.s.x, corners.s.y);
    g.lineTo(corners.w.x, corners.w.y);
    g.closePath();
    if (!useTexture) g.fillPath();
    g.lineStyle(1, ramp.rim, 0.55);
    g.strokePath();

    if (useTexture) {
      // The mask's own shape never needs to be seen -- only its path -- so
      // it is built from a second Graphics rather than reusing `g`, which
      // still needs to draw the visible rim stroke traced above.
      const maskShape = this.add.graphics().setVisible(false);
      maskShape.fillStyle(0xffffff, 1);
      maskShape.beginPath();
      maskShape.moveTo(corners.n.x, corners.n.y);
      maskShape.lineTo(corners.e.x, corners.e.y);
      maskShape.lineTo(corners.s.x, corners.s.y);
      maskShape.lineTo(corners.w.x, corners.w.y);
      maskShape.closePath();
      maskShape.fillPath();
      built.push(maskShape);

      const bounds = projectedBounds(area);
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      // Oversized (the bounding box's own diagonal) so the rotated square
      // still fully covers the diamond's screen-space box before the mask
      // clips it back down to the diamond itself.
      const side = Math.hypot(bounds.width, bounds.height);
      const tile = this.add
        .tileSprite(cx, cy, side, side, tileKey)
        .setDepth(GROW_AREA_GROUND_DEPTH)
        .setRotation(ISO_EDGE_ANGLE.alongX)
        // Shrinks each repeat of the 512px source so its furrow spacing
        // lands close to the ~23-unit spacing the six drawn rows this
        // replaces used on the Long Meadow's own 160-unit box (160 / 7).
        .setTileScale(0.4, 0.4)
        .setMask(maskShape.createGeometryMask());
      built.push(tile);
    } else if (furrowed) {
      this.paintFurrows(g, area);
    }
    return built;
  }

  /** Furrow lines across a tilled grow area, drawn along the diamond's own
   *  grain so they read as rows rather than as stripes painted over the top
   *  of it -- the same idea the old per-plot soil ground used, spread across
   *  a whole district's worth of field instead of one CELL. */
  private paintFurrows(g: Phaser.GameObjects.Graphics, area: WorldRect): void {
    const rows = 6;
    for (let r = 1; r <= rows; r += 1) {
      const k = r / (rows + 1);
      const a = isoProject(area.x + 10, area.y + k * area.height);
      const b = isoProject(area.x + area.width - 10, area.y + k * area.height);
      g.lineStyle(1.1, 0x000000, 0.14);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
    }
  }

  /**
   * How big a ring to trace around one unit -- half the diamond's own side
   * length, derived from the painter's own box rather than a hand-kept
   * table (the "drifted hand-written copies" trap this codebase has hit
   * before with STAKES_TIERS and the wager ladders). A mucked unit has no
   * single painter box to measure -- it is a small cluster -- so it gets a
   * fixed footprint sized to roughly cover that cluster instead.
   */
  private unitFootprintHalf(unit: StackAcresSceneUnit): number {
    if (unit.state === "mucked") return 16;
    if (isLivestock(unit.stock)) {
      const box = PAINTERS[STOCK_ART[unit.stock]];
      return Math.max(box.w, box.h) / 2 + 6;
    }
    // A crop's ground diamond grows with the crop, so the thing a thumb is
    // aiming at on a phone is the thing it lands on -- and so the gold ready
    // ring frames the ripe sprite rather than sitting inside it. Never
    // narrower than the flat half every crop used before they were grown.
    return cropFootprintHalf(growthStage(unit.progress, unit.state === "ready"));
  }

  /** Traces a diamond of the given half-size, centred on a unit's own
   *  container origin (local (0, 0) -- `buildUnit` always positions the
   *  container at the unit's true screen position, so a local-space diamond
   *  here composes correctly with it exactly the way the old per-plot
   *  `tracePlotDiamond` composed with a CellNode's own container). `inset`
   *  shrinks (positive) or grows (negative) the traced edge, same
   *  convention as before. */
  private traceUnitDiamond(g: Phaser.GameObjects.Graphics, half: number, inset: number): void {
    const h = half - inset;
    const c = projectedCorners({ x: -h, y: -h, width: h * 2, height: h * 2 });
    g.moveTo(c.n.x, c.n.y);
    g.lineTo(c.e.x, c.e.y);
    g.lineTo(c.s.x, c.s.y);
    g.lineTo(c.w.x, c.w.y);
    g.closePath();
  }

  /**
   * A unit's own state ring -- ready, hungry, mucked -- the one piece of the
   * old `paintRings` that still means anything now that there is no
   * afford/selected ring left to draw alongside it. Static once painted:
   * unlike the old afford ring, nothing here pulses, so this only ever runs
   * again when `setUnits` decides the unit's own signature changed.
   */
  private paintUnitRing(node: UnitNode, unit: StackAcresSceneUnit): void {
    const ring = node.ring;
    ring.clear();
    const colour =
      unit.state === "ready"
        ? GOLD
        : unit.state === "hungry"
          ? AMBER
          : unit.state === "dry"
            ? WATER
            : unit.state === "mucked"
              ? MUCK
              : null;
    if (colour === null) return;
    const half = this.unitFootprintHalf(unit);
    if (unit.state === "ready") {
      ring.lineStyle(5, GOLD, 0.22);
      ring.beginPath();
      this.traceUnitDiamond(ring, half, -1);
      ring.strokePath();
    }
    ring.lineStyle(2.2, colour, 1);
    ring.beginPath();
    this.traceUnitDiamond(ring, half, 1.5);
    ring.strokePath();
  }

  /** A ripe crop hops gently in place, the way the old grid's plants did.
   *  Livestock is never bobbed -- an animal already has its own gait and
   *  breathing in update(), and stacking a bob on top of that would fight
   *  it every frame. */
  private bob(node: UnitNode, targets: Phaser.GameObjects.GameObject[]): void {
    if (this.options.reducedMotion) return;
    node.tweens.push(
      this.tweens.add({
        targets,
        y: "-=2",
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
    );
  }


  /* ---------------------------------------------------------------- */
  /* Camera. Everything here is in CSS pixels; the camera is not.      */
  /* ---------------------------------------------------------------- */

  private viewW(): number {
    return this.cameras.main.width / DPR;
  }

  private viewH(): number {
    return this.cameras.main.height / DPR;
  }

  /** The zoom as the player experiences it: world units per CSS pixel. */
  private zoomL(): number {
    return this.cameras.main.zoom / DPR;
  }

  private setZoomL(zoom: number): void {
    this.cameras.main.setZoom(clampZoom(zoom) * DPR);
  }


  /**
   * Zoom that fits a screen-space box inside the viewport, with a little
   * breathing room around the edges. Replaces world.ts's own `openingZoom`,
   * which existed to fit a box that grew and shrank with however much land
   * was owned -- there is no such box any more (a unit has no position to
   * bound a rectangle around), so every caller here only ever has to fit ONE
   * fixed-size window, `zoneFrame`'s own `ZONE_ARRIVAL_WINDOW` box, and the
   * geometry for that belongs with the camera code that uses it rather than
   * in world.ts.
   */
  private fitZoomToBox(box: { width: number; height: number }, viewW: number, viewH: number): number {
    const margin = 0.86;
    return clampZoom(Math.min((viewW * margin) / box.width, (viewH * margin) / box.height));
  }

  /** "Home": the Farmstead's own gate (lib/stackacres/zones.ts's
   *  `zoneFrame("farmstead")`) -- the same fixed-size arrival window every
   *  district's own signpost travel uses (`focusZone`), rather than a box
   *  fitted to whatever land happens to be owned. There is nothing left to
   *  fit a box around: a unit wanders or sits at a deterministic spot inside
   *  its district, it has no position of its own to bound a rectangle
   *  with. */
  private homeView(): { zoom: number; x: number; y: number } {
    const frame = zoneFrame("farmstead");
    const screenBox = projectedBounds(frame);
    const centre = isoProject(frame.x + frame.width / 2, frame.y + frame.height / 2);
    return { zoom: this.fitZoomToBox(screenBox, this.viewW(), this.viewH()), x: centre.x, y: centre.y };
  }


  private openCamera(): void {
    const view = this.homeView();
    this.setZoomL(view.zoom);
    this.cameras.main.centerOn(view.x, view.y);
  }

  recenter(): void {
    if (!this.created) return;
    // Any deliberate camera move wins over whatever the map was still coasting
    // towards; two of them fighting reads as the map refusing to go home.
    this.glide = null;
    const cam = this.cameras.main;
    const view = this.homeView();
    if (this.options.reducedMotion) {
      this.setZoomL(view.zoom);
      cam.centerOn(view.x, view.y);
      return;
    }
    cam.zoomTo(view.zoom * DPR, 450, "Sine.easeInOut");
    cam.pan(view.x, view.y, 450, "Sine.easeInOut");
  }

  zoomBy(factor: number): void {
    if (!this.created) return;
    this.glide = null;
    const cam = this.cameras.main;
    const target = clampZoom(this.zoomL() * factor) * DPR;
    if (this.options.reducedMotion) cam.setZoom(target);
    else cam.zoomTo(target, 180, "Sine.easeOut");
  }

  /** Zoom keeping the world point under (screenX, screenY) where it is. Both
   *  arguments are device pixels, straight off a pointer or a wheel event. */
  private zoomAbout(screenX: number, screenY: number, zoomL: number): void {
    const cam = this.cameras.main;
    const next = clampZoom(zoomL) * DPR;
    const world = cam.getWorldPoint(screenX, screenY);
    cam.setZoom(next);
    const scroll = scrollToKeepUnderPointer(
      { x: world.x, y: world.y },
      { x: screenX, y: screenY },
      cam.width,
      cam.height,
      next,
    );
    cam.setScroll(scroll.x, scroll.y);
  }

  /** World to CSS pixels, the way Phaser's camera transform does it. */
  private toScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: ((x - cam.scrollX - cam.width / 2) * cam.zoom + cam.width / 2) / DPR,
      y: ((y - cam.scrollY - cam.height / 2) * cam.zoom + cam.height / 2) / DPR,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Gestures are read straight off the host element with native pointer
   * events, and a finger exists only while this map is holding it.
   *
   * The layer this replaced trusted Phaser's own pointer bookkeeping: it began
   * a pinch whenever pointer1 and pointer2 both read as down. Any touch Phaser
   * never saw end -- a touchcancel Safari fires as it takes the gesture (which
   * Phaser cannot even preventDefault), a touch lost while the tab was
   * backgrounded, an emulated mouse event -- left a phantom finger down, and
   * the next single thumb was then measured against it: moving the thumb
   * changed the distance, so the map zoomed instead of panning. That is the
   * bug the product owner hit on his iPhone. Here nothing is inferred; a
   * pointerdown puts a finger in `pts` and an up, a cancel or a lost capture
   * takes it out again.
   *
   * The DOM overlays are siblings of the host, so a press on the toolbelt or
   * the district sidebar never reaches this listener at all -- a button
   * press there is a real DOM click, and `pts` never hears about it.
   */
  private bindInput(): void {
    const host = this.options.host;
    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      this.hostOrigin = { left: rect.left, top: rect.top };
    };
    measure();

    // Pointers speak CSS pixels; the canvas is DPR times denser, and so is the
    // camera drawing into it.
    const toGame = (clientX: number, clientY: number): { x: number; y: number } => ({
      x: (clientX - this.hostOrigin.left) * DPR,
      y: (clientY - this.hostOrigin.top) * DPR,
    });
    const fingers = (): Finger[] => [...this.pts.values()];
    const gap = (a: Finger, b: Finger): number => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = (a: Finger, b: Finger): Finger => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    // Two stops along the seam every gesture that still needs true world
    // space resolves a finger through: scene space (what the tool ghost is
    // positioned in) and true world space (what the meadow's tiles are
    // indexed in).
    const sceneAt = (clientX: number, clientY: number): { x: number; y: number } => {
      const at = toGame(clientX, clientY);
      const scene = this.cameras.main.getWorldPoint(at.x, at.y);
      return { x: scene.x, y: scene.y };
    };
    const resolveWorld = (clientX: number, clientY: number): WorldPoint => {
      const scene = sceneAt(clientX, clientY);
      return isoUnproject(scene.x, scene.y);
    };
    /** Standing grass under this finger, with the scythe held? */
    const mowable = (clientX: number, clientY: number): boolean => {
      if (this.tool !== "scythe") return false;
      const world = resolveWorld(clientX, clientY);
      const tile = meadowTileAt(world.x, world.y);
      const key = meadowTileKey(tile.tx, tile.ty);
      return meadowDensityAt(tile.tx, tile.ty, this.mown.get(key) ?? null, Date.now()) > 0;
    };
    const oneFinger = (id: number, at: Finger, kind: "press" | "pan"): DragGesture => ({
      kind,
      id,
      x: at.x,
      y: at.y,
      startX: at.x,
      startY: at.y,
      trail: [{ t: performance.now(), x: at.x, y: at.y }],
    });
    const startPinch = (): void => {
      const [a, b] = fingers();
      if (!a || !b) return;
      const centre = mid(a, b);
      const at = toGame(centre.x, centre.y);
      const world = this.cameras.main.getWorldPoint(at.x, at.y);
      this.gesture = {
        kind: "pinch",
        distance: gap(a, b),
        zoom: this.zoomL(),
        world: { x: world.x, y: world.y },
      };
    };

    const down = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // A third finger is not part of any gesture.
      if (this.pts.size >= 2) return;
      this.glide = null;
      if (this.pts.size === 0) measure();
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone. The gesture tracks fine without it.
      }
      this.pts.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pts.size === 2) startPinch();
      else {
        const gesture = oneFinger(event.pointerId, { x: event.clientX, y: event.clientY }, "press");
        gesture.startMow = mowable(event.clientX, event.clientY);
        this.gesture = gesture;
      }
    };

    const move = (event: PointerEvent): void => {
      const finger = this.pts.get(event.pointerId);
      if (!finger) return;
      finger.x = event.clientX;
      finger.y = event.clientY;
      const gesture = this.gesture;
      if (!gesture) return;

      if (gesture.kind === "pinch") {
        const [a, b] = fingers();
        if (!a || !b) return;
        const cam = this.cameras.main;
        const zoom = clampZoom((gesture.zoom * gap(a, b)) / gesture.distance) * DPR;
        cam.setZoom(zoom);
        // Holding the anchor under the *current* midpoint is what also lets a
        // pinch pan: two fingers moved together at a fixed gap slide the map.
        const centre = mid(a, b);
        const scroll = scrollToKeepUnderPointer(
          gesture.world,
          toGame(centre.x, centre.y),
          cam.width,
          cam.height,
          zoom,
        );
        cam.setScroll(scroll.x, scroll.y);
        return;
      }

      if (event.pointerId !== gesture.id) return;
      const prevX = gesture.x;
      const prevY = gesture.y;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      const now = performance.now();
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      gesture.trail.push({ t: now, x: event.clientX, y: event.clientY });
      while (gesture.trail.length > 2 && now - gesture.trail[0].t > FLICK_WINDOW_MS) {
        gesture.trail.shift();
      }
      if (gesture.kind === "press") {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <= TAP_SLOP) {
          return;
        }
        // A drag that started on standing grass with the scythe out cuts a
        // swathe; anywhere else, a drag pans -- there is no plot left for it
        // to sweep across instead.
        if (gesture.startMow) {
          gesture.kind = "mow";
          const start = sceneAt(gesture.startX, gesture.startY);
          this.showToolGhost(start.x, start.y);
          this.mowSegment(
            resolveWorld(gesture.startX, gesture.startY),
            resolveWorld(event.clientX, event.clientY),
          );
          const here = sceneAt(event.clientX, event.clientY);
          this.moveToolGhost(here.x, here.y);
          return;
        }
        gesture.kind = "pan";
      }
      if (gesture.kind === "mow") {
        // Cut from where the finger WAS to where it is: `mowStroke` samples
        // the segment, so a fast swipe leaves an unbroken swathe rather than
        // a dotted line of the tiles that happened to get a move event.
        this.mowSegment(
          resolveWorld(prevX, prevY),
          resolveWorld(event.clientX, event.clientY),
        );
        const here = sceneAt(event.clientX, event.clientY);
        this.moveToolGhost(here.x, here.y);
        return;
      }
      const cam = this.cameras.main;
      const zoom = this.zoomL();
      cam.scrollX -= dx / zoom;
      cam.scrollY -= dy / zoom;
    };

    const up = (event: PointerEvent, cancelled: boolean): void => {
      if (!this.pts.has(event.pointerId)) return;
      this.pts.delete(event.pointerId);
      try {
        if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      } catch {
        // Already released.
      }
      const gesture = this.gesture;
      if (!gesture) return;

      if (gesture.kind === "pinch") {
        // One of the two lifted. Carry on as a pan with the other, from where
        // it is now, so the map does not jump under the finger that stayed.
        const rest = [...this.pts.entries()][0];
        this.gesture = rest ? oneFinger(rest[0], rest[1], "pan") : null;
        return;
      }
      if (event.pointerId !== gesture.id) return;
      this.gesture = null;
      if (gesture.kind === "pan") {
        if (!cancelled) this.flick(gesture);
        return;
      }
      if (gesture.kind === "mow") {
        this.hideToolGhost();
        return;
      }
      // A cancel is a release that never taps.
      if (cancelled) return;
      // A tap with the scythe on standing grass cuts that spot -- the same
      // action the drag does, over a stroke of zero length. Without this a
      // single tap in the meadow would do nothing at all, and a tool that
      // sometimes does nothing reads as broken rather than as precise.
      if (gesture.startMow) {
        const at = resolveWorld(event.clientX, event.clientY);
        this.mowSegment(at, at);
        return;
      }
      // Every other tap is aimed at the farm itself. A unit's own picture
      // first -- collecting, feeding and clearing happen where the finger
      // landed now, not in a sidebar row -- and failing that, the fenced
      // ground of whichever district it fell in, which is an offer to seed
      // something there. A tap in the woods still does nothing.
      const local = { x: event.clientX - this.hostOrigin.left, y: event.clientY - this.hostOrigin.top };
      const hit = this.unitAt(event.clientX, event.clientY);
      if (hit) {
        this.callbacks.onUnitTap(hit, local);
        return;
      }
      const ground = resolveWorld(event.clientX, event.clientY);
      // The barn -- Ray's Museum's own entryway -- checked before the
      // district ground fallback: it stands north of every grow area (see
      // BARN_FOOTPRINT's own doc comment), so the two never compete for the
      // same tap, but a unit always wins over the structure behind it.
      if (barnHitAt(ground.x, ground.y)) {
        this.callbacks.onBarnTap();
        return;
      }
      // Land nobody has cleared answers ANYWHERE inside its district, not
      // just on a fenced box it does not have one of yet -- there is nothing
      // drawn on it to aim at but trees. Checked before the grow area for the
      // same reason: a locked district paints no grow area, so there is
      // nothing there for the seed menu to open on, and a tap that resolved
      // to neither would be the silent target the whole approach depends on
      // avoiding.
      const wild = zoneAt(ground.x, ground.y);
      if (wild !== null && this.locked.has(wild)) {
        this.callbacks.onLockedSectorTap(wild, local);
        return;
      }
      const zone = growAreaAt(ground.x, ground.y);
      if (zone) this.callbacks.onGroundTap(zone, local);
    };

    const onUp = (event: PointerEvent): void => up(event, false);
    const onCancel = (event: PointerEvent): void => up(event, true);
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      measure();
      this.glide = null;
      // A trackpad pinch arrives as a ctrl-held wheel: zoom that one finely,
      // per notch, rather than by a whole mouse-wheel step.
      const factor = event.ctrlKey
        ? Math.min(1.5, Math.max(1 / 1.5, Math.exp(-event.deltaY * 0.012)))
        : event.deltaY < 0
          ? 1.12
          : 1 / 1.12;
      const at = toGame(event.clientX, event.clientY);
      this.zoomAbout(at.x, at.y, this.zoomL() * factor);
    };

    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    host.addEventListener("lostpointercapture", onCancel);
    // Not passive: the page must not scroll or page-zoom out from under a map
    // the wheel is meant to be zooming.
    host.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", measure);

    this.unbindInput = () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      host.removeEventListener("lostpointercapture", onCancel);
      host.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", measure);
    };
    // The listeners are on a DOM element that outlives the scene, so a remount
    // would stack a second set on it if they were not taken off here.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.releaseInput, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.releaseInput, this);
  }


  private releaseInput(): void {
    this.unbindInput?.();
    this.unbindInput = null;
    this.pts.clear();
    this.gesture = null;
    this.glide = null;
  }

  /** A released pan keeps the speed of its last ~80ms and coasts to a stop. */
  private flick(gesture: DragGesture): void {
    if (this.options.reducedMotion || gesture.trail.length < 2) return;
    const last = gesture.trail[gesture.trail.length - 1];
    const first = gesture.trail[0];
    const dt = last.t - first.t;
    // A finger that had already stopped before it lifted throws nothing.
    if (dt < 8 || performance.now() - last.t > 120) return;
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed < FLICK_SPEED_MIN) return;
    if (speed > FLICK_SPEED_CAP) {
      vx = (vx * FLICK_SPEED_CAP) / speed;
      vy = (vy * FLICK_SPEED_CAP) / speed;
    }
    this.glide = { x: vx, y: vy };
  }

  private coast(delta: number): void {
    const glide = this.glide;
    if (!glide) return;
    // Clamped: a frame the tab spent in the background must not teleport the map.
    const step = Math.min(Math.max(delta, 1), 34);
    const cam = this.cameras.main;
    const zoom = this.zoomL();
    cam.scrollX -= (glide.x * step) / zoom;
    cam.scrollY -= (glide.y * step) / zoom;
    const decay = Math.pow(GLIDE_DECAY, step / 16);
    glide.x *= decay;
    glide.y *= decay;
    if (Math.hypot(glide.x, glide.y) < GLIDE_STOP) this.glide = null;
  }

  /* ---------------------------------------------------------------- */
  /* The held tool                                                     */
  /* ---------------------------------------------------------------- */

  /** Which tool's picture `toolGhost` shows once a mow drag starts. Set
   *  from the shell whenever the held tool changes; harmless to call before
   *  `create()` has run, since nothing shows the picture until a drag
   *  actually begins. */
  setToolIcon(icon: PainterName): void {
    this.toolIconName = icon;
    this.toolGhost?.setTexture(icon, ART_FRAME);
  }

  /**
   * Which tool is held, by name.
   *
   * Down to two tools now (see lib/stackacres/tools.ts): `inspect`, which
   * does nothing on the canvas at all, and `scythe`, whose target is the
   * ground rather than a unit -- there is no unit to carry the answer the
   * way a plot's own `afford` field once did, so the scene has to ask the
   * question itself. See `mowable` in `bindInput`.
   */
  setTool(tool: StackAcresTool): void {
    this.tool = tool;
  }

  /**
   * Which rung of the equipment ladder is held, which is what sets the
   * swathe one scythe stroke cuts.
   *
   * A setter rather than a constructor-only option because buying an upgrade
   * has to widen the swathe NOW: rebuilding the scene to pick it up would
   * throw away `mown`, so the meadow the player just cleared would stand back
   * up the instant they paid for a better tool.
   */
  setToolTier(tier: StackAcresToolTier): void {
    this.options.toolTier = tier;
  }

  /** Floats the held tool's own picture above a finger that just turned a
   *  press into a mow drag -- offset up so the thumb dragging it never
   *  covers the swathe it is cutting. */
  private showToolGhost(sceneX: number, sceneY: number): void {
    const ghost = this.toolGhost;
    if (!ghost) return;
    ghost.setTexture(this.toolIconName, ART_FRAME).setPosition(sceneX, sceneY - 16).setAngle(0).setVisible(true);
    if (this.options.reducedMotion || this.toolGhostTween) return;
    this.toolGhostTween = this.tweens.add({
      targets: ghost,
      angle: { from: -7, to: 7 },
      duration: 260,
      delay: 260,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }


  private moveToolGhost(sceneX: number, sceneY: number): void {
    this.toolGhost?.setPosition(sceneX, sceneY - 16);
  }

  private hideToolGhost(): void {
    this.toolGhost?.setVisible(false);
    this.toolGhostTween?.stop();
    this.toolGhostTween = null;
    this.toolGhost?.setAngle(0);
  }

  /* ---------------------------------------------------------------- */
  /* Hit testing                                                       */
  /* ---------------------------------------------------------------- */

  /** Where a unit is standing in the world right now: an animal's wandered
   *  position, or the fixed spot a crop (or anything mucked) sits at. The
   *  same two cases `buildUnit` and `update` already split on. */
  private unitWorldSpot(node: UnitNode): WorldPoint {
    return node.critter ?? this.staticSpotFor(node.unit);
  }

  /**
   * The unit under a finger, or null.
   *
   * Two regions, both in scene space and both padded by a fingertip. The
   * unit's own ART is the first -- a cow's body is drawn well above the
   * ground it stands on, and that body is what the player is aiming at. Its
   * ground DIAMOND is the second, which is what makes the gold "ready" ring
   * a target too, and what catches a crop whose ripe sprite is a few pixels
   * of carrot top.
   *
   * The topmost hit wins, by the same depth the renderer sorts by, so a tap
   * where two pens overlap picks the one actually drawn in front.
   *
   * NOT Phaser's own input system. This scene runs with Phaser input off
   * entirely (see the game config in stackacres-world.tsx) and reads raw
   * pointer events off the host, so a `GAMEOBJECT_POINTER_DOWN` here would
   * be a second input layer double-handling every press -- and it fires on
   * PRESS, which would collect a unit the moment a pan that happened to
   * start on a hen began. Resolving the hit ourselves at release is what
   * keeps a drag across the map a drag.
   */
  private unitAt(clientX: number, clientY: number): string | null {
    if (this.nodes.size === 0) return null;
    const cam = this.cameras.main;
    const at = cam.getWorldPoint(
      (clientX - this.hostOrigin.left) * DPR,
      (clientY - this.hostOrigin.top) * DPR,
    );
    // A CSS pixel is this many scene units at the current zoom, which is what
    // keeps the pad a constant size under the thumb rather than under the map.
    const pad = TAP_PAD / this.zoomL();
    // Which of the two regions caught the finger, because that now has to
    // outrank depth. Growing the crops (lib/stackacres/crop-visuals.ts) took a
    // ripe crop's ground diamond from a 24-unit box to a 48-unit one, and the
    // Long Meadow's interior is only 136x118 with up to six of each crop kind
    // in it -- so several of those diamonds overlapping is the normal case,
    // not a corner one. On depth alone the front crop then swallows the tap
    // target of every crop behind it, and the one behind becomes untappable on
    // the map however squarely the finger lands on its actual picture.
    //
    // Touching a unit's own ART therefore beats merely clipping another's
    // ground, and depth only decides between hits of the same kind -- which is
    // still what settles two overlapping sprites, the case the depth rule was
    // written for.
    let best: { id: string; onArt: boolean; depth: number } | null = null;
    for (const [id, node] of this.nodes) {
      const art = node.sprite.getBounds();
      const onArt =
        at.x >= art.x - pad &&
        at.x <= art.right + pad &&
        at.y >= art.y - pad &&
        at.y <= art.bottom + pad;
      let hit = onArt;
      if (!hit) {
        const spot = this.unitWorldSpot(node);
        const half = this.unitFootprintHalf(node.unit);
        const ground = projectedBounds({
          x: spot.x - half,
          y: spot.y - half,
          width: half * 2,
          height: half * 2,
        });
        hit =
          at.x >= ground.x - pad &&
          at.x <= ground.x + ground.width + pad &&
          at.y >= ground.y - pad &&
          at.y <= ground.y + ground.height + pad;
      }
      if (!hit) continue;
      const depth = node.container.depth;
      if (!best || (onArt !== best.onArt ? onArt : depth > best.depth)) {
        best = { id, onArt, depth };
      }
    }
    return best ? best.id : null;
  }

  /* ---------------------------------------------------------------- */
  /* Effects                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * The squash-and-stretch a tapped unit answers with: a quick widen-and-
   * flatten, a smaller overshoot the other way, then rest. Entirely local to
   * the press -- it says "heard you" before the network has said anything at
   * all, which is the whole reason a tap on the map feels like a button and
   * a tap that waits for a response does not.
   *
   * On the CONTAINER, not the sprite: `update` rewrites a walking animal's
   * own sprite scale every frame for its gait and breathing, so a tween
   * there would be overwritten mid-bounce. The container's scale is nobody
   * else's, and scaling it takes the shadow and the state ring along, which
   * is what makes the whole unit react rather than just its outline.
   */
  popUnit(unitId: string): void {
    const node = this.nodes.get(unitId);
    if (!node) return;
    // A second tap mid-bounce restarts the bounce rather than stacking a
    // second one on the same scale.
    this.cancelPop(node);
    node.container.setScale(1, 1);
    if (this.options.reducedMotion) return;
    node.pop = this.tweens.chain({
      targets: node.container,
      tweens: [
        { scaleX: 1.16, scaleY: 0.84, duration: 90, ease: "Quad.easeOut" },
        { scaleX: 0.95, scaleY: 1.09, duration: 130, ease: "Quad.easeInOut" },
        { scaleX: 1, scaleY: 1, duration: 150, ease: "Back.easeOut" },
      ],
      // A unit whose picture is rebuilt mid-bounce (a clock tick crossing a
      // growth stage, or a harvest taking the unit away) leaves this chain
      // pointed at a destroyed container; `destroyNode` cancels it through
      // `cancelPop`. Resting the scale here means a bounce that ran to the
      // end never leaves a unit fractionally squashed.
      onComplete: () => {
        node.container.setScale(1, 1);
        node.pop = null;
      },
    });
  }

  /**
   * The exact inverse of `resolveWorld` in `bindInput`: given a true WORLD
   * point, the client (CSS pixel) coordinate a real pointer event would have
   * to land on to hit it right now, under whatever the camera's current
   * pan/zoom happens to be.
   *
   * Test/dev use only -- nothing in the scene calls this, and no production
   * code needs to invert its own projection. It exists so an e2e spec can
   * dispatch a real PointerEvent at the barn (or any other fixed landmark)
   * without hand-deriving the camera's own transform a second time; see
   * `window.__stackacres` in stackacres-world.tsx, the same dev-only handle
   * the gesture harness already reads the camera through.
   *
   * `worldView` is Phaser's own already-computed visible-world rectangle for
   * this frame, so this needs no camera-rotation math of its own: this scene
   * never rotates its camera, so the transform is the plain affine one
   * `worldView` already encodes.
   */
  screenPointFor(worldX: number, worldY: number): TapPoint {
    const cam = this.cameras.main;
    const scene = isoProject(worldX, worldY);
    const gameX = (scene.x - cam.worldView.x) * cam.zoom;
    const gameY = (scene.y - cam.worldView.y) * cam.zoom;
    return { x: this.hostOrigin.left + gameX / DPR, y: this.hostOrigin.top + gameY / DPR };
  }

  /**
   * The reward, and the refusal: a line of text (and, when there is produce
   * to name, its own icon) that lifts off the tap, leans over and fades.
   *
   * Positioned in SCENE space at the world point under the finger, not pinned
   * to the screen, so it stays glued to the thing that produced it if the map
   * moves under it. Sized so it lands at a constant CSS size whatever the
   * zoom: the text is rasterised at device resolution and the whole group is
   * scaled back down by `1 / (zoomL * DPR)`, which is what keeps it crisp at
   * 5x instead of a stretched 15px bitmap.
   */
  floatAt(at: TapPoint, text: string, tone: "gain" | "deny", icon?: PainterName): void {
    if (!this.created) return;
    const cam = this.cameras.main;
    const world = cam.getWorldPoint(at.x * DPR, at.y * DPR);
    const group = this.add.container(world.x, world.y).setDepth(9000);
    this.displayFont ??= window.getComputedStyle(this.options.host).fontFamily || "system-ui";
    // The art's own ramps, not chrome tokens: this is a label drawn INTO the
    // picture, over grass, and it has to sit in the same light everything
    // else on the canvas does. Gold for something gained, chalk for a
    // refusal, over the darkest pine so it reads on a bright field.
    const colour = tone === "gain" ? RAMPS.gold.top : RAMPS.chalk.side;
    // Authored in DEVICE pixels; `group` scales the lot back to CSS size.
    const label = this.add
      .text(0, 0, text, {
        fontFamily: this.displayFont,
        fontSize: `${Math.round(15 * DPR)}px`,
        fontStyle: "700",
        color: colour,
        stroke: RAMPS.pine.rim,
        strokeThickness: 4 * DPR,
      })
      .setOrigin(0, 0.5);
    let width = label.width;
    if (icon) {
      const badge = this.add
        .image(0, 0, icon, ART_FRAME)
        // A painter is 24 units baked at ART_SCALE, so its texture is
        // 24 * ART_SCALE across; this lands it at 20 CSS pixels.
        .setScale((20 * DPR) / (PAINTERS[icon].w * S))
        .setOrigin(0, 0.5);
      label.setX(badge.displayWidth + 4 * DPR);
      width = label.x + label.width;
      group.add(badge);
    }
    group.add(label);
    // Centred on the finger horizontally, and started just above it so the
    // text is never under the thumb that spawned it.
    group.setScale(1 / (this.zoomL() * DPR));
    label.setY(0);
    group.x -= (width / 2) * group.scaleX;
    group.y -= 14 / this.zoomL();

    if (this.options.reducedMotion) {
      this.time.delayedCall(600, () => group.destroy(true));
      return;
    }
    this.tweens.add({
      targets: group,
      y: group.y - 34 / this.zoomL(),
      angle: tone === "gain" ? -6 : 6,
      alpha: { from: 1, to: 0, duration: 600, ease: "Quad.easeIn" },
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => group.destroy(true),
    });
  }

  /**
   * Fires `onViewMoved` once the world has visibly slid under whatever the
   * shell has pinned to a screen position.
   *
   * The threshold is in CSS pixels of apparent movement, not in raw scroll:
   * a scroll unit at the zoomed-out end of the range is a third of a pixel
   * on screen and at the zoomed-in end is five, so a fixed scroll epsilon
   * would mean two different things at the two ends of the same map. Sized
   * so a real pan or a zoom step reports on its first frame, while a tween
   * easing out over its last few sub-pixel frames does not -- a menu opened
   * just as the camera settled should stay open.
   */
  private notifyViewMoved(): void {
    const cam = this.cameras.main;
    const screen = cam.zoom / DPR;
    const moved =
      Math.abs(cam.scrollX - this.lastView.x) * screen > VIEW_MOVE_SLOP ||
      Math.abs(cam.scrollY - this.lastView.y) * screen > VIEW_MOVE_SLOP ||
      Math.abs(cam.zoom / (this.lastView.zoom || cam.zoom) - 1) > 0.02;
    if (!moved) return;
    this.lastView = { x: cam.scrollX, y: cam.scrollY, zoom: cam.zoom };
    this.callbacks.onViewMoved();
  }

  /** The gold burst a collected unit leaves behind, at wherever it is
   *  standing right now -- an animal's current wandered position, or a
   *  crop's fixed spot. Looked up by unit id in `nodes` rather than by a
   *  stored screen position, so a burst on a unit mid-walk still lands where
   *  it actually is. Same look as before: a soft ring that swells and
   *  fades, plus a handful of sparks thrown outward. */
  celebrateHarvest(unitId: string): void {
    const node = this.nodes.get(unitId);
    if (!node) return;
    const x = node.container.x;
    const y = node.container.y;
    const burst = this.add.graphics().setDepth(8500);
    burst.fillStyle(0xffe98a, 0.85);
    burst.fillCircle(0, 0, 36);
    burst.setPosition(x, y).setScale(0.4);
    if (this.options.reducedMotion) {
      this.time.delayedCall(300, () => burst.destroy());
      return;
    }
    this.tweens.add({
      targets: burst,
      scale: 1.35,
      alpha: 0,
      duration: 620,
      ease: "Cubic.easeOut",
      onComplete: () => burst.destroy(),
    });
    for (let i = 0; i < 7; i += 1) {
      const spark = this.add.graphics().setDepth(8501);
      spark.fillStyle(GOLD, 1);
      spark.fillCircle(0, 0, 1.4);
      spark.setPosition(x, y);
      const angle = this.random() * Math.PI * 2;
      const reach = 18 + this.random() * 22;
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * reach,
        y: y + Math.sin(angle) * reach - 10,
        alpha: 0,
        duration: 520 + this.random() * 200,
        ease: "Cubic.easeOut",
        onComplete: () => spark.destroy(),
      });
    }
  }


  /* ---------------------------------------------------------------- */
  /* The open world                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * One chunk of open world: the woodland's own trees and litter, plus, for
   * any part of the chunk that falls inside a district, that district's
   * furniture and (in the Long Meadow) its grass.
   *
   * All three share one chunk because they share one lattice --
   * `chunkScenery` and `zoneScenery` are keyed on the same coordinates and
   * neither ever puts anything where the other would (see `blocked` in
   * lib/stackacres/world.ts) -- so one grow and one prune covers the lot.
   *
   * Depth is the projected y of a thing's feet, as everywhere else. Ground-
   * hugging district art (a furrow, a mud pool) is nudged fractionally below
   * that so an ox standing on a furrow is always in front of it.
   */
  private growChunk(cx: number, cy: number): ChunkContent {
    const items: Phaser.GameObjects.GameObject[] = [];
    for (const item of chunkScenery(cx, cy)) {
      if (castsShadow(item.kind)) {
        const [wide, tall] = sceneryShadowScale(item.kind);
        items.push(
          this.put("shadow", item.x, item.y + 1, item.y - 0.5)
            .setScale((wide * item.scale) / S, (tall * item.scale) / S)
            .setAlpha(0.8),
        );
      }
      items.push(this.put(item.kind, item.x, item.y, item.y).setScale(item.scale / S));
    }

    // Land nobody has cleared grows no farm gear -- see `zoneScenery`'s own
    // note. What stands there instead is `paintOvergrowth`'s wild growth,
    // built per district rather than per chunk.
    for (const item of zoneScenery(cx, cy, this.locked)) {
      const flat = item.kind === "furrow" || item.kind === "mudPool";
      const depth = this.depthAt(item.x, item.y, flat ? -0.5 : 0);
      if (ZONE_SHADOW[item.kind]) {
        const [wide, tall] = ZONE_SHADOW[item.kind] as readonly [number, number];
        items.push(
          this.put("shadow", item.x, item.y + 1, depth - 0.25)
            .setScale(wide / S, tall / S)
            .setAlpha(0.7),
        );
      }
      const sprite = this.put(item.kind, item.x, item.y, depth);
      // A furrow lies along the field's own grain rather than across the
      // screen, the same rotation the pens' fence rails take.
      if (item.kind === "furrow") sprite.setRotation(ISO_EDGE_ANGLE.alongX);
      items.push(sprite);
    }

    const grassKeys = this.growMeadow(cx, cy, items);
    return { items, grassKeys };
  }

  /**
   * The Long Meadow's grass for one chunk, one sprite per 16-unit tile that
   * has any grass on it.
   *
   * The sprite is registered in `grassTiles` so a scythe stroke can find and
   * repaint exactly the tiles it cut; the height it is drawn at comes from
   * `mown`, so a tile cut before the camera last looked away comes back
   * still cut.
   */
  private growMeadow(cx: number, cy: number, items: Phaser.GameObjects.GameObject[]): string[] {
    const keys: string[] = [];
    const x0 = cx * STACKACRES_CHUNK;
    const y0 = cy * STACKACRES_CHUNK;
    const meadow = STACKACRES_ZONES.meadow.bounds;
    // Nothing to do unless this chunk actually touches the meadow.
    if (
      x0 > meadow.x + meadow.width ||
      x0 + STACKACRES_CHUNK < meadow.x ||
      y0 > meadow.y + meadow.height ||
      y0 + STACKACRES_CHUNK < meadow.y
    ) {
      return keys;
    }
    const tx0 = Math.floor(x0 / MEADOW_TILE);
    const ty0 = Math.floor(y0 / MEADOW_TILE);
    const tiles = STACKACRES_CHUNK / MEADOW_TILE;
    for (let ty = ty0; ty < ty0 + tiles; ty += 1) {
      for (let tx = tx0; tx < tx0 + tiles; tx += 1) {
        if (meadowBaseDensity(tx, ty) === 0) continue;
        const key = meadowTileKey(tx, ty);
        if (this.grassTiles.has(key)) continue;
        const density = meadowDensityAt(tx, ty, this.mown.get(key) ?? null, Date.now());
        // A little off-centre per tile, so the field is grass rather than a
        // grid of identical tufts. Deterministic, so it does not jump when
        // the chunk regrows.
        const jitter = seededRandom(tx * 92837111 + ty * 689287499);
        const x = tx * MEADOW_TILE + 3 + jitter() * (MEADOW_TILE - 6);
        const y = ty * MEADOW_TILE + 3 + jitter() * (MEADOW_TILE - 6);
        const sprite = this.put(grassArt(density), x, y, this.depthAt(x, y));
        sprite.setVisible(density > 0);
        sprite.setData("meadow", { tx, ty, x, y });
        this.grassTiles.set(key, sprite);
        keys.push(key);
        items.push(sprite);
      }
    }
    return keys;
  }

  /** Repaints one meadow tile at whatever height it is now. */
  private refreshGrass(tx: number, ty: number): void {
    const key = meadowTileKey(tx, ty);
    const sprite = this.grassTiles.get(key);
    if (!sprite) return;
    const density = meadowDensityAt(tx, ty, this.mown.get(key) ?? null, Date.now());
    sprite.setVisible(density > 0);
    if (density > 0) sprite.setTexture(grassArt(density), ART_FRAME);
  }

  /** The world rectangle the camera can actually see. `scrollX` is the
   *  camera's centre minus half its *unzoomed* width, so it is not the left
   *  edge and cannot be used as one. */
  private viewRect(): WorldRect {
    const cam = this.cameras.main;
    const width = cam.width / cam.zoom;
    const height = cam.height / cam.zoom;
    return {
      x: cam.scrollX + cam.width / 2 - width / 2,
      y: cam.scrollY + cam.height / 2 - height / 2,
      width,
      height,
    };
  }

  /**
   * Keeps the world around the camera: the grass slid under it, and one
   * chunk of scenery grown per screenful, pruned two chunks past the edge so
   * a jitter at a boundary cannot thrash the same chunk in and out.
   */
  private tendWorld(): void {
    const grass = this.grass;
    if (!grass) return;
    const view = this.viewRect();
    // The tile sprite is snapped to a 256-unit lattice and its tile offset
    // moved with it, so the grass never appears to slide against the world.
    // This is pure screen-space decoration -- a flat backdrop under the
    // diamond-tiled foreground, same as the reference art -- so it fits the
    // camera's own rectangular view directly and never touches world.ts.
    const gx = Math.floor((view.x - 256) / 256) * 256;
    const gy = Math.floor((view.y - 256) / 256) * 256;
    grass.setPosition(gx, gy);
    grass.setSize(view.width + 768, view.height + 768);
    grass.tilePositionX = gx * GRASS_PX;
    grass.tilePositionY = gy * GRASS_PX;

    // Scenery chunks are keyed in world.ts's true Cartesian space, so the
    // camera's screen-space view rect has to come back through
    // `isoUnproject` first. A rectangular screen view unprojects to a
    // rotated parallelogram in world space; this is that parallelogram's own
    // axis-aligned box, which only ever over-includes a chunk or two --
    // harmless, and already inside the two-chunk prune margin below.
    const worldView = unprojectBoundsApprox(view);
    const cx0 = Math.floor((worldView.x - STACKACRES_CHUNK) / STACKACRES_CHUNK);
    const cy0 = Math.floor((worldView.y - STACKACRES_CHUNK) / STACKACRES_CHUNK);
    const cx1 = Math.floor((worldView.x + worldView.width + STACKACRES_CHUNK) / STACKACRES_CHUNK);
    const cy1 = Math.floor((worldView.y + worldView.height + STACKACRES_CHUNK) / STACKACRES_CHUNK);
    const keep = new Set<string>();
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const key = `${cx}:${cy}`;
        keep.add(key);
        if (!this.chunks.has(key)) this.chunks.set(key, this.growChunk(cx, cy));
      }
    }
    for (const [key, content] of this.chunks) {
      if (keep.has(key)) continue;
      const [cx, cy] = key.split(":").map(Number);
      if (cx < cx0 - 2 || cx > cx1 + 2 || cy < cy0 - 2 || cy > cy1 + 2) {
        for (const item of content.items) item.destroy();
        // The sprites are gone, so the tile index has to let go of them too
        // -- a stale entry here would have `refreshGrass` repainting a
        // destroyed object. `mown` is deliberately NOT cleared: the cut is
        // the state, and it outlives the picture of it.
        for (const tile of content.grassKeys) this.grassTiles.delete(tile);
        this.chunks.delete(key);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* The animals' day                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * The districts' animals, one tick of their day. Same state machine the
   * pens use, in absolute world space rather than cell-local, and re-sorted
   * every frame because unlike a pen's animals these are not inside a
   * container whose own depth already places them.
   */
  private walkHerds(delta: number): void {
    for (const animal of this.herds) {
      const herd = this.herdFor(animal);
      if (!herd) continue;
      animal.state = stepCritter(animal.state, herd.range, herd.speed, delta, this.random);
      animal.gait = stepGait(animal.gait, animal.state.mode === "walk", herd.speed, delta);
      // The sprite sits exactly on its own shadow, walking or not. Everything
      // the stride reads as is in the roll, which turns about the animal's
      // feet (every animal painter anchors at (0.5, 1)).
      const at = isoProject(animal.state.x, animal.state.y);
      animal.sprite.setPosition(at.x, at.y);
      animal.sprite.setDepth(at.y);
      animal.sprite.setRotation(animal.gait.roll);
      animal.sprite.setScale(mirrorFor(animal.art, animal.state.facing) / S, 1 / S);
      animal.shadow.setPosition(at.x, at.y + 1);
      animal.shadow.setDepth(at.y - 0.5);
    }
  }

  /** Which herd an animal belongs to, by the district its range sits in.
   *  Resolved from its own position rather than stored, so the two never
   *  disagree. */
  private herdFor(animal: HerdSprite): ReturnType<typeof zoneHerd> {
    for (const id of OUTER_ZONE_IDS) {
      const herd = zoneHerd(id);
      if (!herd) continue;
      if (
        animal.state.x >= herd.range.x &&
        animal.state.x <= herd.range.x + herd.range.width &&
        animal.state.y >= herd.range.y &&
        animal.state.y <= herd.range.y + herd.range.height
      ) {
        return herd;
      }
    }
    return null;
  }

  /**
   * Grass grows back. Swept a few times a minute rather than every frame,
   * and only over tiles that were actually cut -- an untouched meadow costs
   * nothing here.
   *
   * A tile that has regrown all the way to its own base height is dropped
   * from `mown` entirely, so the map does not accumulate a record of every
   * swathe ever cut for the length of the session.
   */
  private regrowMeadow(): void {
    if (this.mown.size === 0 || this.now - this.lastRegrow < 4_000) return;
    this.lastRegrow = this.now;
    const wall = Date.now();
    for (const [key, cutAt] of this.mown) {
      const [tx, ty] = key.split(":").map(Number);
      const base = meadowBaseDensity(tx, ty);
      if (meadowDensityAt(tx, ty, cutAt, wall) >= base) {
        this.mown.delete(key);
      }
      this.refreshGrass(tx, ty);
    }
  }

  /**
   * Cuts every meadow tile a stroke crossed, and shows it.
   *
   * The stroke's geometry is `mowStroke`'s (pure, tested); this only paints
   * the result. A tile already cut is skipped rather than re-cut, so
   * scrubbing the same patch back and forth does not restart its regrowth
   * clock over and over and leave one square permanently bald.
   */
  private mowSegment(from: WorldPoint, to: WorldPoint): void {
    // Nobody mows a field they have not bought. The Long Meadow's grass field
    // is untouched while the land is locked -- waist-high uncut grass is
    // exactly the right picture of unworked ground, so there is nothing to
    // hide, only a gesture to refuse.
    if (this.locked.has("meadow")) return;
    const wall = Date.now();
    let cut = false;
    for (const tile of mowStroke(from, to, scytheReachFor(this.options.toolTier))) {
      const key = meadowTileKey(tile.tx, tile.ty);
      const cutAt = this.mown.get(key) ?? null;
      if (meadowDensityAt(tile.tx, tile.ty, cutAt, wall) === 0) continue;
      this.mown.set(key, wall);
      cut = true;
      this.refreshGrass(tile.tx, tile.ty);
      if (!this.options.reducedMotion) this.cutBurst(tile.tx, tile.ty);
    }

    // One swish per SWEEP, not per pointer-move: this runs on every move
    // event, so an unthrottled cue would fire dozens of times a second and
    // turn the nicest gesture on the map into a machine gun. Gated on
    // something actually having been cut too -- dragging the scythe over
    // ground that is already bald should be silent, because nothing happened.
    if (cut && wall - this.lastSwishAt > SWISH_GAP_MS) {
      this.lastSwishAt = wall;
      scytheSound();
    }
  }

  /**
   * The leaf burst off a cut tile: a few clippings thrown up and out, fading
   * as they fall. Short-lived and self-destroying -- there is no pool here
   * because a stroke cuts a handful of tiles at a time, not hundreds.
   */
  private cutBurst(tx: number, ty: number): void {
    const x = tx * MEADOW_TILE + MEADOW_TILE / 2;
    const y = ty * MEADOW_TILE + MEADOW_TILE / 2;
    const at = isoProject(x, y);
    for (let i = 0; i < 3; i += 1) {
      const bit = this.add
        .image(at.x, at.y - 2, "grassStubble", ART_FRAME)
        .setScale(0.5 / S)
        .setDepth(at.y + 2)
        .setAlpha(0.9);
      const angle = this.random() * Math.PI * 2;
      this.tweens.add({
        targets: bit,
        x: at.x + Math.cos(angle) * (7 + this.random() * 7),
        y: at.y - 5 - this.random() * 7,
        alpha: 0,
        angle: (this.random() - 0.5) * 220,
        duration: 380 + this.random() * 180,
        ease: "Quad.easeOut",
        onComplete: () => bit.destroy(),
      });
    }
  }


  /**
   * Eases the camera to a district's gate (lib/stackacres/zones.ts's
   * `zoneFrame`), which is a fixed-size window on its approach point rather
   * than its whole extent -- so a big district and a small one both arrive
   * at a readable zoom instead of one of them opening as a smudge.
   */
  focusZone(id: ZoneId): void {
    if (!this.created) return;
    this.glide = null;
    const cam = this.cameras.main;
    const frame = zoneFrame(id);
    const screenBox = projectedBounds(frame);
    const centre = isoProject(frame.x + frame.width / 2, frame.y + frame.height / 2);
    const zoom = this.fitZoomToBox(screenBox, this.viewW(), this.viewH());
    if (this.options.reducedMotion) {
      this.setZoomL(zoom);
      cam.centerOn(centre.x, centre.y);
      return;
    }
    // Longer than `recenter`'s 450ms on purpose: this is a journey across the
    // map rather than a nudge back to the farm, and watching the ground go
    // past is most of what tells the player the districts are one place.
    cam.zoomTo(clampZoom(zoom) * DPR, 700, "Sine.easeInOut");
    cam.pan(centre.x, centre.y, 700, "Sine.easeInOut");
  }


  /**
   * Keeps the vignette over the whole screen. A scroll factor of zero pins
   * it against scrolling but not against zoom -- the camera scales every
   * object about its own centre -- so it is centred there and sized to the
   * view divided by the zoom.
   */
  /**
   * The sunny-day layers: shafts of light over everything, and gold flecks
   * catching on the ground under them.
   *
   * Both are skipped entirely under reduced motion rather than built and held
   * still. A static god-ray layer would be a permanent wash over the art for
   * no gain, and a static sparkle field is fifteen dots sitting on the grass;
   * neither is the quiet version of the effect, so the quiet version is none.
   *
   * The rays are pinned to the SCREEN and the sparkles to the WORLD, which is
   * the whole reason they are two different things rather than one layer:
   * light comes from the sky and does not slide when the camera pans, while a
   * fleck is a glint on a specific piece of grass and has to stay on it.
   */
  private buildSunlight(): void {
    if (this.options.reducedMotion) return;

    // Under the vignette (1e9) so the corners still darken over it, and above
    // every world object. ADD rather than NORMAL: sunlight adds light, and a
    // normal-blended cream wash over dark art reads as haze.
    this.godRays = this.add
      .image(0, 0, bakeGodRays(this))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1e9 - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);

    const sparkleKey = bakeSparkle(this);
    for (let i = 0; i < SPARKLE_MAX; i += 1) {
      this.sparkleSprites.push(
        this.add
          .image(0, 0, sparkleKey)
          .setOrigin(0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false),
      );
    }
  }

  /**
   * One frame of both sunlight layers.
   *
   * The sparkle field is spawned across the CAMERA'S CURRENT VIEW rather than
   * across the world, which is what keeps fifteen flecks feeling like enough:
   * spread over the whole farm they would be invisible, and the player only
   * ever sees one screenful. It also means the budget is a budget on what is
   * drawn, not on what exists.
   */
  private animateSunlight(time: number, delta: number): void {
    const rays = this.godRays;
    if (rays) {
      const cam = this.cameras.main;
      // Same zoom correction the vignette needs: a scrollFactor(0) object is
      // still scaled about the camera's centre, so holding a constant
      // apparent size means dividing the display size by zoom.
      rays.setPosition(cam.width / 2, cam.height / 2);
      rays.setDisplaySize(cam.width / cam.zoom + 2, cam.height / cam.zoom + 2);
      // The ONE place the layer's opacity is set, and it is clamped inside
      // godRayAlpha rather than here -- see lib/stackacres/sunlight.ts.
      rays.setAlpha(godRayAlpha(time));
    }

    if (this.sparkleSprites.length === 0) return;
    const view = this.cameras.main.worldView;
    this.sparkles = sparkleField(
      this.sparkles,
      { x: view.x, y: view.y, width: view.width, height: view.height },
      delta,
      this.random,
    );
    for (let i = 0; i < this.sparkleSprites.length; i += 1) {
      const sprite = this.sparkleSprites[i];
      const sparkle = this.sparkles[i];
      if (!sparkle) {
        sprite.setVisible(false);
        continue;
      }
      const size = sparkleScale(sparkle);
      sprite.setVisible(true);
      sprite.setPosition(sparkle.x, sparkle.y);
      // Depth is the world y of a thing's feet everywhere in this scene, and a
      // fleck of light lies ON the ground -- so it sorts at its own y and
      // passes behind anything standing in front of it.
      sprite.setDepth(sparkle.y);
      sprite.setAlpha(sparkleAlpha(sparkle));
      sprite.setDisplaySize(size, size);
      sprite.setRotation(sparkle.spin + time / 2200);
    }
  }

  private fitVignette(): void {
    const vignette = this.vignette;
    if (!vignette) return;
    const cam = this.cameras.main;
    vignette.setPosition(cam.width / 2, cam.height / 2);
    vignette.setDisplaySize(cam.width / cam.zoom + 2, cam.height / cam.zoom + 2);
  }

  /**
   * Fades each edge nudge in as the view nears that edge of `worldBounds`,
   * and holds it at a fixed spot on screen at any zoom.
   *
   * A scrollFactor(0) object is still scaled by the camera's zoom around the
   * camera's own origin (cam.width/2, cam.height/2) -- the exact reason
   * `fitVignette` has to divide its display SIZE by zoom to hold a constant
   * apparent size. An off-centre object needs the same correction applied to
   * its POSITION: its offset from that centre has to be pre-divided by zoom
   * too, or it drifts toward the corners as the player zooms in.
   */
  private fitEdgeGuides(): void {
    const guides = this.edgeGuides;
    const bounds = this.worldBounds;
    if (!guides || !bounds) return;
    const cam = this.cameras.main;
    const view = this.viewRect();

    const distW = Math.max(0, view.x - bounds.x);
    const distE = Math.max(0, bounds.x + bounds.width - (view.x + view.width));
    const distN = Math.max(0, view.y - bounds.y);
    const distS = Math.max(0, bounds.y + bounds.height - (view.y + view.height));
    // How close counts as "near": the same margin the boundary itself was
    // padded by (./bounds.ts), so the nudge starts appearing right as the
    // view enters the ring of woodland that padding exists to leave standing.
    const near = (dist: number) => 1 - Math.min(1, dist / WORLD_BOUND_MARGIN);

    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const inset = Math.min(cam.width, cam.height) * 0.12;
    const size = Math.min(cam.width, cam.height) * 0.09;
    const place = (image: Phaser.GameObjects.Image, screenX: number, screenY: number, alpha: number) => {
      image.setPosition(cx + (screenX - cx) / cam.zoom, cy + (screenY - cy) / cam.zoom);
      image.setDisplaySize(size / cam.zoom, (size * (20 / 32)) / cam.zoom);
      image.setAlpha(alpha);
    };
    place(guides.w, inset, cy, near(distW));
    place(guides.e, cam.width - inset, cy, near(distE));
    place(guides.n, cx, inset, near(distN));
    place(guides.s, cx, cam.height - inset, near(distS));
  }

  update(time: number, delta: number): void {
    this.now = time;
    this.coast(delta);
    this.tendWorld();
    this.fitVignette();
    this.fitEdgeGuides();
    this.notifyViewMoved();
    if (this.options.reducedMotion) return;

    this.animateSunlight(time, delta);
    this.animatePond(time);
    this.walkHerds(delta);
    this.walkFarmhand(delta);
    this.regrowMeadow();
    if (this.blades) this.blades.rotation = time * WINDMILL_SPEED;

    // Every owned animal, one tick of its day -- the same wander
    // `stepCritter` drives everywhere else on this map, just one critter per
    // unit instead of several sharing a pen, so there is no within-unit
    // depth sort left to do (the old `sortPen` is gone with it).
    for (const node of this.nodes.values()) {
      const critter = node.critter;
      const gait = node.gait;
      const stock = node.unit.stock;
      // A crop, or a mucked unit: nothing wanders. The `isLivestock` check is
      // what narrows `stock` for STOCK_ART below; the other two are the real
      // test and hold for exactly the same units.
      if (!critter || !gait || !isLivestock(stock)) continue;
      const speed = critterSpeed(stock);
      if (node.unit.state === "hungry") {
        // A hungry animal has stopped, and standing still is the picture of
        // that -- it does not even breathe. Its gait is still stepped, so a
        // lean it went hungry in eases out instead of freezing at an angle.
        node.gait = stepGait(gait, false, speed, delta);
        node.sprite.setRotation(node.gait.roll);
        continue;
      }
      node.critter = stepCritter(critter, growAreaInterior(stockZone(stock)), speed, delta, this.random);
      const walking = node.critter.mode === "walk";
      node.gait = stepGait(gait, walking, speed, delta);
      // The container tracks the animal's true ground position and the sprite
      // sits at the container's own origin -- no vertical offset anywhere, so
      // the animal never leaves the grass or its shadow (a fixed local child,
      // see `buildUnit`). The stride is the roll instead, turning about the
      // feet the painter anchors it by.
      const at = isoProject(node.critter.x, node.critter.y);
      node.container.setPosition(at.x, at.y);
      node.container.setDepth(this.depthAt(node.critter.x, node.critter.y));
      node.sprite.setRotation(node.gait.roll);
      // A standing animal breathes, slowly and out of step with its
      // neighbours; a walking one is simply its own size.
      const breath = walking ? 0 : Math.sin(time / 420 + node.phase) * 0.022;
      const mirror = mirrorFor(STOCK_ART[stock], node.critter.facing);
      node.sprite.setScale((mirror * (1 - breath * 0.5)) / S, (1 + breath) / S);
    }
  }
}
