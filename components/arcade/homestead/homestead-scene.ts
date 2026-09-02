// A namespace import, not a default one: the package's ESM build (what the
// bundler picks for the browser) has only named exports, and `import Phaser
// from "phaser"` fails at build time with "export default doesn't exist".
import * as Phaser from "phaser";
import { isLivestock, type HomesteadStock } from "@/lib/homestead/catalogue";
import type { HomesteadPlotState } from "@/lib/homestead/plots";
import type { PlotAffordance } from "@/lib/homestead/tools";
import {
  HOMESTEAD_CELL,
  HOMESTEAD_CHUNK,
  HOMESTEAD_MARGIN,
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
} from "@/lib/homestead/world";
import { ART_SCALE, GRASS_PX, PAINTERS, bakeGrass, bakeTexture, type PainterName } from "./homestead-art";

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
 * ./homestead-art.ts, baked once at boot into a texture at ART_SCALE device
 * pixels per unit and then only ever scaled DOWN by the camera, which is what
 * keeps it smooth at 5x where a 16px tile sheet went to mush.
 *
 * This file paints. It owns no rules: every cell arrives already decided
 * (state, what the held tool would do, whether it is selected) from the React
 * shell, which computed those with lib/homestead/tools.ts exactly as the old
 * grid did. The scene's only outputs are "the player tapped plot N" and "the
 * player tapped grass".
 *
 * The HUD, the toolbelt and the store are NOT in here. They stay as DOM,
 * pinned over the canvas by CSS, because a `<button>` is reachable by a
 * screen reader and a thumb alike, and a Phaser Text object is neither. Those
 * overlays are siblings of the canvas host rather than children of it, so a
 * press on one never reaches the map at all -- which is also why Phaser's own
 * input is switched off entirely (see homestead-world.tsx) and every gesture
 * is read straight off the host element with native pointer events. See
 * `bindInput` for why that matters more than tidiness.
 *
 * Two coordinate systems meet here and it matters which one is in hand. The
 * canvas is DPR times denser than the screen (that density is what makes the
 * vector art crisp), so Phaser's camera width and zoom are in device pixels,
 * while a pointer event and everything the DOM shell hands over or gets back
 * -- the ghost's position, the tracked plot's rectangle -- are in CSS pixels.
 * The `viewW`/`viewH`/`zoomL`/`toScreen` helpers are the CSS-pixel side; the
 * `cam.*` values are the device-pixel side.
 */

