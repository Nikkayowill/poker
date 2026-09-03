// A namespace import, not a default one: the package's ESM build (what the
// bundler picks for the browser) has only named exports, and `import Phaser
// from "phaser"` fails at build time with "export default doesn't exist".
import * as Phaser from "phaser";
import { isLivestock, type StackAcresStock } from "@/lib/stackacres/catalogue";
import {
  ISO_EDGE_ANGLE,
  isoProject,
  isoUnproject,
  projectedBounds,
  projectedCorners,
  unprojectBoundsApprox,
  type DiamondCorners,
} from "@/lib/stackacres/iso";
import { FARM_PATHS } from "@/lib/stackacres/paths";
import type { StackAcresPlotState } from "@/lib/stackacres/plots";
import { PROP_SHADOW, WINDMILL_SPEED, YARD_PROPS } from "@/lib/stackacres/props";
import type { PlotAffordance, StackAcresTool } from "@/lib/stackacres/tools";
import { DOCK, DUCK_ORBIT, LILY_PADS, POND, REEDS, RIPPLE_SPOTS } from "@/lib/stackacres/water";
import {
  MEADOW_TILE,
  OUTER_ZONE_IDS,
  STACKACRES_ZONES,
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
  STACKACRES_CELL,
  STACKACRES_CHUNK,
  STACKACRES_MARGIN,
  cellCenter,
  cellOrigin,
  cellRect,
  chunkScenery,
  clampZoom,
  clearedLayout,
  critterCount,
  critterSpeed,
  growthStage,
  openingZoom,
  ownedBounds,
  penInterior,
  plotIndexAt,
  scrollToKeepUnderPointer,
  seededRandom,
  spawnCritter,
  stepCritter,
  thicketLayout,
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
  bakeGrass,
  bakeTexture,
  bakeVignette,
  type PainterName,
} from "./stackacres-art";
import { rampHex } from "./art-palette";
import { bakePathTexture } from "./art-paths";
import { bakePondTexture } from "./art-water";

/**
 * The farm as a place you look around in.
 *
 * One Phaser scene draws the whole world -- the barn yard, every plot, the
 * animals, and the woodland the farm was cut out of -- and the camera is what
 * the player moves: drag to pan, pinch or wheel to zoom. The camera is
 * unbounded. Roaming off the edge of the farm is not an error state to fence
 * off, it is the point of drawing a map instead of a grid, so the world past
 * the fence is grown in chunks around wherever the camera is (`tendWorld`) and
 * thrown away again once it is well out of sight.
 *
 * Nothing is downloaded. Every picture is a Canvas2D painter from
 * ./stackacres-art.ts, baked once at boot into a texture at ART_SCALE device
 * pixels per unit and then only ever scaled DOWN by the camera, which is what
 * keeps it smooth at 5x where a 16px tile sheet went to mush.
 *
 * This file paints. It owns no rules: every cell arrives already decided
 * (state, what the held tool would do, whether it is selected) from the React
 * shell, which computed those with lib/stackacres/tools.ts exactly as the old
 * grid did. The scene's only outputs are "the player tapped plot N" and "the
 * player tapped grass".
 *
 * The HUD, the toolbelt and the store are NOT in here. They stay as DOM,
 * pinned over the canvas by CSS, because a `<button>` is reachable by a
 * screen reader and a thumb alike, and a Phaser Text object is neither. Those
 * overlays are siblings of the canvas host rather than children of it, so a
 * press on one never reaches the map at all -- which is also why Phaser's own
 * input is switched off entirely (see stackacres-world.tsx) and every gesture
 * is read straight off the host element with native pointer events. See
 * `bindInput` for why that matters more than tidiness.
 *
 * Three coordinate systems meet here and it matters which one is in hand.
 *
 * `world.ts` space is the true Cartesian plane every game rule lives in: a
 * plot is a CELL-square at `cellOrigin(index)`, an animal walks a rectangle,
 * `plotIndexAt` is a plain divide. Nothing in that file, or in `paths.ts` /
 * `water.ts` / `props.ts`, knows the camera is isometric -- it never has to.
 *
 * `iso.ts` is the seam: `isoProject` turns a world point into the sheared,
 * diamond-tiled space this scene actually draws into ("scene space" below),
 * and `isoUnproject` is its exact inverse. Every literal world-space number
 * this file reads from `world.ts`/`paths.ts`/`water.ts`/`props.ts` -- a
 * plot's origin, a prop's feet, an animal's walk position -- goes through
 * `isoProject` before it becomes a Phaser position or a depth key. Every
 * point Phaser hands back (a pointer's world point, `cam.getWorldPoint`)
 * goes through `isoUnproject` before it is allowed near `plotIndexAt` or any
 * other `world.ts` function. `put()` and `buildCell`'s cell-local `img`/
 * `shadow` closures do this once, at the seam, so most of the file below
 * just calls them with plain world-space numbers exactly as it did before
 * the camera tilted.
 *
 * On top of that, the canvas is DPR times denser than the screen (that
 * density is what makes the vector art crisp), so Phaser's camera width and
 * zoom are in device pixels, while a pointer event and everything the DOM
 * shell hands over or gets back -- the ghost's position, the tracked plot's
 * rectangle -- are in CSS pixels. The `viewW`/`viewH`/`zoomL`/`toScreen`
 * helpers are the CSS-pixel side; the `cam.*` values are the device-pixel
 * side. `toScreen`'s own input is scene space, same as `cam.*`.
 */

export interface StackAcresSceneCell {
  plotIndex: number;
  state: StackAcresPlotState;
  stock: StackAcresStock | null;
  /** 0..1 while working, 1 once ready, null otherwise. */
  progress: number | null;
  /** What the held tool would do here, from lib/stackacres/tools.ts. */
  afford: PlotAffordance["kind"];
  selected: boolean;
  purchasable: boolean;
  unlockPrice: number | null;
}

/** Where a plot sits on the canvas, in CSS pixels, plus the canvas size. */
export interface PlotScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
}

