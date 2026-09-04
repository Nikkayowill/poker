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
  chunkScenery,
  clampZoom,
  critterSpeed,
  cropSpot,
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
  ART_FRAME,
  ART_SCALE,
  GRASS_PX,
  PAINTERS,
  bakeArt,
  bakeGrass,
  bakeVignette,
  type PainterName,
} from "./stackacres-art";
import { SPRITE_ART, SPRITE_NAMES, spriteLoadKey } from "./stackacres-sprites";
import { rampHex } from "./art-palette";
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
 * stock, not plots") -- buying and tending a unit is a DOM sidebar
 * (stackacres-district-panel.tsx), not a tap on the canvas, so the scene has
 * no plot-tap or sweep callbacks left at all: it draws the farm and reports
 * once when the first frame is up, and that is the entire contract with the
 * shell now.
 *
 * The HUD, the toolbelt and the district sidebar are NOT in here. They stay
 * as DOM, pinned over the canvas by CSS, because a `<button>` is reachable by
 * a screen reader and a thumb alike, and a Phaser Text object is neither.
 * Those overlays are siblings of the canvas host rather than children of it,
 * so a press on one never reaches the map at all -- which is also why
 * Phaser's own input is switched off entirely (see stackacres-world.tsx) and
 * every gesture is read straight off the host element with native pointer
 * events. See `bindInput` for why that matters more than tidiness. The one
 * gesture still read straight off the canvas is the scythe's mow-drag -- the
 * Long Meadow's grass is not a unit and has no sidebar row, so cutting it is
 * still something you do to the ground itself.
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
  state: "working" | "hungry" | "ready" | "mucked";
  /** 0..1 while working, 1 once ready, null while mucked. */
  progress: number | null;
  /** True once bought outright with Gold -- drawn no differently, kept only
   *  because it is part of what makes a unit's own picture change (see
   *  `signatureOf`), the same way it was on the old cell. */
  permanent: boolean;
}

export interface StackAcresSceneCallbacks {
  /** Fired once the first frame with units on it has been drawn. */
  onReady: () => void;
}