export interface HomesteadSceneCell {
  plotIndex: number;
  state: HomesteadPlotState;
  stock: HomesteadStock | null;
  /** 0..1 while working, 1 once ready, null otherwise. */
  progress: number | null;
  /** What the held tool would do here, from lib/homestead/tools.ts. */
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

export interface HomesteadSceneCallbacks {
  onTapPlot: (plotIndex: number) => void;
  onTapGround: () => void;
  /** Fired once the first frame with plots on it has been drawn. */
  onReady: () => void;
  /**
   * Where the tracked plot (see `trackPlot`) is on screen, whenever that
   * changes -- a pan, a zoom, a resize. Null once tracking stops. The shell
   * hangs the detail card off this so the card follows the plot it is about.
   */
  onTrackedRect: (rect: PlotScreenRect | null) => void;
}

export interface HomesteadSceneOptions {
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
 * homestead-world.tsx's dynamic import, in a browser.
 */
export const DPR = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);

const CELL = HOMESTEAD_CELL;
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

// The barn yard stands just north of the first row of plots; its roof reaches
// BARN_TOP, which is what "home" has to frame as well as the plots themselves.
const BARN_X = HOMESTEAD_MARGIN + 44;
const BARN_Y = HOMESTEAD_MARGIN - 4;
const BARN_TOP = BARN_Y - 66;

/** Which animal stands in which pen. */
const STOCK_ART: Partial<Record<HomesteadStock, PainterName>> = {
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

/** What the player is dragging out of the seed strip, as a picture. */
const GHOST_ART: Record<HomesteadStock, PainterName> = {
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
  sprout: "carrot2",
  cash_crop: "corn2",
};

/** Only things with a canopy get a shadow. A rock or a tuft sitting on a
 *  smudge of its own reads as hovering, not as standing. */
function castsShadow(kind: SceneryKind): boolean {
  return kind.startsWith("tree") || kind === "pine" || kind === "bush";
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

/** One finger down: a press until it has moved TAP_SLOP, a pan after that. */
interface DragGesture {
  kind: "press" | "pan";
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  /** The last ~80ms of movement, which is what the flick is measured from. */
  trail: TrailPoint[];
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
  bobbing: Phaser.GameObjects.GameObject[];
  tweens: Phaser.Tweens.Tween[];
  signature: string;
  cell: HomesteadSceneCell;
}

function signatureOf(cell: HomesteadSceneCell): string {
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

export class HomesteadScene extends Phaser.Scene {
  private readonly callbacks: HomesteadSceneCallbacks;
  private readonly options: HomesteadSceneOptions;
  private nodes = new Map<number, CellNode>();
  private cells: HomesteadSceneCell[] = [];
  private pending: HomesteadSceneCell[] | null = null;
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
  /** Grown scenery, by "cx:cy". The open world, one chunk at a time. */
  private chunks = new Map<string, Phaser.GameObjects.Image[]>();

  private ghost: Phaser.GameObjects.Image | null = null;
  private ghostRing: Phaser.GameObjects.Graphics | null = null;

  private tracked: number | null = null;
  private trackedKey = "";

  /** Tweens made while a node is being built, claimed by it in paintRings. */
  private pendingTweens: Phaser.Tweens.Tween[] = [];

  constructor(callbacks: HomesteadSceneCallbacks, options: HomesteadSceneOptions) {
    super({ key: "HomesteadScene" });
    this.callbacks = callbacks;
    this.options = options;
  }

  create(): void {
    // Every texture is drawn here, at boot: there is no preload and no
    // network. The icons are skipped -- those are painted straight into DOM
    // canvases by homestead-icon.tsx and never reach a Phaser texture.
    for (const name of Object.keys(PAINTERS) as PainterName[]) {
      if (!name.startsWith("ico-")) bakeTexture(this, name);
    }
    bakeGrass(this);

    // Depth is the world y of a thing's feet, so it can go far negative north
    // of the farm: the grass has to sit below anything the player can roam to.
    this.grass = this.add.tileSprite(0, 0, 100, 100, "grass").setOrigin(0).setDepth(-1e9);
    this.grass.tileScaleX = 1 / GRASS_PX;
    this.grass.tileScaleY = 1 / GRASS_PX;

    this.paintBarn();

    this.ghostRing = this.add.graphics().setDepth(9000).setVisible(false);
    this.ghost = this.add
      .image(0, 0, "hen")
      .setOrigin(0.5, 1)
      .setScale(1.3 / S)
      .setDepth(9001)
      .setVisible(false);
    for (let i = 0; i < 3; i += 1) {
      this.clouds.push(
        this.add
          .image(0, 0, "cloud")
          .setScale(1 / S)
          .setDepth(8000)
          .setAlpha(this.options.reducedMotion ? 0 : 1),
      );
    }

    this.bindInput();

    this.created = true;
    if (this.pending) {
      const cells = this.pending;
      this.pending = null;
      this.setPlots(cells);
    }
  }

  /** One painter, placed by its own anchor and sorted by the ground it stands
   *  on. Everything in the world goes through here. */
  private put(name: PainterName, x: number, y: number, depth?: number): Phaser.GameObjects.Image {
    const p = PAINTERS[name];
    return this.add
      .image(x, y, name)
      .setOrigin(p.ax, p.ay)
      .setScale(1 / S)
      .setDepth(depth ?? y);
  }

  /**
   * A barn, a silo and some clutter in the margin above the first row, so the
   * farm has a home rather than a top-left corner. It is the one fixed
   * landmark out here: the opening shot frames it along with the plots.
   */
  private paintBarn(): void {
    this.put("shadow", BARN_X, BARN_Y + 1, BARN_Y - 100)
      .setScale(2.6 / S, 1.2 / S)
      .setAlpha(0.9);
    this.put("barn", BARN_X, BARN_Y, BARN_Y);
    this.put("silo", BARN_X + 46, BARN_Y, BARN_Y);
    this.put("hay", BARN_X + 58, BARN_Y - 11, BARN_Y + 0.5);
    this.put("hay", BARN_X + 66, BARN_Y - 11, BARN_Y + 0.6);
    this.put("barrel", BARN_X - 48, BARN_Y - 14, BARN_Y + 0.4);
  }

  /* ---------------------------------------------------------------- */
  /* Plots                                                             */
  /* ---------------------------------------------------------------- */

  setPlots(cells: HomesteadSceneCell[]): void {
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
    cell: HomesteadSceneCell,
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

    const container = this.add.container(origin.x, origin.y).setDepth(origin.y + CELL);
    const node: CellNode = {
      container,
      ring: this.add.graphics(),
      afford: this.add.graphics(),
      progress: this.add.graphics(),
      progressValue: -1,
      critters: [],
      bobbing: [],
      tweens: [],
      signature,
      cell,
    };

    // Cell-local placement: the container already sits at the plot's origin.
    const img = (name: PainterName, x: number, y: number): Phaser.GameObjects.Image => {
      const p = PAINTERS[name];
      const image = this.add
        .image(x, y, name)
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
        img("mown", 0, 0);
        for (const item of clearedLayout(cell.plotIndex)) img(item.kind, item.x, item.y);
        break;
      case "mucked":
        img("muckbed", 0, 0);
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

  /** Land nobody has cleared yet: trees, and a price sign on the one for sale. */
  private paintThicket(
    cell: HomesteadSceneCell,
    img: (name: PainterName, x: number, y: number) => Phaser.GameObjects.Image,
    shadow: (x: number, y: number, sx?: number, sy?: number) => Phaser.GameObjects.Image,
    container: Phaser.GameObjects.Container,
  ): void {
    img("wild", 0, 0);
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
    const sign = this.add.image(0, 0, "sign").setOrigin(0.5, 1).setScale(1 / S);
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
    const tag = this.add.container(CELL / 2, CELL / 2 + 18, [sign, label]);
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
    cell: HomesteadSceneCell,
    img: (name: PainterName, x: number, y: number) => Phaser.GameObjects.Image,
  ): void {
    img("soil", 0, 0);
    const stage = growthStage(cell.progress, cell.state === "ready");
    const crop = cell.stock === "cash_crop" ? "corn" : "carrot";
    const frame = `${crop}${stage}` as PainterName;
    for (const rowY of [19.5, 35.5, 51.5, 67.5]) {
      for (let i = 0; i < 5; i += 1) {
        const plant = img(frame, 14 + i * 13, rowY);
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
  private penFor(cell: HomesteadSceneCell): WorldRect {
    const pen = penInterior(cell.plotIndex);
    const art = cell.stock ? STOCK_ART[cell.stock] : undefined;
    const half = art ? PAINTERS[art].w / 2 : 0;
    const inset = Math.min(half, pen.width / 2 - 1);
    return { x: pen.x + inset, y: pen.y, width: pen.width - inset * 2, height: pen.height };
  }

  private paintPen(
    node: CellNode,
    cell: HomesteadSceneCell,
    carried: Critter[],
    img: (name: PainterName, x: number, y: number) => Phaser.GameObjects.Image,
    shadow: (x: number, y: number, sx?: number, sy?: number) => Phaser.GameObjects.Image,
  ): void {
    img("straw", 0, 0);
    for (let x = 0; x < CELL; x += 16) img("railH", x, 4);
    for (let y = 12; y < CELL - 10; y += 16) {
      img("railV", 0, y);
      img("railV", CELL - 9, y);
    }
    img(cell.state === "hungry" ? "troughEmpty" : "troughFull", 24, 12);

    const art = cell.stock ? STOCK_ART[cell.stock] : undefined;
    if (art) {
      const pen = this.penFor(cell);
      const origin = cellOrigin(cell.plotIndex);
      for (let i = 0; i < critterCount(cell.stock); i += 1) {
        const state = carried[i] ?? spawnCritter(pen, this.random);
        const cast = shadow(
          state.x - origin.x,
          state.y - origin.y,
          art === "cow" ? 0.75 : art === "sheep" ? 0.6 : 0.45,
          art === "hen" ? 0.5 : 0.7,
        );
        const sprite = img(art, state.x - origin.x, state.y - origin.y).setFlipX(state.facing === 1);
        if (cell.state === "hungry") sprite.setTint(0xb9b4ae);
        // Animals are never bobbed: the tween would own y, update() owns the
        // shadow's y, and the two drift apart. A ready pen has its gold ring.
        node.critters.push({ sprite, shadow: cast, state });
      }
    }

    // The near fence paints over the animals, so it goes on last.
    for (let x = 0; x < CELL; x += 16) img(x === 32 ? "gate" : "railH", x, CELL - 9);
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

  private paintRings(node: CellNode, cell: HomesteadSceneCell): void {
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
        ring.strokeRoundedRect(-1, -1, CELL + 2, CELL + 2, 9);
      }
      ring.lineStyle(2.2, stateColour, 1);
      ring.strokeRoundedRect(1.5, 1.5, CELL - 3, CELL - 3, 7.5);
    }

    const afford = node.afford;
    afford.clear();
    afford.setAlpha(1);
    if (cell.afford === "act") {
      afford.fillStyle(VIOLET, 0.14);
      afford.fillRoundedRect(4, 4, CELL - 8, CELL - 8, 6);
      afford.lineStyle(2, VIOLET, 1);
      afford.strokeRoundedRect(4, 4, CELL - 8, CELL - 8, 6);
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
      afford.strokeRoundedRect(4, 4, CELL - 8, CELL - 8, 6);
    }
  }

  private paintProgress(node: CellNode, cell: HomesteadSceneCell): void {
    const show = cell.progress !== null && (cell.state === "working" || cell.state === "hungry");
    const value = show ? Math.round((cell.progress ?? 0) * 60) / 60 : -1;
    if (value === node.progressValue) return;
    node.progressValue = value;
    const g = node.progress;
    g.clear();
    if (!show) return;
    const x = 10;
    const y = CELL - 8;
    const track = CELL - 20;
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

  /** "Home": the owned plots and the barn yard above them, framed together. */
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
    return {
      zoom: openingZoom(box, this.viewW(), this.viewH()),
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
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
    const centre = cellCenter(plotIndex);
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
    const tl = this.toScreen(rect.x, rect.y);
    const size = CELL * this.zoomL();
    const viewWidth = this.viewW();
    const viewHeight = this.viewH();
    const key = `${Math.round(tl.x)}:${Math.round(tl.y)}:${Math.round(size)}:${viewWidth}:${viewHeight}`;
    if (key === this.trackedKey) return;
    this.trackedKey = key;
    this.callbacks.onTrackedRect({ x: tl.x, y: tl.y, width: size, height: size, viewWidth, viewHeight });
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
      else this.gesture = oneFinger(event.pointerId, { x: event.clientX, y: event.clientY }, "press");
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
        gesture.kind = "pan";
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
      // A cancel is a release that never taps.
      if (cancelled) return;
      const at = toGame(event.clientX, event.clientY);
      const world = this.cameras.main.getWorldPoint(at.x, at.y);
      const index = plotIndexAt(world.x, world.y);
      if (index === null) this.callbacks.onTapGround();
      else this.callbacks.onTapPlot(index);
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
  setGhost(stock: HomesteadStock | null, cssX: number, cssY: number): number | null {
    const ghost = this.ghost;
    const ring = this.ghostRing;
    if (!ghost || !ring) return null;
    if (!stock) {
      ghost.setVisible(false);
      ring.setVisible(false);
      return null;
    }
    ghost.setTexture(GHOST_ART[stock]).setVisible(true);
    const world = this.cameras.main.getWorldPoint(cssX * DPR, cssY * DPR);
    const index = plotIndexAt(world.x, world.y);
    const cell = index === null ? null : this.cells.find((c) => c.plotIndex === index);
    if (index !== null && cell && cell.state === "empty") {
      const centre = cellCenter(index);
      const origin = cellOrigin(index);
      ghost.setPosition(centre.x, centre.y + 10).setAlpha(1);
      ring.clear().setVisible(true);
      ring.fillStyle(VIOLET, 0.2);
      ring.fillRoundedRect(origin.x + 3, origin.y + 3, CELL - 6, CELL - 6, 7);
      ring.lineStyle(2.2, VIOLET, 1);
      ring.strokeRoundedRect(origin.x + 3, origin.y + 3, CELL - 6, CELL - 6, 7);
      return index;
    }
    ghost.setPosition(world.x, world.y + 6).setAlpha(0.65);
    ring.setVisible(false);
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Effects                                                           */
  /* ---------------------------------------------------------------- */

  celebrateHarvest(plotIndex: number): void {
    const centre = cellCenter(plotIndex);
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

  private growChunk(cx: number, cy: number): Phaser.GameObjects.Image[] {
    const items: Phaser.GameObjects.Image[] = [];
    for (const item of chunkScenery(cx, cy)) {
      if (castsShadow(item.kind)) {
        items.push(
          this.put("shadow", item.x, item.y + 1, item.y - 0.5)
            .setScale((item.kind === "bush" ? 0.6 : 0.9) / S, 0.9 / S)
            .setAlpha(0.8),
        );
      }
      items.push(this.put(item.kind, item.x, item.y, item.y));
    }
    return items;
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
    const gx = Math.floor((view.x - 256) / 256) * 256;
    const gy = Math.floor((view.y - 256) / 256) * 256;
    grass.setPosition(gx, gy);
    grass.setSize(view.width + 768, view.height + 768);
    grass.tilePositionX = gx * GRASS_PX;
    grass.tilePositionY = gy * GRASS_PX;

    const cx0 = Math.floor((view.x - HOMESTEAD_CHUNK) / HOMESTEAD_CHUNK);
    const cy0 = Math.floor((view.y - HOMESTEAD_CHUNK) / HOMESTEAD_CHUNK);
    const cx1 = Math.floor((view.x + view.width + HOMESTEAD_CHUNK) / HOMESTEAD_CHUNK);
    const cy1 = Math.floor((view.y + view.height + HOMESTEAD_CHUNK) / HOMESTEAD_CHUNK);
    const keep = new Set<string>();
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const key = `${cx}:${cy}`;
        keep.add(key);
        if (!this.chunks.has(key)) this.chunks.set(key, this.growChunk(cx, cy));
      }
    }
    for (const [key, items] of this.chunks) {
      if (keep.has(key)) continue;
      const [cx, cy] = key.split(":").map(Number);
      if (cx < cx0 - 2 || cx > cx1 + 2 || cy < cy0 - 2 || cy > cy1 + 2) {
        for (const item of items) item.destroy();
        this.chunks.delete(key);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* The animals' day                                                   */
  /* ---------------------------------------------------------------- */

  update(time: number, delta: number): void {
    this.coast(delta);
    this.reportTracked();
    this.tendWorld();
    if (this.options.reducedMotion) return;

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
      for (const critter of node.critters) {
        critter.state = stepCritter(critter.state, pen, speed, delta, this.random);
        const hop = critter.state.mode === "walk" ? Math.abs(Math.sin(time / 90)) * 1.2 : 0;
        critter.sprite.x = critter.state.x - origin.x;
        critter.sprite.y = critter.state.y - origin.y - hop;
        critter.shadow.x = critter.sprite.x;
        critter.shadow.y = critter.state.y - origin.y + 1;
        critter.sprite.setFlipX(critter.state.facing === 1);
      }
      // The rings and the progress bar sit over everything in the cell,
      // including the near fence the animals walk behind.
      node.container.bringToTop(node.ring);
      node.container.bringToTop(node.afford);
      node.container.bringToTop(node.progress);
    }
  }
}