export interface StackAcresSceneCallbacks {
  onTapPlot: (plotIndex: number) => void;
  onTapGround: () => void;
  /**
   * Fired once per plot, in crossing order, as a tool-sweep drag walks over
   * it -- only for a plot the scene already knows the held tool can act on
   * (`afford === "act"`); a plot it has no business with is skipped. The
   * shell runs the same action a tap on that plot would.
   */
  onSweepPlot: (plotIndex: number) => void;
  /** Fired once the first frame with plots on it has been drawn. */
  onReady: () => void;
  /**
   * Where the tracked plot (see `trackPlot`) is on screen, whenever that
   * changes -- a pan, a zoom, a resize. Null once tracking stops. The shell
   * hangs the detail card off this so the card follows the plot it is about.
   */
  onTrackedRect: (rect: PlotScreenRect | null) => void;
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

const CELL = STACKACRES_CELL;
const S = ART_SCALE;

/** Chrome colours, as the canvas needs them. Same values as 01-tokens.css. */
const GOLD = 0xffd23f;
const VIOLET = 0xb26bff;
const RED = 0xdc1413;
const AMBER = 0xff8a3d;
const MUCK = 0x785830;
const CHALK = 0xf3eefc;

/** How far a finger may wander before a press stops counting as a tap. In CSS
 *  pixels, because pointer events are. */
const TAP_SLOP = 8;

/** Inertia after a flick. Speeds are CSS pixels per millisecond. */
const FLICK_WINDOW_MS = 80;
/** Anything faster than this was a swipe at the screen, not a throw. */
const FLICK_SPEED_CAP = 4;
const FLICK_SPEED_MIN = 0.12;
/** Per 16ms, so the coast is frame-rate independent. */
const GLIDE_DECAY = 0.92;
const GLIDE_STOP = 0.02;

// The barn stands north of the first row of plots with a yard between: its
// feet are on y 34, thirty units above the plot square, and the lane and
// road (lib/stackacres/paths.ts) run through that gap. Its roof reaches
// BARN_TOP, which is what "home" has to frame as well as the plots themselves.
const BARN_X = STACKACRES_MARGIN + 44;
const BARN_Y = STACKACRES_MARGIN - 30;
const BARN_TOP = BARN_Y - 66;

// Ground art sits just above the grass and well below anything with feet:
// the paths at -1e8, the pond one above them so its sand paints over the
// spur's end cap, and the water's surface (glints, ripples) one above that.
/** The districts' own ground sits under the paths: a road is laid ON a
 *  field, so the field has to be beneath it, and both are above the lawn. */
const ZONE_GROUND_DEPTH = -1e8 - 10;
const PATH_DEPTH = -1e8;
const POND_DEPTH = PATH_DEPTH + 1;
const POND_SURFACE_DEPTH = PATH_DEPTH + 2;

/** How many glints drift across the pond at once. */
const GLINT_COUNT = 5;

/** Which animal stands in which pen. */
const STOCK_ART: Partial<Record<StackAcresStock, PainterName>> = {
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

/** What the player is dragging out of the seed strip, as a picture. */
const GHOST_ART: Record<StackAcresStock, PainterName> = {
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
  sprout: "carrot2",
  cash_crop: "corn2",
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
 * (the map moves) or a sweep (the held tool walks across every actionable
 * plot the finger crosses) -- which one is decided once, at that moment, by
 * whether the plot under the *original* press was one the tool had business
 * with.
 */
interface DragGesture {
  kind: "press" | "pan" | "sweep" | "mow";
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** The last ~80ms of movement, which is what the flick is measured from. */
  trail: TrailPoint[];
  /** The plot under the finger at pointerdown, and what the held tool would
   *  do there. `null`/`"none"` for a press that started on ground -- that
   *  always pans, the same as it always has. */
  startPlot: number | null;
  startAfford: PlotAffordance["kind"];
  /** Plots this sweep has already fired on. Only a sweep gesture has one;
   *  set the moment `kind` becomes `"sweep"`, so re-crossing a plot later in
   *  the same drag can never trigger it twice. */
  visited?: Set<number>;
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

interface CritterNode {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  state: Critter;
  /** How far off the ground a tap has bounced it, in world units. Tweened;
   *  update() folds it into the sprite's y, which it otherwise owns. */
  lift: number;
  /** Offsets this animal's gait and breathing so a pen never moves in
   *  lockstep. */
  phase: number;
}

interface CellNode {
  container: Phaser.GameObjects.Container;
  /** State ring: ready, hungry, mucked, selected. */
  ring: Phaser.GameObjects.Graphics;
  /** Affordance ring, pulsed separately so the state ring stays still. */
  afford: Phaser.GameObjects.Graphics;
  progress: Phaser.GameObjects.Graphics;
  progressValue: number;
  critters: CritterNode[];
  /** Index in the container's list where the first animal sprite sits; the
   *  sprites are a contiguous block from there, re-ordered by y each frame. */
  spriteSlot: number;
  /** The draw order the animals were last put in, as critter indexes. */
  order: number[];
  /** Every plant in a field, for the tap ripple. */
  plants: Phaser.GameObjects.Image[];
  bobbing: Phaser.GameObjects.GameObject[];
  tweens: Phaser.Tweens.Tween[];
  /** Scene time until which a tap's bounce owns the sprites' scale. */
  juiceUntil: number;
  signature: string;
  cell: StackAcresSceneCell;
}

function signatureOf(cell: StackAcresSceneCell): string {
  const stage = growthStage(cell.progress, cell.state === "ready");
  return [
    cell.state,
    cell.stock ?? "",
    stage,
    cell.afford,
    cell.selected ? 1 : 0,
    cell.purchasable ? 1 : 0,
    cell.unlockPrice ?? "",
  ].join("|");
}

export class StackAcresScene extends Phaser.Scene {
  private readonly callbacks: StackAcresSceneCallbacks;
  private readonly options: StackAcresSceneOptions;
  private nodes = new Map<number, CellNode>();
  private cells: StackAcresSceneCell[] = [];
  private pending: StackAcresSceneCell[] | null = null;
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

  private grass: Phaser.GameObjects.TileSprite | null = null;
  private clouds: Phaser.GameObjects.Image[] = [];
  /** The screen-pinned wash over everything: darker corners, warm sun corner. */
  private vignette: Phaser.GameObjects.Image | null = null;
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
   *  Driven by the same `stepCritter` the pens use. */
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

  private ghost: Phaser.GameObjects.Image | null = null;
  private ghostRing: Phaser.GameObjects.Graphics | null = null;

  /** The held tool's own picture, floating over a finger that is mid-sweep.
   *  Unlike `ghost` it never snaps to a cell -- a sweep crosses many plots,
   *  so it just follows the finger. */
  private toolGhost: Phaser.GameObjects.Image | null = null;
  private toolGhostTween: Phaser.Tweens.Tween | null = null;
  private toolIconName: PainterName = "ico-look";
  /** The held tool. Only the scythe changes what a gesture MEANS here; every
   *  other tool reaches the scene as a plot's `afford` instead. */
  private tool: StackAcresTool = "inspect";

  private tracked: number | null = null;
  private trackedKey = "";

  /** Tweens made while a node is being built, claimed by it in paintRings. */
  private pendingTweens: Phaser.Tweens.Tween[] = [];

  constructor(callbacks: StackAcresSceneCallbacks, options: StackAcresSceneOptions) {
    super({ key: "StackAcresScene" });
    this.callbacks = callbacks;
    this.options = options;
  }

  create(): void {
    // Every texture is drawn here, at boot: there is no preload and no
    // network. Most icons are still painted straight into DOM canvases by
    // stackacres-icon.tsx and never need a Phaser texture -- but the toolbelt
    // set also has to exist here, as the picture `toolGhost` floats over a
    // finger mid-sweep, so all of PAINTERS is baked now.
    for (const name of Object.keys(PAINTERS) as PainterName[]) {
      bakeTexture(this, name);
    }
    bakeGrass(this);

    // Depth is the world y of a thing's feet, so it can go far negative north
    // of the farm: the grass has to sit below anything the player can roam to.
    this.grass = this.add.tileSprite(0, 0, 100, 100, "grass").setOrigin(0).setDepth(-1e9);
    this.grass.tileScaleX = 1 / GRASS_PX;
    this.grass.tileScaleY = 1 / GRASS_PX;

    // Districts before paths: a road is laid on a field, and the ground the
    // road runs over has to exist underneath it.
    this.paintZoneGround();
    this.paintPaths();
    this.paintPond();
    this.paintBarn();
    this.paintProps();
    this.spawnHerds();

    this.ghostRing = this.add.graphics().setDepth(9000).setVisible(false);
    this.ghost = this.add
      .image(0, 0, "hen", ART_FRAME)
      .setOrigin(0.5, 1)
      .setScale(1.3 / S)
      .setDepth(9001)
      .setVisible(false);
    this.toolGhost = this.add
      .image(0, 0, this.toolIconName, ART_FRAME)
      .setOrigin(0.5, 1)
      .setScale(1.5 / S)
      .setDepth(9001)
      .setVisible(false);
    for (let i = 0; i < 3; i += 1) {
      this.clouds.push(
        this.add
          .image(0, 0, "cloud", ART_FRAME)
          .setScale(1 / S)
          .setDepth(8000)
          .setAlpha(this.options.reducedMotion ? 0 : 1),
      );
    }
    // Pinned to the screen, not the world, and above every world object
    // (the DOM chrome is a separate layer entirely, so nothing of the
    // player's is under it). Sized to the camera in update().
    this.vignette = this.add
      .image(0, 0, bakeVignette(this))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1e9);

    this.bindInput();

    this.created = true;
    if (this.pending) {
      const cells = this.pending;
      this.pending = null;
      this.setPlots(cells);
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
  // The baked texture is still the flat top-down ribbon it always was --
  // reshaping it to the diamond grid's own edge directions is follow-up
  // work (see the class doc), not done in this pass. Only its anchor is
  // projected below, so it at least lands in the right place.
  private paintPaths(): void {
    FARM_PATHS.forEach((spec, i) => {
      const bake = bakePathTexture(this, spec, FARM_PATHS.slice(0, i));
      if (!bake) return;
      const s = isoProject(bake.x, bake.y);
      this.add
        .image(s.x, s.y, bake.key, ART_FRAME)
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
      // Same trade-off as paintPaths: the shore texture stays flat for now,
      // only its anchor is projected.
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
   * Unlike the rest of the world's art, the barn and silo are not baked
   * painters: they are the two structures closest to the camera and the
   * ones a flat plan icon read worst on ("basic poly" was mostly this), so
   * they are drawn here as real isometric volumes -- walls, a roof, a door
   * and a window -- direct with Phaser Graphics, matching the mockup this
   * pass was previewed and approved against.
   */
  private paintBarn(): void {
    this.put("shadow", BARN_X, BARN_Y + 1, this.depthAt(BARN_X, BARN_Y, -100))
      .setScale(3.4 / S, 1.6 / S)
      .setAlpha(0.9);

    const g = this.add.graphics().setDepth(this.depthAt(BARN_X, BARN_Y + 17));
    const barnColor = rampHex("roof").side;
    const barnFootprint = this.isoFootprint(BARN_X, BARN_Y, 46, 34);
    const barnTop = this.drawIsoWalls(g, barnFootprint, 42, barnColor);

    // Door: a filled quad on the near-left wall, a third of the way along
    // it, running from the ground to two-thirds of the wall's own height.
    const mix = (a: WorldPoint, b: WorldPoint, k: number): WorldPoint => ({
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
    });
    const doorBaseA = mix(barnFootprint.w, barnFootprint.s, 0.38);
    const doorBaseB = mix(barnFootprint.w, barnFootprint.s, 0.62);
    const doorTopA = mix(barnTop.w, barnTop.s, 0.38);
    const doorTopB = mix(barnTop.w, barnTop.s, 0.62);
    const doorMidA = mix(doorBaseA, doorTopA, 0.62);
    const doorMidB = mix(doorBaseB, doorTopB, 0.62);
    g.fillStyle(rampHex("muck").rim, 1);
    g.beginPath();
    g.moveTo(doorBaseA.x, doorBaseA.y);
    g.lineTo(doorBaseB.x, doorBaseB.y);
    g.lineTo(doorMidB.x, doorMidB.y);
    g.lineTo(doorMidA.x, doorMidA.y);
    g.closePath();
    g.fillPath();

    // Window: a small pale quad on the near-right wall.
    const winBaseA = mix(barnFootprint.s, barnFootprint.e, 0.2);
    const winBaseB = mix(barnFootprint.s, barnFootprint.e, 0.4);
    const winTopA = mix(barnTop.s, barnTop.e, 0.2);
    const winTopB = mix(barnTop.s, barnTop.e, 0.4);
    const winLoA = mix(winBaseA, winTopA, 0.35);
    const winLoB = mix(winBaseB, winTopB, 0.35);
    const winHiA = mix(winBaseA, winTopA, 0.75);
    const winHiB = mix(winBaseB, winTopB, 0.75);
    g.fillStyle(rampHex("cream").top, 1);
    g.beginPath();
    g.moveTo(winLoA.x, winLoA.y);
    g.lineTo(winLoB.x, winLoB.y);
    g.lineTo(winHiB.x, winHiB.y);
    g.lineTo(winHiA.x, winHiA.y);
    g.closePath();
    g.fillPath();

    this.drawIsoGableRoof(g, barnTop, 20, rampHex("cream").top);

    // Silo: a plain cylinder-ish box (no gable) with a shallow domed cap,
    // standing where the flat barn's own silo painter used to.
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
   * everything else. The windmill is the one prop drawn as an isometric
   * volume rather than the flat baked painter (see `paintWindmill`) -- its
   * tower is the second-tallest thing in the yard after the barn, so a flat
   * plan icon read just as wrong on it.
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
   * A volumetric tower standing in for the flat windmill painter, with the
   * existing baked `windmillBlades` sprite pinned to its cap so update()'s
   * per-frame rotation still just works. The blades' screen position is
   * computed straight from the tower's own already-projected cap -- not fed
   * through `put()`'s projection a second time -- because "56 units above
   * the feet" is a vertical offset in screen terms, and shearing it through
   * `isoProject` the way a ground-plane offset needs to would also drag it
   * sideways by exactly as much (see the class doc's note on the three
   * coordinate systems).
   */
  private paintWindmill(x: number, y: number): void {
    const g = this.add.graphics().setDepth(this.depthAt(x, y, 0.4));
    const footprint = this.isoFootprint(x, y, 20, 20);
    const top = this.drawIsoWalls(g, footprint, 62, rampHex("cream").side);
    const capCentre: WorldPoint = { x: (top.n.x + top.s.x) / 2, y: (top.n.y + top.s.y) / 2 };
    const peak: WorldPoint = { x: capCentre.x, y: capCentre.y - 22 };
    g.fillStyle(0x5a4530, 1);
    g.beginPath();
    g.moveTo(top.n.x, top.n.y);
    g.lineTo(top.e.x, top.e.y);
    g.lineTo(peak.x, peak.y);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x3c2e1f, 1);
    g.beginPath();
    g.moveTo(top.e.x, top.e.y);
    g.lineTo(top.s.x, top.s.y);
    g.lineTo(peak.x, peak.y);
    g.closePath();
    g.fillPath();

    const bladeFrame = PAINTERS.windmillBlades;
    this.blades = this.add
      .image(capCentre.x, capCentre.y - 12, "windmillBlades", ART_FRAME)
      .setOrigin(bladeFrame.ax, bladeFrame.ay)
      .setScale(1 / S)
      .setDepth(this.depthAt(x, y, 0.5));
  }

  /* ---------------------------------------------------------------- */
  /* Plots                                                             */
  /* ---------------------------------------------------------------- */

  setPlots(cells: StackAcresSceneCell[]): void {
    if (!this.created) {
      this.pending = cells;
      return;
    }
    const before = this.cells.length > 0 ? ownedBounds(this.cells) : null;
    this.cells = cells;

    for (const cell of cells) {
      const signature = signatureOf(cell);
      const existing = this.nodes.get(cell.plotIndex);
      if (existing && existing.signature === signature) {
        existing.cell = cell;
        this.paintProgress(existing, cell);
        continue;
      }
      this.buildCell(cell, signature, existing);
    }

    if (!this.opened) {
      this.opened = true;
      this.openCamera();
      this.callbacks.onReady();
      return;
    }
    // Land was bought: the acreage box grew. Glide to whatever just opened up.
    const after = ownedBounds(cells);
    if (before && (after.width > before.width || after.height > before.height)) {
      const owned = cells.filter((c) => c.state !== "locked");
      const newest = owned[owned.length - 1];
      if (newest) this.focusPlot(newest.plotIndex, true);
    }
  }

  private buildCell(
    cell: StackAcresSceneCell,
    signature: string,
    previous: CellNode | undefined,
  ): void {
    const origin = cellOrigin(cell.plotIndex);
    // Animals survive a repaint of their own pen (a ring changing, a clock
    // tick crossing a growth stage) so they do not all jump to new spots
    // every time the player changes tool.
    const carried =
      previous && previous.cell.stock === cell.stock && cell.stock !== null && isLivestock(cell.stock)
        ? previous.critters.map((c) => c.state)
        : [];
    if (previous) this.destroyNode(previous);

    const originScreen = isoProject(origin.x, origin.y);
    const container = this.add
      .container(originScreen.x, originScreen.y)
      .setDepth(this.depthAt(origin.x + CELL, origin.y + CELL));
    const node: CellNode = {
      container,
      ring: this.add.graphics(),
      afford: this.add.graphics(),
      progress: this.add.graphics(),
      progressValue: -1,
      critters: [],
      spriteSlot: -1,
      order: [],
      plants: [],
      bobbing: [],
      tweens: [],
      juiceUntil: 0,
      signature,
      cell,
    };

    // Cell-local placement: the container already sits at the plot's
    // projected origin, and a cell-local (x, y) is projected here the same
    // way -- `isoProject` is additive (iso.test.ts), so the two compose to
    // exactly where a caller means, without either side having to know
    // about the other's offset.
    const img = (name: PainterName, x: number, y: number): Phaser.GameObjects.Image => {
      const p = PAINTERS[name];
      const s = isoProject(x, y);
      const image = this.add
        .image(s.x, s.y, name, ART_FRAME)
        .setOrigin(p.ax, p.ay)
        .setScale(1 / S);
      container.add(image);
      return image;
    };
    const shadow = (x: number, y: number, sx = 1, sy = 1) =>
      img("shadow", x, y + 1)
        .setScale(sx / S, sy / S)
        .setAlpha(0.8);

    switch (cell.state) {
      case "locked":
        this.paintThicket(cell, img, shadow, container);
        break;
      case "empty":
        this.paintGroundDiamond(container, "mown");
        for (const item of clearedLayout(cell.plotIndex)) img(item.kind, item.x, item.y);
        break;
      case "mucked":
        this.paintGroundDiamond(container, "muckbed");
        img("puddle", 26, 30);
        img("rock", 52, 44);
        img("rock", 20, 62);
        shadow(60, 68, 0.5);
        img("stump", 60, 68);
        img("rock", 44, 22);
        break;
      default:
        if (cell.stock && isLivestock(cell.stock)) this.paintPen(node, cell, carried, img, shadow);
        else if (cell.stock) this.paintField(node, cell, img);
        break;
    }

    container.add([node.ring, node.afford, node.progress]);
    this.paintRings(node, cell);
    this.paintProgress(node, cell);
    this.nodes.set(cell.plotIndex, node);
  }

  private destroyNode(node: CellNode): void {
    for (const tween of node.tweens) tween.remove();
    node.container.destroy(true);
  }

  /**
   * A cell's own ground, as a diamond fill rather than the flat baked
   * rectangle painter used before: `mown`, `soil`, `straw` and `muckbed` are
   * each a whole CELL square, and a square texture repositioned onto a
   * diamond footprint would still render as a square, just floating at the
   * wrong angle. Colours are lifted from the flat painters of the same name
   * in stackacres-art.ts, so a plot reads as the same material, only tilted.
   * Drawn as the container's first child, same as the `img("mown", 0, 0)`
   * call it replaces, so everything else in the cell paints over it.
   */
  private paintGroundDiamond(
    container: Phaser.GameObjects.Container,
    kind: "mown" | "soil" | "straw" | "muckbed" | "wild",
  ): void {
    const corners = projectedCorners({ x: 0, y: 0, width: CELL, height: CELL });
    const g = this.add.graphics();
    const diamond = (fill: number, alpha: number, edge?: number): void => {
      g.fillStyle(fill, alpha);
      g.beginPath();
      g.moveTo(corners.n.x, corners.n.y);
      g.lineTo(corners.e.x, corners.e.y);
      g.lineTo(corners.s.x, corners.s.y);
      g.lineTo(corners.w.x, corners.w.y);
      g.closePath();
      g.fillPath();
      if (edge !== undefined) {
        g.lineStyle(1, edge, 0.55);
        g.strokePath();
      }
    };
    // Colours come from art-palette.ts, the same ramps the Canvas2D painters
    // bake with, so a plot's diamond and the props standing on it cannot
    // drift apart -- see that file's header for why one table and not two.
    switch (kind) {
      case "mown":
        // Solid now, not a wash. A cleared plot has to be the warmest, most
        // inviting thing in frame, and a translucent tint over the world
        // grass could only ever be a shade of whatever it sat on.
        diamond(rampHex("lawn").top, 1, rampHex("lawn").rim);
        break;
      case "soil":
        diamond(rampHex("soil").top, 1, rampHex("soil").rim);
        this.paintFurrows(g);
        break;
      case "straw":
        diamond(rampHex("straw").top, 1, rampHex("straw").rim);
        break;
      case "muckbed":
        diamond(rampHex("muck").top, 1, rampHex("muck").rim);
        break;
      case "wild":
        // Was a 12%-alpha near-black wash, which is what made an uncleared
        // plot read as a flat grey rectangle when zoomed out -- the open gap
        // CLAUDE.md has carried since the premium pass. It is a real green.
        diamond(rampHex("wild").top, 1, rampHex("wild").rim);
        break;
    }
    container.add(g);
  }

  /** Three furrow lines across a tilled plot, cell-local, drawn along the
   *  diamond's own grain so they read as rows rather than as stripes painted
   *  over the top of it. */
  private paintFurrows(g: Phaser.GameObjects.Graphics): void {
    const rows = 3;
    for (let r = 1; r <= rows; r += 1) {
      const k = r / (rows + 1);
      const a = isoProject(6, 6 + k * (CELL - 12));
      const b = isoProject(CELL - 6, 6 + k * (CELL - 12));
      g.lineStyle(1.1, 0x000000, 0.16);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
    }
  }

  /** Land nobody has cleared yet: trees, and a price sign on the one for sale. */
  private paintThicket(
    cell: StackAcresSceneCell,
    img: (name: PainterName, x: number, y: number) => Phaser.GameObjects.Image,
    shadow: (x: number, y: number, sx?: number, sy?: number) => Phaser.GameObjects.Image,
    container: Phaser.GameObjects.Container,
  ): void {
    this.paintGroundDiamond(container, "wild");
    // The layout is already sorted by y, litter interleaved with trees: sort
    // them separately and a pebble at the back paints over a tree in front.
    for (const item of thicketLayout(cell.plotIndex, cell.purchasable)) {
      if (!castsShadow(item.kind)) {
        img(item.kind, item.x, item.y);
        continue;
      }
      shadow(item.x, item.y, item.kind === "bush" ? 0.55 : 0.75);
      img(item.kind, item.x, item.y).setScale(0.82 / S);
    }
    if (cell.purchasable) {
      // Barely lifted, not tinted: the plot for sale should read as the same
      // wood as everything beyond it, just standing in daylight.
      for (const child of container.list) {
        if (child instanceof Phaser.GameObjects.Image && child.texture.key !== "wild") {
          child.setAlpha(0.92);
        }
      }
      if (cell.unlockPrice !== null) container.add(this.priceSign(cell.unlockPrice));
      return;
    }
    for (const child of container.list) {
      if (child instanceof Phaser.GameObjects.Image) child.setTint(0xcfd8c4);
    }
  }

  /** "2,500 Gold" on a wooden sign, planted on the plot that is for sale. */
  private priceSign(price: number): Phaser.GameObjects.Container {
    const sign = this.add.image(0, 0, "sign", ART_FRAME).setOrigin(0.5, 1).setScale(1 / S);
    // A 6.5px font would be a smear at any zoom past 1; `resolution` renders
    // the glyphs 8x oversized and lets the camera scale them down, the same
    // trick the rest of the art gets from being baked at ART_SCALE.
    const label = this.add
      .text(0, -17.5, `${price.toLocaleString()} Gold`, {
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        fontSize: "6.5px",
        fontStyle: "700",
        color: "#3d2a14",
        resolution: 8,
      })
      .setOrigin(0.5);
    const anchor = isoProject(CELL / 2, CELL / 2 + 18);
    const tag = this.add.container(anchor.x, anchor.y, [sign, label]);
    if (!this.options.reducedMotion) {
      this.pendingTweens.push(
        this.tweens.add({
          targets: tag,
          y: tag.y - 1.5,
          duration: 1_300,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        }),
      );
    }
    return tag;
  }

  private paintField(
    node: CellNode,
    cell: StackAcresSceneCell,
    img: (name: PainterName, x: number, y: number) => Phaser.GameObjects.Image,
  ): void {
    this.paintGroundDiamond(node.container, "soil");
    const stage = growthStage(cell.progress, cell.state === "ready");
    const crop = cell.stock === "cash_crop" ? "corn" : "carrot";
    const frame = `${crop}${stage}` as PainterName;
    for (const rowY of [19.5, 35.5, 51.5, 67.5]) {
      for (let i = 0; i < 5; i += 1) {
        const plant = img(frame, 14 + i * 13, rowY);
        node.plants.push(plant);
        if (cell.state === "ready") node.bobbing.push(plant);
      }
    }
    this.bob(node);
  }

  /**
   * The walk box for one pen's animals. `penInterior` is the pen -- species
   * blind, because a pen does not change shape when you sell the cows -- so
   * the animal's own width is inset here, where the picture is: a cow anchored
   * at its feet is 24 units wide and would otherwise stand through the rails.
   */
  private penFor(cell: StackAcresSceneCell): WorldRect {
    const pen = penInterior(cell.plotIndex);
    const art = cell.stock ? STOCK_ART[cell.stock] : undefined;
    const half = art ? PAINTERS[art].w / 2 : 0;
    const inset = Math.min(half, pen.width / 2 - 1);
    return { x: pen.x + inset, y: pen.y, width: pen.width - inset * 2, height: pen.height };
  }

  private paintPen(
    node: CellNode,
    cell: StackAcresSceneCell,
    carried: Critter[],
    img: (name: PainterName, x: number, y: number) => Phaser.GameObjects.Image,
    shadow: (x: number, y: number, sx?: number, sy?: number) => Phaser.GameObjects.Image,
  ): void {
    this.paintGroundDiamond(node.container, "straw");
    // Rails run along the diamond's own two edge directions, not screen
    // horizontal/vertical -- see ISO_EDGE_ANGLE. `img` positions each rail's
    // anchor correctly by itself; the rotation is what makes the sprite
    // actually lie along that edge instead of floating flat at an angle.
    for (let x = 0; x < CELL; x += 16) img("railH", x, 4).setRotation(ISO_EDGE_ANGLE.alongX);
    for (let y = 12; y < CELL - 10; y += 16) {
      img("railV", 0, y).setRotation(ISO_EDGE_ANGLE.alongY);
      img("railV", CELL - 9, y).setRotation(ISO_EDGE_ANGLE.alongY);
    }
    img(cell.state === "hungry" ? "troughEmpty" : "troughFull", 24, 12);

    const art = cell.stock ? STOCK_ART[cell.stock] : undefined;
    if (art) {
      const pen = this.penFor(cell);
      const origin = cellOrigin(cell.plotIndex);
      const count = critterCount(cell.stock);
      const states: Critter[] = [];
      // Every shadow first, then every animal, so the animals are one
      // contiguous block the per-frame depth sort can shuffle by y without
      // ever lifting one above the near fence or dropping it under the straw.
      const casts: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < count; i += 1) {
        const state = carried[i] ?? spawnCritter(pen, this.random);
        states.push(state);
        casts.push(
          shadow(
            state.x - origin.x,
            state.y - origin.y,
            art === "cow" ? 0.75 : art === "sheep" ? 0.6 : 0.45,
            art === "hen" ? 0.5 : 0.7,
          ),
        );
      }
      for (let i = 0; i < count; i += 1) {
        const state = states[i];
        const sprite = img(art, state.x - origin.x, state.y - origin.y).setFlipX(state.facing === 1);
        if (cell.state === "hungry") sprite.setTint(0xb9b4ae);
        if (i === 0) node.spriteSlot = node.container.getIndex(sprite);
        // Animals are never bobbed: the tween would own y, update() owns the
        // shadow's y, and the two drift apart. A ready pen has its gold ring.
        node.critters.push({ sprite, shadow: casts[i], state, lift: 0, phase: i * 2.1 });
      }
    }

    // The near fence paints over the animals, so it goes on last.
    for (let x = 0; x < CELL; x += 16) {
      img(x === 32 ? "gate" : "railH", x, CELL - 9).setRotation(ISO_EDGE_ANGLE.alongX);
    }
    this.bob(node);
  }

  /** A ripe plot's contents hop, the way the old grid's sprite did. */
  private bob(node: CellNode): void {
    if (this.options.reducedMotion || node.bobbing.length === 0) return;
    node.tweens.push(
      this.tweens.add({
        targets: node.bobbing,
        y: "-=2",
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
    );
  }

  /** Traces a diamond -- the cell footprint inset by `inset` on every side,
   *  projected -- into a Graphics object's current path. Sharp corners, not
   *  rounded: a diamond's corners are the point of the shape, and rounding
   *  them reads as a square with clipped corners rather than a tile. Callers
   *  still own `beginPath`/`fillPath`/`strokePath` around this. */
  private tracePlotDiamond(g: Phaser.GameObjects.Graphics, inset: number): void {
    const c = projectedCorners({
      x: inset,
      y: inset,
      width: CELL - inset * 2,
      height: CELL - inset * 2,
    });
    g.moveTo(c.n.x, c.n.y);
    g.lineTo(c.e.x, c.e.y);
    g.lineTo(c.s.x, c.s.y);
    g.lineTo(c.w.x, c.w.y);
    g.closePath();
  }

  private paintRings(node: CellNode, cell: StackAcresSceneCell): void {
    node.tweens.push(...this.pendingTweens);
    this.pendingTweens = [];

    const ring = node.ring;
    ring.clear();
    const stateColour = cell.selected
      ? CHALK
      : cell.state === "ready"
        ? GOLD
        : cell.state === "hungry"
          ? AMBER
          : cell.state === "mucked"
            ? MUCK
            : null;
    if (stateColour !== null) {
      if (cell.state === "ready" && !cell.selected) {
        ring.lineStyle(5, GOLD, 0.22);
        ring.beginPath();
        this.tracePlotDiamond(ring, -1);
        ring.strokePath();
      }
      ring.lineStyle(2.2, stateColour, 1);
      ring.beginPath();
      this.tracePlotDiamond(ring, 1.5);
      ring.strokePath();
    }

    const afford = node.afford;
    afford.clear();
    afford.setAlpha(1);
    if (cell.afford === "act") {
      afford.fillStyle(VIOLET, 0.14);
      afford.beginPath();
      this.tracePlotDiamond(afford, 4);
      afford.fillPath();
      afford.lineStyle(2, VIOLET, 1);
      afford.beginPath();
      this.tracePlotDiamond(afford, 4);
      afford.strokePath();
      if (!this.options.reducedMotion) {
        node.tweens.push(
          this.tweens.add({
            targets: afford,
            alpha: 0.45,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          }),
        );
      }
    } else if (cell.afford === "blocked") {
      afford.lineStyle(2, RED, 1);
      afford.beginPath();
      this.tracePlotDiamond(afford, 4);
      afford.strokePath();
    }
  }

  private paintProgress(node: CellNode, cell: StackAcresSceneCell): void {
    const show = cell.progress !== null && (cell.state === "working" || cell.state === "hungry");
    const value = show ? Math.round((cell.progress ?? 0) * 60) / 60 : -1;
    if (value === node.progressValue) return;
    node.progressValue = value;
    const g = node.progress;
    g.clear();
    if (!show) return;
    // A screen-flat bar, not a diamond-following one: a mini progress bar
    // reads as UI everywhere else in this codebase's own conventions, and a
    // sheared one under a tilted camera would look like a rendering bug
    // rather than a bar. Anchored under the diamond's own nearest (south)
    // corner, which is where "the front of the plot" now actually is.
    const near = isoProject(CELL, CELL);
    const track = CELL * 0.62;
    const x = near.x - track / 2;
    const y = near.y + 7;
    const fill = Math.max(3.6, track * Math.max(0, value));
    g.fillStyle(0x000000, 0.45);
    g.fillRoundedRect(x, y, track, 3.6, 1.8);
    g.fillStyle(VIOLET, 1);
    g.fillRoundedRect(x, y, fill, 3.6, 1.8);
    g.fillStyle(0xffffff, 0.3);
    g.fillRoundedRect(x, y, fill, 1.4, 0.7);
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

  /** "Home": the owned plots and the barn yard above them, framed together.
   *  `box` is world space, same as before the camera tilted; `openingZoom`
   *  needs the diamond's own screen-space bounding box, not the rect's own
   *  width/height, to fit it to the viewport. The centre point does not need
   *  a separate projected-bounds computation: `isoProject` is linear, so a
   *  rect's own centre projects to exactly the centre of its diamond's
   *  bounding box (iso.test.ts's additivity case is the same fact). */
  private homeView(): { zoom: number; x: number; y: number } {
    const owned = this.cells.filter((c) => c.state !== "locked");
    const farm = ownedBounds(owned.length > 0 ? owned : this.cells);
    const top = Math.min(farm.y, BARN_TOP);
    const box: WorldRect = {
      x: farm.x,
      y: top,
      width: farm.width,
      height: farm.y + farm.height - top,
    };
    const screenBox = projectedBounds(box);
    const centre = isoProject(box.x + box.width / 2, box.y + box.height / 2);
    return {
      zoom: openingZoom(screenBox, this.viewW(), this.viewH()),
      x: centre.x,
      y: centre.y,
    };
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

  /**
   * Brings a plot into the clear part of the screen -- the middle, away from
   * the toolbelt down the right edge and the detail panel over the bottom-left
   * -- and only if it is not already there. Opening a panel about a plot the
   * panel then covers is the one thing this exists to prevent; a plot already
   * in the clear is left alone so a tap does not shove the map about.
   *
   * `force` pans regardless, for land that just opened up off-screen.
   */
  focusPlot(plotIndex: number, force = false): void {
    if (!this.created) return;
    this.glide = null;
    const cam = this.cameras.main;
    const world = cellCenter(plotIndex);
    const centre = isoProject(world.x, world.y);
    if (!force) {
      const { x: sx, y: sy } = this.toScreen(centre.x, centre.y);
      const clear = sx > 40 && sx < this.viewW() - 150 && sy > 60 && sy < this.viewH() - 40;
      if (clear) return;
    }
    if (this.options.reducedMotion) cam.centerOn(centre.x, centre.y);
    else cam.pan(centre.x, centre.y, force ? 550 : 320, "Sine.easeInOut");
  }

  /** Start (or, with null, stop) reporting where a plot is on screen. */
  trackPlot(plotIndex: number | null): void {
    this.tracked = plotIndex;
    this.trackedKey = "";
    if (plotIndex === null) this.callbacks.onTrackedRect(null);
    else this.reportTracked();
  }

  private reportTracked(): void {
    // The camera does not exist until create(); the shell can start tracking
    // a plot the moment it renders, which is before the engine has booted.
    if (this.tracked === null || !this.created) return;
    const rect = cellRect(this.tracked);
    // The diamond's own screen-space bounding box -- wider than it is tall
    // now, not the square `size` a flat cell used to report on both axes.
    const screenBox = projectedBounds(rect);
    const tl = this.toScreen(screenBox.x, screenBox.y);
    const zoom = this.zoomL();
    const width = screenBox.width * zoom;
    const height = screenBox.height * zoom;
    const viewWidth = this.viewW();
    const viewHeight = this.viewH();
    const key = `${Math.round(tl.x)}:${Math.round(tl.y)}:${Math.round(width)}:${Math.round(height)}:${viewWidth}:${viewHeight}`;
    if (key === this.trackedKey) return;
    this.trackedKey = key;
    this.callbacks.onTrackedRect({ x: tl.x, y: tl.y, width, height, viewWidth, viewHeight });
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
   * the seed strip never reaches this listener at all -- which is also what
   * keeps a chip's drag-to-place from panning the map underneath it: that
   * drag's pointerdown went to the chip, so `pts` never hears about it.
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
    // The one seam a tap, a sweep and the placement ghost all resolve a
    // finger through: CSS pixels -> device pixels -> scene space -> world
    // space -> which plot (if any) is there.
    const resolvePlot = (clientX: number, clientY: number): { index: number | null; scene: { x: number; y: number } } => {
      const at = toGame(clientX, clientY);
      const scene = this.cameras.main.getWorldPoint(at.x, at.y);
      const world = isoUnproject(scene.x, scene.y);
      return { index: plotIndexAt(world.x, world.y), scene: { x: scene.x, y: scene.y } };
    };
    // Two shorter stops along the same seam: scene space (what the ghost
    // sprites are positioned in) and true world space (what the meadow's
    // tiles are indexed in).
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
    const oneFinger = (
      id: number,
      at: Finger,
      kind: "press" | "pan",
      startPlot: number | null = null,
      startAfford: PlotAffordance["kind"] = "none",
    ): DragGesture => ({
      kind,
      id,
      x: at.x,
      y: at.y,
      startX: at.x,
      startY: at.y,
      trail: [{ t: performance.now(), x: at.x, y: at.y }],
      startPlot,
      startAfford,
    });
    // Walks every plot the pointer crossed between two screen points, firing
    // the sweep callback once per newly-entered plot the held tool can act
    // on. Sampled rather than resolved only at the two endpoints -- a fast
    // swipe on a phone can put two pointermove events a tile-width or more
    // apart, and a plot skipped between them would never see the tool.
    const SWEEP_STEPS = 8;
    const sweepSegment = (gesture: DragGesture, fromX: number, fromY: number, toX: number, toY: number): void => {
      if (!gesture.visited) gesture.visited = new Set();
      const visited = gesture.visited;
      let last: number | null = null;
      for (let i = 1; i <= SWEEP_STEPS; i += 1) {
        const t = i / SWEEP_STEPS;
        const { index } = resolvePlot(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
        if (index === null || index === last) continue;
        last = index;
        if (visited.has(index)) continue;
        visited.add(index);
        if (this.cellAfford(index) !== "act") continue;
        this.pokePlot(index);
        this.callbacks.onSweepPlot(index);
      }
    };
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
        const { index } = resolvePlot(event.clientX, event.clientY);
        const afford = index === null ? "none" : this.cellAfford(index);
        const gesture = oneFinger(
          event.pointerId,
          { x: event.clientX, y: event.clientY },
          "press",
          index,
          afford,
        );
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
        // swathe, the ground-level twin of the plot sweep below: same "start
        // on the target" rule, a different kind of target.
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
        // A drag that started on a plot the held tool has business with
        // sweeps that tool across every such plot it crosses, instead of
        // panning the map -- the same "start on the target" rule a tap
        // already follows, just given room to run.
        if (gesture.startAfford === "none") {
          gesture.kind = "pan";
        } else {
          gesture.kind = "sweep";
          gesture.visited = new Set();
          if (gesture.startPlot !== null) {
            gesture.visited.add(gesture.startPlot);
            if (gesture.startAfford === "act") {
              this.pokePlot(gesture.startPlot);
              this.callbacks.onSweepPlot(gesture.startPlot);
            }
          }
          const start = resolvePlot(gesture.startX, gesture.startY);
          this.showToolGhost(start.scene.x, start.scene.y);
        }
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
      if (gesture.kind === "sweep") {
        sweepSegment(gesture, prevX, prevY, event.clientX, event.clientY);
        const here = resolvePlot(event.clientX, event.clientY);
        this.moveToolGhost(here.scene.x, here.scene.y);
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
      if (gesture.kind === "sweep" || gesture.kind === "mow") {
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
      const { index } = resolvePlot(event.clientX, event.clientY);
      if (index === null) {
        this.callbacks.onTapGround();
        return;
      }
      // The picture answers the finger before the rules do: whatever the
      // shell decides the tap meant, the animals noticed it.
      this.pokePlot(index);
      this.callbacks.onTapPlot(index);
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
  /* Placement ghost                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Shows what the player is dragging out of the seed strip, snapped to the
   * empty plot under the finger when there is one. Returns that plot's index,
   * or null when the drop would land on nothing plantable.
   *
   * The coordinates are CSS pixels relative to the canvas host, as the DOM
   * hands them over; the camera wants device pixels.
   */
  setGhost(stock: StackAcresStock | null, cssX: number, cssY: number): number | null {
    const ghost = this.ghost;
    const ring = this.ghostRing;
    if (!ghost || !ring) return null;
    if (!stock) {
      ghost.setVisible(false);
      ring.setVisible(false);
      return null;
    }
    ghost.setTexture(GHOST_ART[stock], ART_FRAME).setVisible(true);
    // `scene` is what the pointer is actually over on screen; `world` is the
    // same point translated back to world.ts's plane, which is the only
    // space `plotIndexAt` understands.
    const scene = this.cameras.main.getWorldPoint(cssX * DPR, cssY * DPR);
    const world = isoUnproject(scene.x, scene.y);
    const index = plotIndexAt(world.x, world.y);
    const cell = index === null ? null : this.cells.find((c) => c.plotIndex === index);
    if (index !== null && cell && cell.state === "empty") {
      const worldCentre = cellCenter(index);
      const centre = isoProject(worldCentre.x, worldCentre.y);
      ghost.setPosition(centre.x, centre.y + 10).setAlpha(1);
      ring.clear().setVisible(true);
      const origin = cellOrigin(index);
      const diamond = projectedCorners({ x: origin.x + 3, y: origin.y + 3, width: CELL - 6, height: CELL - 6 });
      const trace = (): void => {
        ring.moveTo(diamond.n.x, diamond.n.y);
        ring.lineTo(diamond.e.x, diamond.e.y);
        ring.lineTo(diamond.s.x, diamond.s.y);
        ring.lineTo(diamond.w.x, diamond.w.y);
        ring.closePath();
      };
      ring.fillStyle(VIOLET, 0.2);
      ring.beginPath();
      trace();
      ring.fillPath();
      ring.lineStyle(2.2, VIOLET, 1);
      ring.beginPath();
      trace();
      ring.strokePath();
      return index;
    }
    ghost.setPosition(scene.x, scene.y + 6).setAlpha(0.65);
    ring.setVisible(false);
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Tool sweep                                                        */
  /* ---------------------------------------------------------------- */

  /** What the held tool would do at this plot, per the cell picture it was
   *  last handed -- the same field bindInput's sweep reads to decide whether
   *  a plot is worth firing on. */
  private cellAfford(plotIndex: number): PlotAffordance["kind"] {
    return this.nodes.get(plotIndex)?.cell.afford ?? "none";
  }

  /** Which tool's picture `toolGhost` shows once a sweep starts. Set from the
   *  shell whenever the held tool changes; harmless to call before `create()`
   *  has run, since nothing shows the picture until a sweep actually begins. */
  setToolIcon(icon: PainterName): void {
    this.toolIconName = icon;
    this.toolGhost?.setTexture(icon, ART_FRAME);
  }

  /**
   * Which tool is held, by name.
   *
   * The scene has never needed this before: every other tool acts on a plot,
   * and a plot arrives from the shell already carrying what the tool would do
   * to it (`cell.afford`), so the scene could stay ignorant of which tool
   * produced that. The scythe's target is ground rather than a plot, so there
   * is no cell to carry the answer and the scene has to ask the question
   * itself -- see `mowable` in `bindInput`.
   */
  setTool(tool: StackAcresTool): void {
    this.tool = tool;
  }

  /** Floats the held tool's own picture above a finger that just turned a
   *  press into a sweep -- offset up, the way `setGhost` offsets down, so
   *  the thumb dragging it never covers the art it is answering for. */
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

  /**
   * The tap's own answer, before any rule runs: a pen's animals squash and
   * spring up one after another, a field's plants ripple across in waves.
   * Squash-and-stretch keeps rough volume (1.22 wide is 0.8 tall), which is
   * what makes it read as a body flexing rather than the picture stretching.
   * Scale only: update() owns every animal's y, so the hop goes through
   * `lift`, which update() folds in. One bounce at a time per plot; a second
   * tap mid-bounce is ignored rather than stacked.
   */
  pokePlot(plotIndex: number): void {
    if (this.options.reducedMotion) return;
    const node = this.nodes.get(plotIndex);
    if (!node || node.juiceUntil > this.now) return;
    const base = 1 / S;
    // Finished tweens have already left the manager; keep the list to the
    // live ones so destroyNode never removes a tween twice.
    node.tweens = node.tweens.filter((t) => !t.isDestroyed());
    const own = (tween: Phaser.Tweens.Tween) => node.tweens.push(tween);
    const squash = (target: object, delay: number, wide: number, tall: number, ms: number) =>
      own(
        this.tweens.add({
          targets: target,
          scaleX: base * wide,
          scaleY: base * tall,
          duration: ms,
          delay,
          yoyo: true,
          ease: "Quad.easeOut",
        }),
      );

    if (node.critters.length > 0) {
      node.juiceUntil = this.now + 520 + node.critters.length * 70;
      node.critters.forEach((critter, i) => {
        const delay = i * 70;
        squash(critter.sprite, delay, 1.22, 0.8, 70);
        squash(critter.sprite, delay + 140, 0.9, 1.14, 110);
        own(
          this.tweens.add({
            targets: critter,
            lift: 4,
            duration: 130,
            delay: delay + 140,
            yoyo: true,
            ease: "Sine.easeOut",
          }),
        );
        squash(critter.sprite, delay + 400, 1.08, 0.94, 55);
      });
      return;
    }
    if (node.plants.length > 0) {
      // Last plant's delay tops out at 180ms (row 3, col 4: 4*36 + 3*12), then
      // the two chained squash tweens (80ms + 90ms, both yoyo'd so doubled)
      // add another 340ms -- guard must cover the full 180 + 340 = 520ms, not
      // just the first tween's span, or a re-tap lands mid squash-back.
      node.juiceUntil = this.now + 520;
      node.plants.forEach((plant, i) => {
        const delay = (i % 5) * 36 + Math.floor(i / 5) * 12;
        squash(plant, delay, 1.18, 0.84, 80);
        squash(plant, delay + 160, 0.94, 1.1, 90);
      });
    }
  }

  celebrateHarvest(plotIndex: number): void {
    const world = cellCenter(plotIndex);
    const centre = isoProject(world.x, world.y);
    const burst = this.add.graphics().setDepth(8500);
    burst.fillStyle(0xffe98a, 0.85);
    burst.fillCircle(0, 0, CELL * 0.45);
    burst.setPosition(centre.x, centre.y).setScale(0.4);
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
      spark.setPosition(centre.x, centre.y);
      const angle = this.random() * Math.PI * 2;
      const reach = 18 + this.random() * 22;
      this.tweens.add({
        targets: spark,
        x: centre.x + Math.cos(angle) * reach,
        y: centre.y + Math.sin(angle) * reach - 10,
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
    for (const tile of mowStroke(from, to)) {
      const key = meadowTileKey(tile.tx, tile.ty);
      const cutAt = this.mown.get(key) ?? null;
      if (meadowDensityAt(tile.tx, tile.ty, cutAt, wall) === 0) continue;
      this.mown.set(key, wall);
      this.refreshGrass(tile.tx, tile.ty);
      if (!this.options.reducedMotion) this.cutBurst(tile.tx, tile.ty);
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
    const zoom = openingZoom(screenBox, this.viewW(), this.viewH());
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
   * Front-to-back order inside one pen: the animal standing furthest south
   * draws last, so a hen walking in front of another is in front of it. The
   * sprites are a contiguous block of the container's list (see paintPen),
   * so this only ever permutes within that block -- the near fence stays
   * above them and the straw below -- and only touches the list at all when
   * the order actually changed.
   */
  private sortPen(node: CellNode): void {
    const critters = node.critters;
    const n = critters.length;
    if (node.spriteSlot < 0 || n < 2) return;
    // An in-place insertion sort of the persistent index array: two or three
    // animals a pen, so it is a handful of compares, and unlike map().sort()
    // it allocates nothing on a frame where nobody overtook anybody.
    const order = node.order;
    if (order.length !== n) {
      order.length = 0;
      for (let i = 0; i < n; i += 1) order.push(i);
    }
    let moved = false;
    for (let i = 1; i < n; i += 1) {
      const index = order[i];
      // (x + y) is the isometric depth key -- see iso.ts -- not y alone,
      // which was only ever the right key under the flat top-down camera.
      const depth = critters[index].state.x + critters[index].state.y;
      let j = i - 1;
      while (j >= 0 && critters[order[j]].state.x + critters[order[j]].state.y > depth) {
        order[j + 1] = order[j];
        j -= 1;
      }
      if (j + 1 !== i) {
        order[j + 1] = index;
        moved = true;
      }
    }
    if (!moved) return;
    for (let slot = 0; slot < n; slot += 1) {
      node.container.moveTo(critters[order[slot]].sprite, node.spriteSlot + slot);
    }
  }

  update(time: number, delta: number): void {
    this.now = time;
    this.coast(delta);
    this.reportTracked();
    this.tendWorld();
    this.fitVignette();
    if (this.options.reducedMotion) return;

    this.animatePond(time);
    this.walkHerds(time, delta);
    this.regrowMeadow();
    if (this.blades) this.blades.rotation = time * WINDMILL_SPEED;

    // Cloud shadows, drifting across whatever the camera is looking at. They
    // are placed against the view rather than the world: there is no world
    // edge for them to have come from.
    const view = this.viewRect();
    this.clouds.forEach((cloud, i) => {
      const w = view.width + 400;
      const h = view.height + 300;
      const t = time * 0.004 + i * 700;
      cloud.setPosition(
        view.x - 200 + ((t * 2.2 + i * 500) % w),
        view.y - 150 + ((t * 0.8 + i * 900) % h),
      );
    });

    for (const node of this.nodes.values()) {
      if (node.critters.length === 0) continue;
      const cell = node.cell;
      // A hungry animal has stopped. Standing still is the picture of that.
      if (cell.state === "hungry") continue;
      const pen = this.penFor(cell);
      const origin = cellOrigin(cell.plotIndex);
      const speed = critterSpeed(cell.stock);
      const bouncing = node.juiceUntil > time;
      for (const critter of node.critters) {
        critter.state = stepCritter(critter.state, pen, speed, delta, this.random);
        const walking = critter.state.mode === "walk";
        const hop = walking ? Math.abs(Math.sin(time / 90 + critter.phase)) * 1.2 : 0;
        // World-space local offset, projected once here every frame -- the
        // one-time `img()` projection at construction only covers a sprite's
        // starting position, and this one walks.
        const local = isoProject(critter.state.x - origin.x, critter.state.y - origin.y);
        critter.sprite.x = local.x;
        critter.sprite.y = local.y - hop - critter.lift;
        critter.shadow.x = local.x;
        critter.shadow.y = local.y + 1;
        // The shadow thins as the animal leaves the ground.
        critter.shadow.alpha = 0.8 / (1 + critter.lift * 0.18);
        critter.sprite.setFlipX(critter.state.facing === 1);
        // A standing animal breathes, slowly and out of step with its
        // neighbours. A tap's bounce owns the scale until it is done, and a
        // walking animal is simply its own size.
        if (!bouncing) {
          const breath = walking ? 0 : Math.sin(time / 420 + critter.phase) * 0.022;
          critter.sprite.setScale((1 - breath * 0.5) / S, (1 + breath) / S);
        }
      }
      this.sortPen(node);
      // The rings and the progress bar sit over everything in the cell,
      // including the near fence the animals walk behind.
      node.container.bringToTop(node.ring);
      node.container.bringToTop(node.afford);
      node.container.bringToTop(node.progress);
    }
  }
}