export interface StackAcresSceneOptions {
  reducedMotion: boolean;
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

/** How far a finger may wander before a press stops counting as a tap. In CSS
 *  pixels, because pointer events are. */
const TAP_SLOP = 8;
/**
 * Shortest gap between two scythe swishes. A little under the cue's own
 * length, so a continuous sweep overlaps into one sustained cut rather than
 * sounding like separate chops.
 */
const SWISH_GAP_MS = 190;

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
      return [0.6, 0.9];
    case "log":
      return [0.7, 0.5];
    case "boulder":
      return [0.85, 0.7];
    default:
      return [0.9, 0.9];
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
  state: Critter;
  /** Out-of-phase idle breathing, so four oxen do not pulse in unison. */
  phase: number;
}

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
  /** Out-of-phase gait/breathing offset, so units of the same kind never
   *  move in lockstep. */
  phase: number;
  tweens: Phaser.Tweens.Tween[];
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
    this.paintZoneGround();
    this.paintPaths();
    this.paintPond();
    this.paintBarn();
    this.paintProps();
    this.spawnHerds();
    // Every district's grow-area floor and (for livestock) fence, painted
    // once each here -- see the "Units" section below for why this replaces
    // the old per-plot fence-merge rather than adapting it.
    for (const id of ZONE_IDS) this.paintDistrictBoundary(id);

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
   * Painted once at boot and never again: the districts do not move, and the
   * whole set is a few hundred fills.
   */
  private paintZoneGround(): void {
    for (const id of OUTER_ZONE_IDS) {
      const tiles = zoneGroundTiles(id);
      if (tiles.length === 0) continue;
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
    }
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
        this.herds.push({ sprite, shadow, state, phase: random() * Math.PI * 2 });
      }
    }
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
      const crop = unit.stock === "cash_crop" ? "corn" : "carrot";
      sprite = this.addLocal(`${crop}${stage}` as PainterName, 0, 0, container);
      const screen = isoProject(at.x, at.y);
      container.setPosition(screen.x, screen.y);
      container.setDepth(this.depthAt(at.x, at.y));
    }

    const ring = this.add.graphics();
    container.add(ring);

    const node: UnitNode = {
      container,
      ring,
      sprite,
      critter,
      phase: this.random() * Math.PI * 2,
      tweens: [],
      signature,
      unit,
    };
    this.paintUnitRing(node, unit);
    if (unit.state === "ready" && !isLivestock(unit.stock)) this.bob(node, [sprite]);
    this.nodes.set(unit.id, node);
  }

  private destroyNode(node: UnitNode): void {
    for (const tween of node.tweens) tween.remove();
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
  private paintDistrictBoundary(zone: ZoneId): void {
    const area = growAreaBounds(zone);
    const livestock = stocksInZone(zone).find((stock) => isLivestock(stock));
    if (!livestock) {
      // No livestock kind here at all -- the Long Meadow's Crop Fields,
      // tilled and furrowed, no fence.
      this.paintAreaGround(area, "soil", true);
      return;
    }
    const ground = livestock === "cattle" ? "soil" : livestock === "pig" ? "muck" : "straw";
    this.paintAreaGround(area, ground);

    // Every rail gets its own true world position and the ordinary
    // `put()` depth (feet-based), so a wandering animal sorts correctly
    // against it on its own -- in front of the near rail, behind the far
    // one -- with no back/front split needed the way the old per-plot fence
    // required to keep its own animals from drawing over their own gate.
    const step = 16;
    const midX = Math.round(area.width / 2 / step) * step;
    for (let x = 0; x < area.width; x += step) {
      this.put("railH", area.x + x, area.y).setRotation(ISO_EDGE_ANGLE.alongX);
      const isGate = Math.abs(x - midX) < step / 2;
      this.put(isGate ? "gate" : "railH", area.x + x, area.y + area.height - 9).setRotation(
        ISO_EDGE_ANGLE.alongX,
      );
    }
    for (let y = 12; y < area.height - 10; y += step) {
      this.put("railV", area.x, area.y + y).setRotation(ISO_EDGE_ANGLE.alongY);
      this.put("railV", area.x + area.width - 9, area.y + y).setRotation(ISO_EDGE_ANGLE.alongY);
    }
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
   */
  private paintAreaGround(area: WorldRect, kind: "straw" | "soil" | "muck", furrowed = false): void {
    const corners = projectedCorners(area);
    const ramp = rampHex(kind);
    const g = this.add.graphics().setDepth(GROW_AREA_GROUND_DEPTH);
    g.fillStyle(ramp.top, 1);
    g.beginPath();
    g.moveTo(corners.n.x, corners.n.y);
    g.lineTo(corners.e.x, corners.e.y);
    g.lineTo(corners.s.x, corners.s.y);
    g.lineTo(corners.w.x, corners.w.y);
    g.closePath();
    g.fillPath();
    g.lineStyle(1, ramp.rim, 0.55);
    g.strokePath();
    if (furrowed) this.paintFurrows(g, area);
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
    return 12;
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
      unit.state === "ready" ? GOLD : unit.state === "hungry" ? AMBER : unit.state === "mucked" ? MUCK : null;
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
      }
      // Any other tap on the canvas does nothing: buying and tending a unit
      // is entirely the district sidebar's job now, and the map is just a
      // picture of the farm to look around in.
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
  /* Effects                                                           */
  /* ---------------------------------------------------------------- */

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
            .setScale(wide / S, tall / S)
            .setAlpha(0.8),
        );
      }
      items.push(this.put(item.kind, item.x, item.y, item.y));
    }

    for (const item of zoneScenery(cx, cy)) {
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
  private walkHerds(time: number, delta: number): void {
    for (const animal of this.herds) {
      const herd = this.herdFor(animal);
      if (!herd) continue;
      animal.state = stepCritter(animal.state, herd.range, herd.speed, delta, this.random);
      const walking = animal.state.mode === "walk";
      // An ox is heavy: its stride is a slower, shallower bob than a hen's.
      const bob = walking ? Math.abs(Math.sin(time / 150 + animal.phase)) * 0.8 : 0;
      const at = isoProject(animal.state.x, animal.state.y);
      animal.sprite.setPosition(at.x, at.y - bob);
      animal.sprite.setDepth(at.y);
      animal.sprite.setFlipX(animal.state.facing < 0);
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
    const wall = Date.now();
    let cut = false;
    for (const tile of mowStroke(from, to)) {
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
    if (this.options.reducedMotion) return;

    this.animatePond(time);
    this.walkHerds(time, delta);
    this.regrowMeadow();
    if (this.blades) this.blades.rotation = time * WINDMILL_SPEED;

    // Every owned animal, one tick of its day -- the same wander
    // `stepCritter` drives everywhere else on this map, just one critter per
    // unit instead of several sharing a pen, so there is no within-unit
    // depth sort left to do (the old `sortPen` is gone with it).
    for (const node of this.nodes.values()) {
      const critter = node.critter;
      if (!critter) continue; // a crop, or a mucked unit: nothing wanders.
      // A hungry animal has stopped. Standing still is the picture of that.
      if (node.unit.state === "hungry") continue;
      const zone = stockZone(node.unit.stock);
      const bounds = growAreaInterior(zone);
      const speed = critterSpeed(node.unit.stock);
      node.critter = stepCritter(critter, bounds, speed, delta, this.random);
      const walking = node.critter.mode === "walk";
      const hop = walking ? Math.abs(Math.sin(time / 90 + node.phase)) * 1.2 : 0;
      const at = isoProject(node.critter.x, node.critter.y);
      // The container tracks the animal's true ground position; the hop is
      // a screen-space bounce applied only to the sprite's own local
      // offset, so the shadow (a fixed local child, see `buildUnit`) never
      // bounces with it.
      node.container.setPosition(at.x, at.y);
      node.container.setDepth(this.depthAt(node.critter.x, node.critter.y));
      node.sprite.setPosition(0, -hop);
      node.sprite.setFlipX(node.critter.facing === 1);
      // A standing animal breathes, slowly and out of step with its
      // neighbours; a walking one is simply its own size.
      const breath = walking ? 0 : Math.sin(time / 420 + node.phase) * 0.022;
      node.sprite.setScale((1 - breath * 0.5) / S, (1 + breath) / S);
    }
  }
}
