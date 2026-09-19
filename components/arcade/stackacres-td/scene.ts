import Phaser from "phaser";
import { advance, findPath, steer, tileKey, type Grid, type Point } from "@/lib/stackacres-td/movement";
import {
  clampCentre,
  clampZoom,
  ease,
  nearestWholeZoom,
  settled,
  zoomRange,
  type ZoomRange,
} from "@/lib/stackacres-td/camera";
import {
  fieldMapToWorld,
  fieldWorldToMap,
  homeBedsMapToWorld,
  homeBedsWorldToMap,
  homeStarterTileToMap,
  inHomeStarterBeds,
  soilTileToMap,
  worldToMap,
  type TopdownArea,
} from "@/lib/stackacres-td/field";
import {
  BITE_SHAKE_MS,
  BITE_SHAKE_PX,
  BOBBER_BOB_MS,
  BOBBER_BOB_PX,
  SNAP_MS,
  bobberSpot,
  castAnimKey,
  castAnims,
  castSideFor,
  isCancellable,
  rodOutFrame,
  rollNibbleMs,
  type CastPhase,
  type CastSide,
} from "@/lib/stackacres-td/fishing-cast";
import { SOIL_TILE, createSoilMap, soilTileAt, soilTileKey, type SoilTile } from "@/lib/stackacres/soil";
import { isSoilTileEnriched } from "@/lib/stackacres/soil-enrich";
import type { SoilTier } from "@/lib/stackacres/soil-tiers";
import type { SectorId } from "@/lib/stackacres/sectors";
import type { HiddenZoneId } from "@/lib/stackacres/secrets";
import { WILD_AREA_TRAVELER, type TravelerId } from "@/lib/stackacres/story/travelers";
import { cropSpot, penFeedSpot, stockZone, type WorldPoint } from "@/lib/stackacres/world";
import type { MapPlaceId } from "@/lib/stackacres/map-places";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { StackAcresSceneUnit, StoryCues, TapPoint, TravelerUnlocks, UseSquare } from "../stackacres/world-contract";
import type { EmoteKind, EmoteTarget, FarmerAction } from "../stackacres/world-contract";
import { AmbientLife, type AmbientSpec } from "./ambient-life";
import { ChimneySmoke, type Emitter } from "./chimney-smoke";
import { DaylightLayer, type LightPoint } from "./daylight-layer";
import { PeopleLife } from "./people-life";
import { WindSway } from "./wind-sway";

/**
 * The top-down farm: the Homestead and the Old Fields, walked with tap-to-move or the thumb stick (joystick.tsx).
 *
 * It answers the shell's callbacks (../stackacres/world-contract.ts). Tapping a
 * thing walks the farmer over to it first, and the shell's menu opens when he
 * arrives.
 *
 * Everything static was drawn by the art pipeline and exported by art/stackacres-td/rich/export_rich.py:
 *   areas/<area>/ground-<f>.png   terrain, ground items, cast shadows, reflections; one per water frame (`frames`)
 *   areas/<area>/props.*          standing props, with what tapping each one does (`tag`) and a swaying part (`sway`)
 *   areas/<area>/area.json        props, NPCs, spawn, zones, exits, water that blocks walking, lights, emitters
 *   common/sprites.*              soil, crops, hens, cue bubbles, lamp glows, smoke puffs
 *   characters/<name>.*           the rig's sheets, reshaded
 * The player's real beds, crops and hens are drawn on top from the shell's props.
 *
 * Life runs here rather than in baked frames (docs/stackacres-premium-life.md): the time of day
 * (daylight-layer.ts), the wind (wind-sway.ts), chimney smoke (chimney-smoke.ts), critters (ambient-life.ts), and
 * people and hens breathing, blinking, pecking and greeting the farmer with emotes (people-life.ts).
 */

const ASSETS = "/stackacres-td";
const AREAS: TopdownArea[] = ["homestead", "oldfields", "fold", "pasture", "coast", "oak", "mine", "townsquare"];
const ENRICHED_SOIL_TINT = 0xd6f0b4;
const CHARACTERS = ["farmer", "ray", "pilgrim", "pierre", "ivy", "merchant", "wes", "miles", "barnaby", "skye", "bea", "brayden", "arthur", "leo"];
const TRAVELERS_ON_MAP: readonly TravelerId[] = ["pierre", "ivy", "wes", "miles", "barnaby", "skye", "bea", "brayden", "arthur", "leo"];

/** Every district with a scene of its own behind a gate on the Homestead (or the Fold). */
const SECTOR_AREAS: Partial<Record<ZoneId, TopdownArea>> = {
  wallow: "fold",
  oxfields: "pasture",
  coast: "coast",
  oak: "oak",
  mine: "mine",
  townsquare: "townsquare",
};
const AREA_SECTOR: Partial<Record<TopdownArea, ZoneId>> = {
  fold: "wallow",
  pasture: "oxfields",
  coast: "coast",
  oak: "oak",
  mine: "mine",
  townsquare: "townsquare",
};
/** Where to stand on the Homestead in front of the Crop Fields' north gate while it is still shut. */
const CROP_FIELDS_GATE_APPROACH: Point = { x: 232, y: 80 };
/**
 * Where a cast is thrown from: the shoulder of grass at the pier's north-east
 * corner, on the shore itself, with open water immediately west.
 *
 * Its own spot rather than the anchor below every other prop, for two reasons.
 * A cast has to be sideways -- the rig throws a rod left or right and has no
 * pose for throwing one at the camera (see lib/stackacres-td/fishing-cast.ts).
 * And the prop's usual step-up-from-below anchor lands out on the dirt road,
 * a pier's width from the pond, which put the bobber down on the planks.
 * Measured against the composited Homestead art, not guessed: tile (12, 25)
 * is walkable, and the point the rig's own fishing line ends at from here
 * (see `bobberSpot`) sits in open water with a clear margin all round.
 */
const DOCK_CAST_SPOT: Point = { x: 200, y: 404 };
/** Where to stand on the Homestead in front of a district's gate while it is still closed. */
const GATE_APPROACH: Partial<Record<ZoneId, Point>> = {
  wallow: { x: 636, y: 344 },
  coast: { x: 232, y: 470 },
  oak: { x: 104, y: 200 },
  mine: { x: 660, y: 72 },
  townsquare: { x: 640, y: 184 },
};

/** Where each pen's animals stand: the area, its spots zone, and how the grid of them is laid out. */
const PENS: Partial<Record<ZoneId, { area: TopdownArea; spots: string; cols: number; rowGap: number }>> = {
  henhaven: { area: "homestead", spots: "hen-spots", cols: 4, rowGap: 22 },
  wallow: { area: "fold", spots: "sheep-spots", cols: 5, rowGap: 26 },
  oxfields: { area: "pasture", spots: "cattle-spots", cols: 5, rowGap: 36 },
};
const WALK_SPEED = 72; // px/s; the rig's walk frames were timed for 44
const WATER_FRAME_MS = 170;
const REACH = 26; // how close the farmer stands before the shell's menu opens
const TAP_SLOP = 14; // css px a finger may drift and still count as a tap
/** Share of the remaining gap the camera closes per frame easing back onto the farmer. */
const CAMERA_RETURN_RATE = 0.18;
/** Same, for a pinch settling onto its whole-number zoom once the fingers lift. */
const ZOOM_SETTLE_RATE = 0.3;
/** Map px the camera may still be off the farmer and count as back on him. */
const CAMERA_HOME_EPSILON = 0.5;
/** Zoom the settle may still be short of a whole number and count as landed. */
const ZOOM_SETTLE_EPSILON = 0.01;

type Dir = "down" | "up" | "left" | "right";

/** The rig's sheets start with walk_down/up/left/right, four frames each; frame 1 of a walk is both feet down. */
const STANDING: Record<Dir, string> = { down: "1", up: "5", left: "9", right: "13" };

/**
 * Which rig animation acts out each drop, and how many extra times it plays.
 * Planting is the hoe stroke (the rig's `chop`): the harvest pose pulls a
 * carrot up, which would read as the opposite of sowing.
 */
const ACTIONS: Record<FarmerAction, { anim: string; repeat: number }> = {
  water: { anim: "water", repeat: 1 },
  harvest: { anim: "harvest", repeat: 0 },
  plant: { anim: "chop", repeat: 0 },
};

/** How far a walk may lean off his current facing before he turns, so a 45° diagonal doesn't flip him every frame. */
const TURN_LEAN = 0.6;

const DRAWN_CROPS = new Set(["carrot", "potato", "radish", "wheatsheaf"]);

interface PropSpec {
  frame: string;
  frames: string[];
  x: number;
  y: number;
  ax: number;
  ay: number;
  w: number;
  h: number;
  tag?: string;
  blocks: [number, number][];
  /** The part the wind moves, drawn over the rest at the same position. */
  sway?: { frame: string; amp: number; rustle: boolean };
}

interface AreaSpec {
  name: TopdownArea;
  width: number;
  height: number;
  tile: number;
  frames: number;
  spawn: Point;
  props: PropSpec[];
  npcs: { name: string; x: number; y: number }[];
  blocked: [number, number][];
  zones: { tag: string; x: number; y: number; w: number; h: number }[];
  exits: { to: TopdownArea; x: number; y: number; w: number; h: number; spawn: Point }[];
  lights: LightPoint[];
  emitters: Emitter[];
  ambient: AmbientSpec;
}

export interface TopdownCallbacks {
  onReady: () => void;
  onUseSquare: (square: UseSquare) => void;
  onGroundTap: (zone: ZoneId, at: TapPoint, world: WorldPoint) => void;
  onBarnTap: () => void;
  onSignpostTap: () => void;
  onWorkshopTap: () => void;
  onWellTap: (at: TapPoint) => void;
  onDockTap: (at: TapPoint) => void;
  onThicketTap: (at: TapPoint) => void;
  /** A finger landed on one of the Homestead's own choppable trees (see
   *  lib/stackacres/tree-nodes.ts's `WOOD_NODE_IDS` and area.json's own
   *  `tag: "tree:<id>"` props). `nodeId` is that id, unvalidated here --
   *  the shell is what knows the real catalogue. */
  onTreeTap: (nodeId: string, at: TapPoint) => void;
  /** A finger landed on one of the Mine's three tagged boulders (see
   *  lib/stackacres/stone-nodes.ts's `STONE_NODE_IDS` and area.json's own
   *  `tag: "stone:<id>"` props). `nodeId` is that id, unvalidated here --
   *  the shell is what knows the real catalogue. Same split `onTreeTap`
   *  already takes. */
  onStoneTap: (nodeId: string, at: TapPoint) => void;
  onGreenhouseTap: () => void;
  onMerchantTap: () => void;
  onMonkTap: (at: TapPoint) => void;
  onRayTap: (at: TapPoint) => void;
  onHouseTap: (at: TapPoint) => void;
  onTravelerTap: (traveler: TravelerId, at: TapPoint) => void;
  onSecretZoneTap: (zoneId: HiddenZoneId, at: TapPoint) => void;
  onLockedSectorTap: (zone: ZoneId, at: TapPoint) => void;
  onCropFieldsLockedTap: (at: TapPoint) => void;
  onViewMoved: () => void;
  /** The world has taken the farmer for a cast, or given him back. The shell
   *  stands the thumb stick and the Use key down for the duration: they are
   *  refused anyway, and leaving them lit reads as the game having frozen. */
  onInputLocked: (locked: boolean) => void;
}

/**
 * What a tap landed on. `anchor` is the map point the farmer walks to and the menu opens over;
 * `face` is what he turns to on arrival, or null for open ground he walks onto.
 */
type Target =
  | { kind: "unit"; id: string; anchor: Point; face: Point }
  | { kind: "npc"; name: string; anchor: Point; face: Point }
  | { kind: "tag"; tag: string; anchor: Point; face: Point | null }
  | { kind: "field"; anchor: Point; face: Point; world: WorldPoint }
  | { kind: "nothing" };

interface UnitNode {
  sprite: Phaser.GameObjects.Image;
  cue: Phaser.GameObjects.Image | null;
  signature: string;
}

/**
 * One cast, from the swing to whatever the gauge answered. `at` is where the
 * bobber sits in host CSS pixels, which is where the shell floats the cast's
 * own lines and where it anchored the gauge.
 */
interface CastRun {
  phase: CastPhase;
  side: CastSide;
  at: TapPoint;
  /** The float, sitting at the end of the line the RIG draws (see
   *  fishing-cast.ts's `LINE_END_DX`). The scene draws no line of its own. */
  bobber: Phaser.GameObjects.Ellipse;
  /** The nibble's countdown, cancelled if the player backs out first. */
  timer: Phaser.Time.TimerEvent | null;
}

export class TopdownScene extends Phaser.Scene {
  private readonly callbacks: TopdownCallbacks;
  private readonly host: HTMLElement;
  private specs = new Map<TopdownArea, AreaSpec>();
  private areaName: TopdownArea = "homestead";
  private area!: AreaSpec;
  private grid!: Grid;
  private layer: Phaser.GameObjects.GameObject[] = [];
  private ground!: Phaser.GameObjects.Image;
  private player!: Phaser.GameObjects.Sprite;
  /** Where the farmer really is. His sprite and the camera are both snapped from this to device pixels. */
  private pos: Point = { x: 0, y: 0 };
  /** Device pixels per art pixel, from topdown-world.tsx's `pickZoom`. */
  private zoom = 1;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private animated: { sprite: Phaser.GameObjects.Image; frames: string[] }[] = [];
  private propImages: { spec: PropSpec; image: Phaser.GameObjects.Image }[] = [];
  private npcSprites = new Map<string, { sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; cue: Phaser.GameObjects.Image | null }>();
  private soilImages: Phaser.GameObjects.Image[] = [];
  private unitNodes = new Map<string, UnitNode>();
  /** Soil tile key -> the crop standing on it, so a tap on the bed square picks the crop. */
  private unitTiles = new Map<string, string>();
  /** The same the other way round, so a crop that was walked to can name its own bed. */
  private tileOfUnit = new Map<string, { tx: number; ty: number }>();
  /** Beds that held a crop on the last draw, so an optimistic id being swapped for a real one does not re-pop. */
  private occupiedTiles = new Set<string>();
  /** The Use key is held (use-key.tsx), so stepping onto a new bed works it too. */
  private useDown = false;
  /** The last bed a held stroke worked, so one step never fires twice. */
  private stroked: string | null = null;
  /** An action animation is playing and must not be trampled by the walk cycle. */
  private acting = false;
  /** The cast in progress, or null. Its presence is the input lock. */
  private cast: CastRun | null = null;
  /** The bite's kick, decaying to nothing. Applied in `placeCamera`, because
   *  that sets the scroll outright every frame and would overwrite Phaser's
   *  own `shake` before it drew. */
  private shake = { left: 0, ms: 0 };
  private preview: Phaser.GameObjects.Graphics | null = null;
  private waterFrame = 0;
  private path: Point[] = [];
  private pending: Target | null = null;
  private facing: Dir = "down";
  private booted = false;
  private down: { x: number; y: number; t: number } | null = null;
  /**
   * The free camera (lib/stackacres-td/camera.ts). `following` is the normal
   * state: pinned to the farmer, snapped to device pixels, crisp. A drag or a
   * pinch drops it onto `centre` instead, and `returning` eases it home the
   * moment he moves again.
   */
  private following = true;
  private returning = false;
  private centre: Point = { x: 0, y: 0 };
  /** The follow zoom topdown-world.tsx picked for this canvas, and the whole steps a pinch may rest at. */
  private fitZoom = 1;
  private zooms: ZoomRange = { min: 1, max: 1 };
  /** Where a pinch is easing to once the fingers lift; equal to `zoom` whenever nothing is settling. */
  private zoomTarget = 1;
  /** Every finger currently down on the map, in host CSS pixels, so one can pan and two can pinch. */
  private touches = new Map<number, Point>();
  private gesture: "none" | "pan" | "pinch" = "none";
  /** What the pinch started from: the finger gap, the zoom, and the map point under the midpoint. */
  private pinch: { gap: number; zoom: number; anchor: Point } | null = null;
  /** The player has pinched, so a resize must re-clamp their zoom rather than yank it back to the follow zoom. */
  private zoomedByPlayer = false;
  /** The thumb stick's push: a direction whose length is the share of full speed, or null when let go. */
  private stick: Point | null = null;
  /** The stick moved him on the last frame; false while it pushes him into a wall. */
  private stickWalking = false;
  private daylight!: DaylightLayer;
  private readonly wind = new WindSway();
  private smoke!: ChimneySmoke;
  private life!: AmbientLife;
  private people!: PeopleLife;
  /** prefers-reduced-motion: the wind, smoke and lamp flicker stop; the time of day, cues and walking stay. */
  private reducedMotion = false;

  // What the shell last said, kept so an area rebuild can redraw it.
  private units: StackAcresSceneUnit[] = [];
  private soil: SoilTile[] = [];
  private cropFieldsUnlocked = false;
  private sectors: SectorId[] = [];
  private travelerUnlocks: Partial<Record<TravelerId, boolean>> = {};
  private storyCues: StoryCues = {};
  private merchantPresent = false;

  constructor(callbacks: TopdownCallbacks, host: HTMLElement) {
    super("stackacres-td");
    this.callbacks = callbacks;
    this.host = host;
  }

  preload(): void {
    for (const area of AREAS) {
      // An area ships only as many ground frames as its water needs, so load them once its JSON says how many.
      this.load.once(`filecomplete-json-area:${area}`, (_key: string, _type: string, data: AreaSpec) => {
        for (let f = 0; f < data.frames; f++) this.load.image(`ground:${area}:${f}`, `${ASSETS}/areas/${area}/ground-${f}.png`);
      });
      this.load.json(`area:${area}`, `${ASSETS}/areas/${area}/area.json`);
      this.load.atlas(`props:${area}`, `${ASSETS}/areas/${area}/props.png`, `${ASSETS}/areas/${area}/props.json`);
    }
    this.load.atlas("common", `${ASSETS}/common/sprites.png`, `${ASSETS}/common/sprites.json`);
    for (const name of CHARACTERS) {
      this.load.aseprite(name, `${ASSETS}/characters/${name}.png`, `${ASSETS}/characters/${name}.json`);
    }
  }

  create(): void {
    for (const area of AREAS) this.specs.set(area, this.cache.json.get(`area:${area}`) as AreaSpec);
    this.cameras.main.setRoundPixels(false).setZoom(this.zoom);
    this.time.addEvent({
      delay: WATER_FRAME_MS,
      loop: true,
      callback: () => {
        this.waterFrame = (this.waterFrame + 1) % this.area.frames;
        this.ground.setTexture(`ground:${this.areaName}:${this.waterFrame}`);
        for (const { sprite, frames } of this.animated) sprite.setFrame(frames[this.waterFrame % frames.length]);
      },
    });
    this.host.addEventListener("pointerdown", this.onPointerDown);
    this.host.addEventListener("pointermove", this.onPointerMove);
    this.host.addEventListener("pointerup", this.onPointerUp);
    this.host.addEventListener("pointercancel", this.onPointerCancel);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = motion.matches;
    const onMotion = (event: MediaQueryListEvent) => {
      this.reducedMotion = event.matches;
    };
    motion.addEventListener("change", onMotion);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.host.removeEventListener("pointerdown", this.onPointerDown);
      this.host.removeEventListener("pointermove", this.onPointerMove);
      this.host.removeEventListener("pointerup", this.onPointerUp);
      this.host.removeEventListener("pointercancel", this.onPointerCancel);
      motion.removeEventListener("change", onMotion);
    });
    this.daylight = new DaylightLayer(this, (object) => this.keep(object));
    this.smoke = new ChimneySmoke(this, (object) => this.keep(object));
    this.life = new AmbientLife(this, (object) => this.keep(object));
    this.people = new PeopleLife(this, (object) => this.keep(object), STANDING);
    // The cast's beats are cut out of the rig's own fishing tag, so they are
    // animations the sheet does not carry and this scene registers itself.
    // Once, here: an animation is a shared keyed thing in Phaser, and building
    // one mid-play blanks the sprite for a frame.
    for (const anim of castAnims()) {
      this.anims.create({
        key: anim.key,
        frames: anim.frames.map((frame) => ({ key: "farmer", frame: String(frame) })),
        frameRate: 1000 / anim.frameMs,
        repeat: anim.repeat,
        yoyo: anim.yoyo,
      });
    }
    this.enterArea("homestead", this.specs.get("homestead")!.spawn);
    this.booted = true;
    this.callbacks.onReady();
  }

  update(time: number, delta: number): void {
    if (this.stick) this.walkByStick(delta);
    else if (this.path.length > 0) this.walk(delta);
    if (this.useDown && this.isWalking()) this.useSquare(true);
    if (this.shake.ms > 0) this.shake.ms = Math.max(0, this.shake.ms - delta);
    this.easeCamera(delta);
    this.placeCamera();
    this.wind.update(time, this.pos, this.isWalking(), this.reducedMotion);
    this.smoke.update(time, this.reducedMotion);
    this.daylight.update(time, this.reducedMotion);
    this.life.update(time, this.daylight.hour(), this.reducedMotion, this.cameras.main.worldView);
    this.people.update(
      time,
      { sprite: this.player, x: this.pos.x, y: this.pos.y, facing: this.facing, walking: this.isWalking() },
      this.daylight.hour(),
      this.reducedMotion,
      this.hasCue,
    );
  }

  private walk(delta: number): void {
    const from = this.pos;
    // Face along the segment he is on, not the last frame's step, so the walk only turns at a waypoint.
    const next = this.path[0];
    if (Math.hypot(next.x - from.x, next.y - from.y) > 0.01) this.facing = this.headingFor(next.x - from.x, next.y - from.y);
    this.playWalk(WALK_SPEED);
    const { at, path } = advance(from, this.path, (WALK_SPEED * delta) / 1000);
    this.path = path;
    this.setPlayerAt(at);
    if (this.takeExit(at)) return;
    if (this.path.length === 0) this.arrive();
  }

  /** The stick walks him directly, sliding along whatever he pushes into; a tap walk in progress gives way to it. */
  private walkByStick(delta: number): void {
    const stick = this.stick!;
    if (this.path.length > 0 || this.pending) {
      this.path = [];
      this.pending = null;
      this.clearMarker();
    }
    const speed = WALK_SPEED * Math.hypot(stick.x, stick.y);
    // A slow phone still walks at full speed, but a long stall (a tab coming back) isn't one big lurch.
    const at = steer(this.grid, this.pos, stick, (speed * Math.min(delta, 100)) / 1000);
    this.facing = this.headingFor(stick.x, stick.y);
    if (Math.hypot(at.x - this.pos.x, at.y - this.pos.y) > 0.001) {
      this.playWalk(speed);
      this.setPlayerAt(at);
      this.stickWalking = true;
      this.takeExit(at);
      return;
    }
    // Pushed into a wall: stand facing it, so he reads as blocked rather than walking on the spot.
    if (this.stickWalking || this.player.frame.name !== STANDING[this.facing]) this.stand();
    this.stickWalking = false;
  }

  private playWalk(speed: number): void {
    // A stroke acts each bed out while he keeps moving (Kayo's call), so the
    // action animation owns the sprite until it finishes; the walk resumes after.
    if (this.acting) return;
    const key = `walk_${this.facing}`;
    const timeScale = speed / 44;
    if (this.player.anims.currentAnim?.key !== key || !this.player.anims.isPlaying) {
      this.player.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onActionDone);
      this.player.play({ key, repeat: -1, timeScale });
    } else {
      this.player.anims.timeScale = timeScale;
    }
  }

  /** Stepping into an exit to an area he may enter takes him there. */
  private takeExit(at: Point): boolean {
    const exit = this.area.exits.find(
      (e) => at.x >= e.x && at.x < e.x + e.w && at.y >= e.y && at.y < e.y + e.h && this.canEnter(e.to),
    );
    if (!exit) return false;
    this.path = [];
    this.pending = null;
    this.enterArea(exit.to, exit.spawn);
    this.callbacks.onViewMoved();
    return true;
  }

  /** Bought land can only be walked into once it is owned, whatever path the farmer found to its edge. */
  private canEnter(area: TopdownArea): boolean {
    const sector = AREA_SECTOR[area];
    return sector === undefined || this.opened(sector);
  }

  /** A wild area opens with its traveler (the shell pushes `travelerUnlocks`); bought land opens when owned. */
  private opened(zone: ZoneId): boolean {
    const traveler = WILD_AREA_TRAVELER[zone];
    return traveler ? this.travelerUnlocks[traveler] === true : this.sectors.includes(zone);
  }

  private headingFor(dx: number, dy: number): Dir {
    const horizontal: Dir = dx > 0 ? "right" : "left";
    const vertical: Dir = dy > 0 ? "down" : "up";
    if (this.facing === horizontal && Math.abs(dx) >= Math.abs(dy) * TURN_LEAN) return horizontal;
    if (this.facing === vertical && Math.abs(dy) >= Math.abs(dx) * TURN_LEAN) return vertical;
    return Math.abs(dx) > Math.abs(dy) ? horizontal : vertical;
  }

  private snap(v: number): number {
    return Math.round(v * this.zoom) / this.zoom;
  }

  private setPlayerAt(at: Point): void {
    this.pos = at;
    const x = this.snap(at.x);
    const y = this.snap(at.y);
    this.player.setPosition(x, y).setDepth(y);
    this.playerShadow.setPosition(x + 1, y + 1);
  }

  /**
   * Centres the camera on the farmer, snapped to device pixels, every frame.
   *
   * This replaces Phaser's `startFollow` with rounding, which floored the
   * camera and the sprite separately in whole art pixels: whenever the
   * farmer's position and the view's half-width fell on opposite sides of a
   * pixel, he jumped a pixel against the screen and back. Snapping both from
   * the same point keeps him still on screen while the ground slides.
   *
   * A pan or a pinch centres it on `centre` instead of on him (camera.ts).
   * The snapping is the same either way, so a settled free camera is exactly
   * as crisp as a following one.
   */
  private placeCamera(): void {
    const cam = this.cameras.main;
    const viewW = cam.width / this.zoom;
    const viewH = cam.height / this.zoom;
    const mapW = this.area.width * this.area.tile;
    const mapH = this.area.height * this.area.tile;
    const wanted = this.following ? this.pos : this.centre;
    const at = clampCentre({ x: this.snap(wanted.x), y: this.snap(wanted.y) }, viewW, viewH, mapW, mapH);
    // Kept in step while following, so a pan starts from what is on screen rather than from a stale point.
    if (this.following) this.centre = at;
    // The bite's kick: a whole device pixel either way, alternating, so it
    // reads as a jolt rather than as the camera drifting.
    const kick = this.shake.ms > 0 ? (Math.round(this.shake.ms / 40) % 2 === 0 ? this.shake.left : -this.shake.left) : 0;
    const left = this.snap(at.x - viewW / 2 + kick);
    const top = this.snap(at.y - viewH / 2);
    // Phaser zooms about the camera's centre, so scroll is the view's left edge shifted by the zoomed-away margin.
    cam.setScroll(left + viewW / 2 - cam.width / 2, top + viewH / 2 - cam.height / 2);
  }

  // ------------------------------------------------------------------ areas

  private enterArea(name: TopdownArea, spawn: Point): void {
    // A cast's bobber and line are kept objects on the old area's layer, so a
    // rebuild would leave the run pointing at destroyed sprites and the input
    // lock on forever. Dropping it here is the one place that cannot happen.
    if (this.cast) {
      this.cast.timer?.remove();
      this.cast = null;
      this.callbacks.onInputLocked(false);
    }
    this.acting = false;
    for (const object of this.layer) object.destroy();
    this.layer = [];
    this.animated = [];
    this.propImages = [];
    this.wind.clear();
    this.people.clear();
    this.npcSprites.clear();
    this.soilImages = [];
    this.unitNodes.clear();
    this.preview = null;
    this.marker = null;

    this.areaName = name;
    this.area = this.specs.get(name)!;

    this.ground = this.keep(this.add.image(0, 0, `ground:${name}:${this.waterFrame % this.area.frames}`).setOrigin(0, 0).setDepth(-10));
    for (const spec of this.area.props) {
      const image = this.keep(this.add.image(spec.x - spec.ax, spec.y - spec.ay, `props:${name}`, spec.frame).setOrigin(0, 0).setDepth(spec.y));
      this.propImages.push({ spec, image });
      if (spec.frames.length > 1) this.animated.push({ sprite: image, frames: spec.frames });
      if (spec.sway) {
        const part = this.keep(this.add.image(image.x, image.y, `props:${name}`, spec.sway.frame).setOrigin(0, 0).setDepth(spec.y + 0.5));
        this.wind.add(part, spec.x, spec.y, spec.sway.amp, spec.sway.rustle);
      }
    }
    for (const npc of this.area.npcs) {
      const sprite = this.keep(this.add.sprite(npc.x, npc.y, npc.name, STANDING.down).setOrigin(0.5, 44 / 48).setDepth(npc.y));
      this.anims.createFromAseprite(npc.name, undefined, sprite);
      this.people.addNpc(npc.name, sprite);
      const shadow = this.keep(this.add.ellipse(npc.x + 1, npc.y + 1, 13, 4, 0x140c1c, 0.28).setDepth(-1));
      this.npcSprites.set(npc.name, { sprite, shadow, cue: null });
    }

    this.player = this.keep(this.add.sprite(spawn.x, spawn.y, "farmer", STANDING[this.facing]).setOrigin(0.5, 44 / 48).setDepth(spawn.y));
    this.anims.createFromAseprite("farmer", undefined, this.player);
    this.playerShadow = this.keep(this.add.ellipse(spawn.x + 1, spawn.y + 1, 13, 4, 0x140c1c, 0.28).setDepth(-1));
    this.setPlayerAt(spawn);
    this.resetCamera();
    this.daylight.build(this.area.width * this.area.tile, this.area.height * this.area.tile, this.area.lights);
    this.smoke.build(this.area.emitters);
    this.life.build(this.area.ambient, this.area.width * this.area.tile, this.area.height * this.area.tile);

    this.applyGates();
    this.applyNpcs();
    this.drawSoil();
    this.drawUnits();
  }

  private keep<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.layer.push(object);
    return object;
  }

  /** The log across the north lane stands until the Crop Fields are unlocked, and blocks the way while it does. */
  private applyGates(): void {
    const blocked = new Set(this.area.blocked.map(([tx, ty]) => tileKey(tx, ty)));
    for (const { spec, image } of this.propImages) {
      const [kind, detail] = (spec.tag ?? "").split(":") as [string, ZoneId | undefined];
      const cleared = kind === "locked" && detail !== undefined && SECTOR_AREAS[detail] !== undefined && this.opened(detail);
      const visible = !((spec.tag === "gate:oldfields" && this.cropFieldsUnlocked) || cleared);
      image.setVisible(visible);
      if (visible) for (const [tx, ty] of spec.blocks) blocked.add(tileKey(tx, ty));
    }
    this.grid = { width: this.area.width, height: this.area.height, tile: this.area.tile, blocked };
  }

  private npcVisible(name: string): boolean {
    if (name === "merchant") return this.merchantPresent;
    if ((TRAVELERS_ON_MAP as readonly string[]).includes(name)) return this.travelerUnlocks[name as TravelerId] === true;
    return true;
  }

  private applyNpcs(): void {
    for (const [name, node] of this.npcSprites) {
      const visible = this.npcVisible(name);
      node.sprite.setVisible(visible);
      node.shadow.setVisible(visible);
      node.cue?.destroy();
      node.cue = null;
      const cue = this.storyCues[name as TravelerId];
      if (visible && cue) {
        node.cue = this.keep(
          this.add.image(node.sprite.x, node.sprite.y - 34, "common", cue === "ready" ? "cue_quest_ready" : "cue_available").setDepth(10_000),
        );
        this.bob(node.cue);
      }
    }
  }

  // ------------------------------------------------------------------ soil and units

  /** Which map, if any, `this.areaName` draws soil on, and how a tile's
   *  world corner lands there. The Old Fields hold every purchased Crop
   *  Fields bed; the Homestead holds only the free starter lattice
   *  (`homeStarterSoilTiles`) -- see lib/stackacres-td/field.ts's own header
   *  on why the two never share an origin. */
  private soilToMapFor(areaName: string): ((tx: number, ty: number) => { x: number; y: number }) | null {
    if (areaName === "oldfields") return soilTileToMap;
    if (areaName === "homestead") return homeStarterTileToMap;
    return null;
  }

  /** The inverse of `soilToMapFor`, for a map pixel on the current area: which
   *  soil world point (if any) it names. Null off both lattices, or in any
   *  area that has no beds at all. */
  private mapToSoilWorld(map: { x: number; y: number }): WorldPoint | null {
    if (this.areaName === "oldfields") return fieldMapToWorld(map);
    if (this.areaName === "homestead") return homeBedsMapToWorld(map);
    return null;
  }

  private drawSoil(): void {
    for (const image of this.soilImages) image.destroy();
    this.soilImages = [];
    const toMap = this.soilToMapFor(this.areaName);
    if (!toMap) return;
    // Both maps share one lattice key space (soil.ts's `soilTileKey`), so the
    // neighbour mask below only ever lights up for a tile actually drawn on
    // THIS map: a Crop Fields bed and a starter bed are never adjacent (see
    // `HOME_STARTER_ORIGIN`'s own comment), so cross-map neighbours never
    // exist to mask against in the first place.
    const map = createSoilMap(this.soil);
    const onThisMap = (tile: SoilTile) =>
      this.areaName === "oldfields" ? !inHomeStarterBeds({ x: tile.tx * SOIL_TILE, y: tile.ty * SOIL_TILE }) : inHomeStarterBeds({ x: tile.tx * SOIL_TILE, y: tile.ty * SOIL_TILE });
    for (const tile of this.soil) {
      if (!onThisMap(tile)) continue;
      const has = (dx: number, dy: number) => map.has(soilTileKey(tile.tx + dx, tile.ty + dy));
      const mask = (has(0, -1) ? 1 : 0) | (has(1, 0) ? 2 : 0) | (has(0, 1) ? 4 : 0) | (has(-1, 0) ? 8 : 0);
      const at = toMap(tile.tx, tile.ty);
      const tier: SoilTier = tile.tier ?? "dirt";
      const image = this.add.image(at.x, at.y, "common", `soil_${tier}_${mask}`).setOrigin(0, 0).setDepth(-5);
      // A bean-fed bed reads a touch greener until the next crop spends it.
      if (isSoilTileEnriched(tile)) image.setTint(ENRICHED_SOIL_TINT);
      this.soilImages.push(this.keep(image));
    }
  }

  private unitPlacement(unit: StackAcresSceneUnit): { x: number; y: number } | null {
    if (unit.housedIn) return null;
    const zone = stockZone(unit.stock);
    if (zone === "farmstead") {
      const world = cropSpot("farmstead", unit.id, { soil: createSoilMap(this.soil), slot: unit.soilSlot ?? null });
      // A slotted crop resolves to whichever bed its slot names -- the Old
      // Fields' purchased lattice or the Homestead's own starter one -- and
      // only draws on the map that bed actually stands on. The slot-less
      // fallback inside `cropSpot` always lands inside `CROP_FIELD_BEDS`
      // (see that function's own header), so it only ever draws in the Old
      // Fields.
      if (this.areaName === "oldfields" && !inHomeStarterBeds(world)) return fieldWorldToMap(world);
      if (this.areaName === "homestead" && inHomeStarterBeds(world)) return homeBedsWorldToMap(world);
      return null;
    }
    const pen = PENS[zone];
    if (pen && this.areaName === pen.area) {
      const spots = this.area.zones.find((z) => z.tag === pen.spots);
      if (!spots) return null;
      const herd = this.units.filter((u) => stockZone(u.stock) === zone).map((u) => u.id).sort();
      const i = herd.indexOf(unit.id);
      return {
        x: spots.x + 12 + ((i % pen.cols) * (spots.w - 24)) / (pen.cols - 1),
        y: spots.y + 14 + Math.floor(i / pen.cols) * pen.rowGap,
      };
    }
    return null;
  }

  private unitFrame(unit: StackAcresSceneUnit): string {
    const zone = stockZone(unit.stock);
    const side = unit.id.charCodeAt(unit.id.length - 1) % 2 ? "left" : "right";
    if (zone === "henhaven") return `hen_${side}`;
    if (zone === "wallow") return `sheep_${side}`;
    if (zone === "oxfields") return unit.id.charCodeAt(0) % 2 ? `cattle_${side}` : `cattle_${side}_plain`;
    if (unit.state === "mucked") return "crop_withered";
    const stage = unit.state === "ready" ? 2 : (unit.progress ?? 0) < 0.5 ? 0 : 1;
    return DRAWN_CROPS.has(unit.stock) ? `crop_${unit.stock}_${stage}` : `crop_generic_${stage}`;
  }

  private unitCue(unit: StackAcresSceneUnit): string | null {
    if (unit.state === "dry") return "cue_water";
    if (unit.state === "hungry") return "cue_hungry";
    if (unit.state === "ready") return "cue_ready";
    return null;
  }

  private drawUnits(): void {
    const seen = new Set<string>();
    // Which beds held a crop on the last draw. A crop sown optimistically is
    // drawn under an id this browser invented, and the server's answer replaces
    // it with a real one -- a different id on the SAME bed, which without this
    // reads as a brand-new crop and pops a second time a beat after the first.
    const held = this.occupiedTiles;
    this.occupiedTiles = new Set();
    this.unitTiles.clear();
    this.tileOfUnit.clear();
    for (const unit of this.units) {
      const at = this.unitPlacement(unit);
      if (!at) continue;
      seen.add(unit.id);
      let tileKey: string | null = null;
      const world = this.mapToSoilWorld(at);
      if (world) {
        const { tx, ty } = soilTileAt(world.x, world.y);
        tileKey = soilTileKey(tx, ty);
        this.unitTiles.set(tileKey, unit.id);
        this.tileOfUnit.set(unit.id, { tx, ty });
        this.occupiedTiles.add(tileKey);
      }
      const frame = this.unitFrame(unit);
      const cue = this.unitCue(unit);
      const signature = `${frame}|${cue}|${at.x},${at.y}`;
      const existing = this.unitNodes.get(unit.id);
      if (existing?.signature === signature) continue;
      const isNew = !existing;
      existing?.sprite.destroy();
      existing?.cue?.destroy();
      const animal = PENS[stockZone(unit.stock)] !== undefined;
      const baseY = animal ? at.y : at.y + 6;
      const sprite = this.keep(this.add.image(at.x, baseY, "common", frame).setOrigin(0.5, 1).setDepth(baseY));
      let cueImage: Phaser.GameObjects.Image | null = null;
      if (cue) {
        cueImage = this.keep(this.add.image(at.x, baseY - sprite.height - 5, "common", cue).setDepth(10_000));
        this.bob(cueImage);
      }
      this.unitNodes.set(unit.id, { sprite, cue: cueImage, signature });
      // A crop this small, on a bed the farmer is standing right next to, is otherwise easy to
      // miss under his own swing and the toast that lands on the same spot -- see stackacres-farm.tsx's
      // "Seeded" toast. Skipped for a livestock purchase: those show up in Hen Haven, screens away
      // from wherever the shop sheet was, so there is nothing on screen for a spawn to compete with.
      // A bed that already had a crop on the last draw is the same crop under its
      // real id, not a new one, so it does not pop again.
      if (isNew && !animal && !(tileKey !== null && held.has(tileKey))) this.popUnit(unit.id);
    }
    for (const [id, node] of this.unitNodes) {
      if (seen.has(id)) continue;
      node.sprite.destroy();
      node.cue?.destroy();
      this.unitNodes.delete(id);
    }
    this.people.syncHens(
      [...this.unitNodes].map(([id, node]): [string, Phaser.GameObjects.Image] => [id, node.sprite]),
      this.time.now,
    );
  }

  private bob(image: Phaser.GameObjects.Image): void {
    this.tweens.add({ targets: image, y: image.y - 2, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  // ------------------------------------------------------------------ input

  private onPointerDown = (event: PointerEvent): void => {
    // Captured so a drag that leaves the canvas keeps panning instead of sticking mid-gesture.
    try {
      this.host.setPointerCapture(event.pointerId);
    } catch {
      // Some pointer ids cannot be captured (a mouse leaving the window mid-drag). The drag still works.
    }
    this.touches.set(event.pointerId, this.hostPoint(event));
    if (this.touches.size === 1) {
      this.down = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      return;
    }
    // A second finger is never a tap, whatever the first one was doing.
    this.down = null;
    if (this.touches.size === 2) this.startPinch();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.touches.has(event.pointerId)) return;
    const was = this.touches.get(event.pointerId)!;
    const now = this.hostPoint(event);
    this.touches.set(event.pointerId, now);
    if (this.touches.size >= 2) {
      this.movePinch();
      return;
    }
    const down = this.down;
    // One finger only pans once it has travelled past the slop a tap is allowed to drift.
    if (this.gesture === "none") {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) <= TAP_SLOP) return;
      this.gesture = "pan";
      this.down = null;
      this.takeCamera();
    }
    if (this.gesture !== "pan") return;
    this.panBy(was.x - now.x, was.y - now.y);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.down;
    const gesture = this.gesture;
    this.releaseTouch(event.pointerId);
    if (this.touches.size > 0) return;
    if (gesture !== "none") return;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP) return;
    this.tapAt(event.clientX, event.clientY);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.releaseTouch(event.pointerId);
  };

  /** A finger left the map: drop it, and settle whatever gesture it was part of once it was the last one. */
  private releaseTouch(pointerId: number): void {
    this.touches.delete(pointerId);
    try {
      this.host.releasePointerCapture(pointerId);
    } catch {
      // Never captured, or already released. Nothing to undo.
    }
    if (this.gesture === "pinch" && this.touches.size < 2) {
      // The fingers are off: ease to the nearest zoom the art is crisp at (camera.ts's own header).
      this.pinch = null;
      this.zoomTarget = nearestWholeZoom(this.zoom, this.zooms);
    }
    if (this.touches.size === 0) {
      this.gesture = "none";
      this.down = null;
    }
  }

  private hostPoint(event: PointerEvent): Point {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // ------------------------------------------------------------- free camera

  /**
   * Takes the camera off the farmer and leaves it exactly where it already is,
   * so a pan or a pinch starts from what is on screen rather than jumping.
   * Closes whatever menu was open, the same as walking off does.
   */
  private takeCamera(): void {
    if (this.following) {
      this.centre = this.cameraCentre();
      this.following = false;
      this.callbacks.onViewMoved();
    }
    this.returning = false;
  }

  /**
   * The farmer is moving, so the camera comes back to him (Kayo's call: the
   * stick or a tap-to-move is what ends a look around). Eased rather than cut,
   * because a cut after a pan reads as the map teleporting.
   */
  private homeCamera(): void {
    if (!this.following) this.returning = true;
  }

  /**
   * Straight back onto him at the follow zoom, no ease: a new area has its own
   * size and its own bounds, so both how far a pinch may pull back and what
   * easing across the gap would even mean are different here.
   */
  private resetCamera(): void {
    this.following = true;
    this.returning = false;
    this.gesture = "none";
    this.pinch = null;
    this.touches.clear();
    this.zoomedByPlayer = false;
    const cam = this.cameras.main;
    this.zooms = zoomRange(
      cam.width,
      cam.height,
      this.area.width * this.area.tile,
      this.area.height * this.area.tile,
      this.fitZoom,
    );
    this.zoomTarget = this.fitZoom;
    this.applyZoom(this.fitZoom);
  }

  /** Where the camera is centred right now, in map pixels. */
  private cameraCentre(): Point {
    const view = this.cameras.main.worldView;
    return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  }

  private panBy(dxCss: number, dyCss: number): void {
    this.centre = {
      x: this.centre.x + dxCss * this.scaleX(),
      y: this.centre.y + dyCss * this.scaleY(),
    };
    this.clampFreeCentre();
  }

  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    if (gap < 1) return;
    this.takeCamera();
    this.gesture = "pinch";
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = { gap, zoom: this.zoom, anchor: this.cssToMap(mid.x, mid.y) };
  }

  /**
   * A live pinch. The zoom follows the fingers exactly, whole number or not --
   * a gesture that snaps under the thumb feels broken, and `releaseTouch`
   * settles it the instant they lift. The map point the pinch started on stays
   * under the midpoint, so it zooms into what is being pinched.
   */
  private movePinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const [a, b] = [...this.touches.values()];
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    if (gap < 1) return;
    this.zoomedByPlayer = true;
    const next = clampZoom((pinch.zoom * gap) / pinch.gap, this.zooms);
    this.applyZoom(next);
    this.zoomTarget = next;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.centre = {
      x: pinch.anchor.x - (mid.x - this.host.clientWidth / 2) * this.scaleX(),
      y: pinch.anchor.y - (mid.y - this.host.clientHeight / 2) * this.scaleY(),
    };
    this.clampFreeCentre();
  }

  private clampFreeCentre(): void {
    const cam = this.cameras.main;
    this.centre = clampCentre(
      this.centre,
      cam.width / this.zoom,
      cam.height / this.zoom,
      this.area.width * this.area.tile,
      this.area.height * this.area.tile,
    );
  }

  private applyZoom(zoom: number): void {
    this.zoom = zoom;
    if (!this.booted) return;
    this.cameras.main.setZoom(zoom);
    this.setPlayerAt(this.pos);
    this.placeCamera();
  }

  /** One frame of the camera easing home and of a pinch settling onto its whole step. */
  private easeCamera(delta: number): void {
    if (this.returning) {
      this.centre = {
        x: ease(this.centre.x, this.pos.x, CAMERA_RETURN_RATE, delta),
        y: ease(this.centre.y, this.pos.y, CAMERA_RETURN_RATE, delta),
      };
      if (
        settled(this.centre.x, this.pos.x, CAMERA_HOME_EPSILON) &&
        settled(this.centre.y, this.pos.y, CAMERA_HOME_EPSILON)
      ) {
        this.returning = false;
        this.following = true;
      }
    }
    if (this.gesture === "pinch" || this.zoom === this.zoomTarget) return;
    const next = ease(this.zoom, this.zoomTarget, ZOOM_SETTLE_RATE, delta);
    this.applyZoom(settled(next, this.zoomTarget, ZOOM_SETTLE_EPSILON) ? this.zoomTarget : next);
  }

  /** A tap at a viewport point: find what it landed on, walk there, and hand it to the shell on arrival. */
  tapAt(clientX: number, clientY: number): void {
    if (!this.booted) return;
    // A cast owns the farmer until it resolves. Before the fish is on, a tap
    // anywhere reels the line back in; after it, the tap is swallowed and the
    // gauge has the screen.
    if (this.cast) {
      this.cancelCast();
      return;
    }
    // Whatever this tap turns out to be, it is the farmer's business, so the camera comes back off a pan.
    this.homeCamera();
    const rect = this.host.getBoundingClientRect();
    const map = this.cssToMap(clientX - rect.left, clientY - rect.top);
    const target = this.targetAt(map);
    // On the Crop Fields he walks ONTO the bed, because the belt works the
    // square under his feet and there is no menu left for him to stand clear of.
    // An animal in a pen still gets approached from below rather than stood on.
    const onField = this.areaName === "oldfields" && (target.kind === "unit" || target.kind === "field");
    const goal =
      target.kind === "nothing"
        ? map
        : onField
          ? target.anchor
          : target.kind === "unit"
            ? { x: target.anchor.x, y: target.anchor.y + SOIL_TILE * 2 + 2 }
            : target.anchor;
    const from = this.pos;
    this.pending = target.kind === "nothing" ? null : target;
    if (this.pending && target.kind !== "nothing" && Math.hypot(target.anchor.x - from.x, target.anchor.y - from.y) <= REACH) {
      this.path = [];
      this.arrive();
      return;
    }
    this.path = findPath(this.grid, from, goal);
    if (this.path.length === 0) {
      this.arrive();
      return;
    }
    this.callbacks.onViewMoved();
    this.drawMarker(this.path[this.path.length - 1]);
  }

  private targetAt(map: Point): Target {
    // Crops are small, so a finger gets a few pixels of grace around each one.
    const hitImage = (image: Phaser.GameObjects.Image, pad: number) =>
      image.visible && Phaser.Geom.Rectangle.Inflate(image.getBounds(), pad, pad).contains(map.x, map.y);

    let best: { target: Target; depth: number } | null = null;
    const consider = (target: Target, depth: number) => {
      if (!best || depth > best.depth) best = { target, depth };
    };

    for (const [id, node] of this.unitNodes) {
      const onBubble = node.cue ? hitImage(node.cue, 2) : false;
      if (hitImage(node.sprite, 3) || onBubble) consider({ kind: "unit", id, anchor: { x: node.sprite.x, y: node.sprite.y - 2 }, face: { x: node.sprite.x, y: node.sprite.y - 2 } }, node.sprite.depth + 1000);
    }
    if (best) return (best as { target: Target }).target;

    for (const [name, node] of this.npcSprites) {
      if (!node.sprite.visible) continue;
      const box = new Phaser.Geom.Rectangle(node.sprite.x - 9, node.sprite.y - 30, 18, 32);
      if (box.contains(map.x, map.y)) consider({ kind: "npc", name, anchor: { x: node.sprite.x, y: node.sprite.y + 10 }, face: { x: node.sprite.x, y: node.sprite.y } }, node.sprite.depth);
    }
    for (const { spec, image } of this.propImages) {
      if (!spec.tag || !image.visible) continue;
      if (!image.getBounds().contains(map.x, map.y)) continue;
      // The dock is walked to from its dry end and cast from side-on, so it
      // wants its own spot rather than the step-up-from-below every other prop
      // is approached with. The face point is due west along the planks, which
      // is what turns him toward the water.
      if (spec.tag === "dock") {
        consider({ kind: "tag", tag: spec.tag, anchor: DOCK_CAST_SPOT, face: { x: spec.x - spec.w, y: DOCK_CAST_SPOT.y } }, spec.y);
        continue;
      }
      consider({ kind: "tag", tag: spec.tag, anchor: { x: spec.x, y: spec.y + 10 }, face: { x: spec.x, y: spec.y } }, spec.y);
    }
    if (best) return (best as { target: Target }).target;

    for (const zone of this.area.zones) {
      if (map.x < zone.x || map.y < zone.y || map.x >= zone.x + zone.w || map.y >= zone.y + zone.h) continue;
      if (zone.tag === "field") {
        const world = fieldMapToWorld(map);
        if (!world) continue;
        const { tx, ty } = soilTileAt(world.x, world.y);
        const centre = fieldWorldToMap({ x: tx * SOIL_TILE + SOIL_TILE / 2, y: ty * SOIL_TILE + SOIL_TILE / 2 });
        // A tap anywhere on a planted bed means its crop:
        // a sprout is a few pixels, and the bed square is what a finger actually hits.
        const planted = this.unitTiles.get(soilTileKey(tx, ty));
        const node = planted ? this.unitNodes.get(planted) : undefined;
        if (planted && node) return { kind: "unit", id: planted, anchor: { x: node.sprite.x, y: node.sprite.y - 2 }, face: { x: node.sprite.x, y: node.sprite.y - 2 } };
        return { kind: "field", anchor: centre, face: centre, world: { x: tx * SOIL_TILE + SOIL_TILE / 2, y: ty * SOIL_TILE + SOIL_TILE / 2 } };
      }
      // The Homestead's own free starter beds -- the small functional patch
      // inside the "homebeds" zone's larger, mostly decorative dirt (see
      // lib/stackacres-td/field.ts's own header). A tap that lands off the
      // real lattice falls through to the plain "tag" target below, which
      // `fire()`'s `case "homebeds"` still answers with the old deny line.
      if (zone.tag === "homebeds") {
        const world = homeBedsMapToWorld(map);
        if (!world) return { kind: "tag", tag: zone.tag, anchor: { x: Math.round(map.x), y: Math.round(map.y) }, face: null };
        const { tx, ty } = soilTileAt(world.x, world.y);
        const centre = homeBedsWorldToMap({ x: tx * SOIL_TILE + SOIL_TILE / 2, y: ty * SOIL_TILE + SOIL_TILE / 2 });
        const planted = this.unitTiles.get(soilTileKey(tx, ty));
        const node = planted ? this.unitNodes.get(planted) : undefined;
        if (planted && node) return { kind: "unit", id: planted, anchor: { x: node.sprite.x, y: node.sprite.y - 2 }, face: { x: node.sprite.x, y: node.sprite.y - 2 } };
        return { kind: "field", anchor: centre, face: centre, world: { x: tx * SOIL_TILE + SOIL_TILE / 2, y: ty * SOIL_TILE + SOIL_TILE / 2 } };
      }
      if (zone.tag === "hen-spots") continue;
      return { kind: "tag", tag: zone.tag, anchor: { x: Math.round(map.x), y: Math.round(map.y) }, face: null };
    }
    return { kind: "nothing" };
  }

  /** The walk is over: if it was toward something, stop facing it and let the shell open its menu. */
  private arrive(): void {
    this.clearMarker();
    const target = this.pending;
    this.pending = null;
    if (target && target.kind !== "nothing" && target.face) {
      // Turn to what he walked to: the crop or bed above him, the person or prop in front.
      const dx = target.face.x - this.pos.x;
      const dy = target.face.y - this.pos.y;
      if (Math.hypot(dx, dy) > 2) this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    }
    this.stand();
    if (!target || target.kind === "nothing") return;
    const distance = Math.hypot(target.anchor.x - this.pos.x, target.anchor.y - this.pos.y);
    if (distance > REACH * 2.5) {
      this.floatAt(this.mapToCss(target.anchor), "Can't reach that from here", "deny");
      this.emote("farmer", "sweat");
      return;
    }
    this.fire(target);
  }

  private stand(): void {
    this.player.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onActionDone);
    this.player.anims.stop();
    this.acting = false;
    this.player.setFrame(STANDING[this.facing]);
    this.people.stood(this.time.now);
  }

  private onActionDone = (): void => {
    this.acting = false;
    if (this.path.length === 0) this.player.setFrame(STANDING[this.facing]);
    this.people.stood(this.time.now);
  };

  private hasCue = (name: string): boolean => Boolean(this.npcSprites.get(name)?.cue);

  /** An emote bubble over the farmer or someone on the map (see people-life.ts). */
  emote(who: EmoteTarget, kind: EmoteKind): void {
    if (!this.booted) return;
    this.people.emote(who, kind, this.time.now, this.player, this.hasCue);
  }

  /**
   * The shell's belt action landed: act it out, facing whatever he is standing on.
   *
   * It plays while he is walking too, which is what makes a held stroke read as
   * one continuous job rather than a row of beds changing on their own; `playWalk`
   * stands back for the duration (see `acting`).
   */
  farmerAction(action: FarmerAction): void {
    if (!this.booted || this.cast) return;
    const { anim, repeat } = ACTIONS[action];
    this.stand();
    this.acting = true;
    this.player.once(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onActionDone);
    this.player.play({ key: `${anim}_${this.facing}`, repeat });
  }

  private fire(target: Target): void {
    const cb = this.callbacks;
    // A crop, an animal or a bed is the belt's business now: the shell asks the
    // held tool what to do here (lib/stackacres/toolbelt.ts). Props, people and
    // doors below still open what they always opened.
    if (target.kind === "unit") {
      const node = this.unitNodes.get(target.id);
      const at = node ? this.mapToCss({ x: node.sprite.x, y: node.sprite.y - node.sprite.height / 2 }) : this.mapToCss(target.anchor);
      cb.onUseSquare({ tile: this.tileOfUnit.get(target.id) ?? null, unitId: target.id, at, stroke: false });
      return;
    }
    if (target.kind === "field") {
      const { tx, ty } = soilTileAt(target.world.x, target.world.y);
      cb.onUseSquare({ tile: { tx, ty }, unitId: null, at: this.mapToCss(target.anchor), stroke: false });
      return;
    }
    if (target.kind === "npc") {
      const node = this.npcSprites.get(target.name);
      const at = this.mapToCss(node ? { x: node.sprite.x, y: node.sprite.y - 20 } : target.anchor);
      if (target.name === "ray") cb.onRayTap(at);
      else if (target.name === "pilgrim") cb.onMonkTap(at);
      else if (target.name === "merchant") cb.onMerchantTap();
      else cb.onTravelerTap(target.name as TravelerId, at);
      return;
    }
    if (target.kind !== "tag") return;
    const at = this.mapToCss({ x: target.anchor.x, y: target.anchor.y - 16 });
    const [kind, detail] = target.tag.split(":") as [string, string | undefined];
    switch (kind) {
      case "barn":
        return cb.onBarnTap();
      case "signpost":
        return cb.onSignpostTap();
      case "workshop":
        return cb.onWorkshopTap();
      case "well":
        return cb.onWellTap(at);
      case "dock":
        // The world plays the whole cast out before the shell hears anything:
        // `onDockTap` fires on the bite, not on the tap (see `beginCast`).
        return this.beginCast();
      case "thicket":
        return cb.onThicketTap(at);
      case "tree":
        return cb.onTreeTap(detail ?? "", at);
      case "stone":
        return cb.onStoneTap(detail ?? "", at);
      case "greenhouse":
        return cb.onGreenhouseTap();
      case "farmhouse":
        return cb.onHouseTap(at);
      case "secret":
        return cb.onSecretZoneTap(detail as HiddenZoneId, at);
      case "pen":
        return cb.onGroundTap(detail as ZoneId, at, penFeedSpot(detail as ZoneId));
      case "gate":
        return this.cropFieldsUnlocked ? undefined : cb.onCropFieldsLockedTap(at);
      case "locked":
        if (this.sectors.includes(detail as SectorId)) {
          this.floatAt(at, "That land isn't in this preview yet", "deny");
          return;
        }
        return cb.onLockedSectorTap(detail as ZoneId, at);
      case "homebeds":
        this.floatAt(at, "Crops grow in the Crop Fields, up the north lane", "deny");
        return;
    }
  }

  /**
   * The thumb stick (joystick.tsx): a direction whose length is the share of full speed, or null when let go.
   * Taking hold of it closes whatever menu was open, the same as walking off does.
   */
  /**
   * The Use key (use-key.tsx): work the square under his feet with whatever the
   * belt is holding. Held down, every new bed he steps onto is worked as he
   * reaches it, which is how a row gets watered or hoed in one walk.
   */
  setUseHeld(down: boolean): void {
    if (!this.booted) return;
    // Same as a tap during a cast: it backs out of a line that has not been
    // taken yet, and does nothing once the fight has started.
    if (this.cast) {
      if (down) this.cancelCast();
      return;
    }
    this.useDown = down;
    if (!down) {
      this.stroked = null;
      return;
    }
    this.useSquare(false);
  }

  /**
   * Hands the shell the square he is on. A stroke skips a bed it has already
   * worked and anything off the field, so walking a row fires once per bed and
   * a walk across the yard fires nothing.
   */
  private useSquare(stroke: boolean): void {
    const world = this.mapToSoilWorld(this.pos);
    const tile = world ? soilTileAt(world.x, world.y) : null;
    const key = tile ? soilTileKey(tile.tx, tile.ty) : null;
    if (stroke && (key === null || key === this.stroked)) return;
    this.stroked = key;
    const unitId = key !== null ? this.unitTiles.get(key) ?? null : this.nearestUnit();
    this.callbacks.onUseSquare({ tile, unitId, at: this.mapToCss(this.pos), stroke });
  }

  /** Off the field there are no beds, so Use reaches for whatever he is standing beside. */
  private nearestUnit(): string | null {
    let best: { id: string; distance: number } | null = null;
    for (const [id, node] of this.unitNodes) {
      if (!node.sprite.visible) continue;
      const distance = Math.hypot(node.sprite.x - this.pos.x, node.sprite.y - this.pos.y);
      if (distance <= REACH && (!best || distance < best.distance)) best = { id, distance };
    }
    return best?.id ?? null;
  }

  setStick(push: Point | null): void {
    if (!this.booted) return;
    // The stick is refused outright for the whole cast, the fight included --
    // it is its own DOM element beside the canvas, so the gauge's capture-phase
    // grip on the canvas does nothing about it. It does not back a cast out
    // either: a thumb resting on the stick is not a decision to stop fishing.
    if (this.cast) return;
    const was = this.stick;
    this.stick = push;
    if (push) this.homeCamera();
    if (push && !was) this.callbacks.onViewMoved();
    if (!push && was) {
      if (this.stickWalking && this.path.length === 0) this.stand();
      this.stickWalking = false;
    }
  }

  // ------------------------------------------------------------------ fishing

  /**
   * A cast, from the swing to whatever the gauge answers.
   *
   * He has already walked to `DOCK_CAST_SPOT` and turned to the water by the
   * time this runs (see `targetAt`'s dock case and `arrive`). From here the
   * world owns him: input is locked, the beats run on their own timers, and
   * the shell hears nothing until the bite, when `onDockTap` puts the gauge
   * up. The gauge's answer comes back through `endFishingCast`.
   *
   * Replaced the drag-the-rod-out-of-a-circle overlay, which asked for one
   * gesture to cast and a second, opposite one to land a fish it had already
   * decided was caught. A tap starts this; the only thing left to miss is the
   * gauge.
   */
  private beginCast(): void {
    if (this.cast) return;
    const dock = this.propImages.find(({ spec }) => spec.tag === "dock");
    if (!dock) return;

    this.path = [];
    this.pending = null;
    this.stick = null;
    this.useDown = false;
    this.stroked = null;
    this.clearMarker();

    // Turned to the water before he is stood up, so the one frame between the
    // two is already the right way round.
    const side = castSideFor(this.pos.x, dock.spec.x);
    this.facing = side;
    this.stand();

    const spot = bobberSpot(this.pos, side);
    // Hidden through the swing, shown once the rod is out: the rig only draws
    // the line on the last two frames, and a float sitting out on the water
    // with nothing attached to it reads as a bug.
    const bobber = this.keep(
      this.add.ellipse(spot.x, spot.y, 3, 3, 0xd8564a).setStrokeStyle(1, 0x140c1c).setDepth(spot.y).setVisible(false),
    );
    const run: CastRun = { phase: "cast", side, at: this.mapToCss(spot), bobber, timer: null };
    this.cast = run;
    this.callbacks.onInputLocked(true);

    this.acting = true;
    this.playCastAnim("cast", () => this.nibbleStance(run));
  }

  /** Rod out, line in the water, nothing on it yet. */
  private nibbleStance(run: CastRun): void {
    if (this.cast !== run) return;
    run.phase = "nibble";
    this.player.anims.stop();
    this.player.setFrame(rodOutFrame(run.side));
    run.bobber.setVisible(true);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: run.bobber,
        y: run.bobber.y - BOBBER_BOB_PX,
        duration: BOBBER_BOB_MS / 2,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    run.timer = this.time.delayedCall(rollNibbleMs(), () => this.bite(run));
  }

  /** Something took it. The gauge is the shell's to open, so this only says so. */
  private bite(run: CastRun): void {
    if (this.cast !== run) return;
    run.phase = "tension";
    run.timer = null;
    this.tweens.killTweensOf(run.bobber);
    this.splashAt(run.bobber.x, run.bobber.y);
    if (!this.reducedMotion) this.shake = { left: BITE_SHAKE_PX, ms: BITE_SHAKE_MS };
    this.emote("farmer", "exclaim");
    this.player.play({ key: castAnimKey("tension", run.side) });
    this.callbacks.onDockTap(run.at);
  }

  /**
   * The gauge is done. Landed pulls the catch up out of the water; escaped
   * snaps the rod back with nothing on it. Either way the line comes in and
   * he has himself back.
   */
  endFishingCast(outcome: "landed" | "escaped"): void {
    const run = this.cast;
    if (!run || run.phase !== "tension") return;
    this.tweens.killTweensOf(run.bobber);
    if (outcome === "landed") {
      run.phase = "reel";
      this.splashAt(run.bobber.x, run.bobber.y);
      run.bobber.setVisible(false);
      this.playCastAnim("reel", () => this.playCastAnim("lift", () => this.finishCast()));
      return;
    }
    run.phase = "snap";
    run.bobber.setVisible(false);
    this.player.anims.stop();
    this.player.setFrame(rodOutFrame(run.side));
    // The recoil of a line going slack: he rocks away from the water and back.
    const kick = run.side === "left" ? 3 : -3;
    this.tweens.add({
      targets: this.player,
      x: this.player.x + kick,
      duration: SNAP_MS / 2,
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => this.finishCast(),
    });
  }

  /** A tap or the Use key before the fish was on: reel in, say nothing. */
  private cancelCast(): void {
    const run = this.cast;
    if (!run || !isCancellable(run.phase)) return;
    run.timer?.remove();
    run.timer = null;
    this.tweens.killTweensOf(run.bobber);
    run.bobber.setVisible(false);
    run.phase = "reel";
    this.playCastAnim("reel", () => this.finishCast());
  }

  private finishCast(): void {
    const run = this.cast;
    if (!run) return;
    this.cast = null;
    this.callbacks.onInputLocked(false);
    run.timer?.remove();
    this.tweens.killTweensOf(run.bobber);
    this.tweens.killTweensOf(this.player);
    run.bobber.destroy();
    this.setPlayerAt(this.pos);
    this.stand();
  }

  /** One beat of the cast, with its own completion handler and nobody else's. */
  private playCastAnim(beat: "cast" | "tension" | "reel" | "lift", then: () => void): void {
    const run = this.cast;
    if (!run) return;
    this.player.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
    this.player.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.cast === run) then();
    });
    this.player.play({ key: castAnimKey(beat, run.side) });
  }

  /** A ring spreading off the water, for a bite and again for a catch. */
  private splashAt(x: number, y: number): void {
    const ring = this.keep(this.add.ellipse(x, y, 6, 3).setStrokeStyle(1, 0x6fc6f2).setDepth(y + 0.2));
    this.tweens.add({
      targets: ring,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 460,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ------------------------------------------------------------------ coordinates

  /** Art pixels per host CSS pixel. */
  private scaleX(): number {
    return this.cameras.main.worldView.width / Math.max(1, this.host.clientWidth);
  }

  private scaleY(): number {
    return this.cameras.main.worldView.height / Math.max(1, this.host.clientHeight);
  }

  private cssToMap(x: number, y: number): Point {
    const view = this.cameras.main.worldView;
    return { x: view.x + x * this.scaleX(), y: view.y + y * this.scaleY() };
  }

  private mapToCss(p: Point): TapPoint {
    const view = this.cameras.main.worldView;
    return { x: (p.x - view.x) / this.scaleX(), y: (p.y - view.y) / this.scaleY() };
  }

  // ------------------------------------------------------------------ the shell's api

  setUnits(units: StackAcresSceneUnit[]): void {
    this.units = units;
    if (this.booted) this.drawUnits();
  }

  setSoil(tiles: readonly SoilTile[]): void {
    this.soil = [...tiles];
    if (!this.booted) return;
    this.drawSoil();
    this.drawUnits();
  }

  soilTiles(): SoilTile[] {
    return [...this.soil];
  }

  placeSoilAt(x: number, y: number, tier?: SoilTier): boolean {
    const { tx, ty } = soilTileAt(x, y);
    if (this.soil.some((t) => t.tx === tx && t.ty === ty)) return false;
    const order = this.soil.reduce((max, t) => Math.max(max, t.order), 0) + 1;
    this.setSoil([...this.soil, { tx, ty, order, origin: "purchased", tier }]);
    return true;
  }

  removeSoilAt(x: number, y: number): boolean {
    const { tx, ty } = soilTileAt(x, y);
    const next = this.soil.filter((t) => t.tx !== tx || t.ty !== ty);
    if (next.length === this.soil.length) return false;
    this.setSoil(next);
    return true;
  }

  setCropFieldsUnlocked(unlocked: boolean): void {
    this.cropFieldsUnlocked = unlocked;
    if (this.booted) this.applyGates();
  }

  setSectors(sectors: SectorId[]): void {
    this.sectors = sectors;
    if (this.booted) this.applyGates();
  }

  setTravelerUnlocks(unlocked: TravelerUnlocks): void {
    this.travelerUnlocks = unlocked;
    if (!this.booted) return;
    this.applyNpcs();
    this.applyGates();
  }

  setStoryCues(cues: StoryCues): void {
    this.storyCues = cues;
    if (this.booted) this.applyNpcs();
  }

  setMerchant(present: boolean): void {
    this.merchantPresent = present;
    if (this.booted) this.applyNpcs();
  }

  popUnit(unitId: string): void {
    const node = this.unitNodes.get(unitId);
    if (!node) return;
    this.tweens.add({ targets: node.sprite, scaleX: 1.2, scaleY: 0.85, duration: 70, yoyo: true, ease: "Quad.easeOut" });
  }

  celebrate(unitIds: readonly string[]): void {
    if (unitIds.length > 0) this.emote("farmer", "sparkle");
    unitIds.forEach((id, i) => {
      const node = this.unitNodes.get(id);
      if (!node) return;
      this.time.delayedCall(i * 60, () => {
        this.popUnit(id);
        for (let k = 0; k < 6; k++) {
          const angle = (Math.PI * 2 * k) / 6;
          const spark = this.keep(this.add.rectangle(node.sprite.x, node.sprite.y - 8, 2, 2, 0xdad45e).setDepth(10_001));
          this.tweens.add({
            targets: spark,
            x: node.sprite.x + Math.cos(angle) * 12,
            y: node.sprite.y - 8 + Math.sin(angle) * 12,
            alpha: 0,
            duration: 420,
            onComplete: () => spark.destroy(),
          });
        }
      });
    });
  }

  /** Floating text over the map, as a DOM element in the host so it stays crisp at any zoom. */
  floatAt(at: TapPoint, text: string, tone: "gain" | "deny"): void {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, {
      position: "absolute",
      left: `${at.x}px`,
      top: `${at.y}px`,
      transform: "translate(-50%, -100%)",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      font: "700 15px var(--font-sa-display, system-ui), system-ui, sans-serif",
      color: tone === "gain" ? "#dad45e" : "#deeed6",
      background: tone === "deny" ? "rgba(20, 12, 28, 0.78)" : "transparent",
      padding: tone === "deny" ? "3px 8px" : "0",
      borderRadius: "6px",
      textShadow: "0 1px 0 #140c1c, 0 0 3px #140c1c",
      zIndex: "5",
    } satisfies Partial<CSSStyleDeclaration>);
    this.host.appendChild(el);
    const animation = el.animate(
      [
        { opacity: 0, transform: "translate(-50%, -80%)" },
        { opacity: 1, transform: "translate(-50%, -110%)", offset: 0.15 },
        { opacity: 1, transform: "translate(-50%, -150%)", offset: 0.75 },
        { opacity: 0, transform: "translate(-50%, -170%)" },
      ],
      { duration: tone === "deny" ? 1600 : 1100, easing: "ease-out" },
    );
    animation.onfinish = () => el.remove();
  }

  /** A world point the shell cares about, in host CSS pixels, when it is on the map the player is looking at. */
  fieldPointFor(worldX: number, worldY: number): TapPoint | null {
    if (!this.booted) return null;
    const map = worldToMap({ x: worldX, y: worldY });
    if (!map || map.area !== this.areaName) return null;
    return this.mapToCss(map);
  }

  previewSoilAt(world: WorldPoint | null): void {
    this.preview?.destroy();
    this.preview = null;
    if (!world || this.areaName !== "oldfields") return;
    const { tx, ty } = soilTileAt(world.x, world.y);
    const at = soilTileToMap(tx, ty);
    this.preview = this.keep(this.add.graphics().setDepth(-4));
    this.preview.lineStyle(1, 0xdeeed6, 1).strokeRect(at.x + 0.5, at.y + 0.5, SOIL_TILE - 1, SOIL_TILE - 1);
  }

  /**
   * topdown-world.tsx picks the follow zoom from the host's size and the device
   * pixel ratio. That also fixes how far a pinch may pull back (the whole area
   * on screen) and push in, so the range is rebuilt here on every resize.
   *
   * A player who has pinched keeps their own zoom across a resize, only
   * re-clamped to the new range; one who has not rides the follow zoom.
   */
  setZoom(zoom: number): void {
    this.fitZoom = zoom;
    if (!this.booted) {
      this.zoom = zoom;
      this.zoomTarget = zoom;
      return;
    }
    const cam = this.cameras.main;
    this.zooms = zoomRange(
      cam.width,
      cam.height,
      this.area.width * this.area.tile,
      this.area.height * this.area.tile,
      zoom,
    );
    const next = this.zoomedByPlayer ? nearestWholeZoom(this.zoom, this.zooms) : zoom;
    this.zoomTarget = next;
    this.applyZoom(next);
  }

  /**
   * The shell's camera controls, for anything that wants them without a
   * gesture. A step is a whole zoom, never a fraction, so the art is crisp the
   * moment it lands (camera.ts).
   */
  zoomBy(factor: number): void {
    if (!this.booted) return;
    this.zoomedByPlayer = true;
    this.zoomTarget = nearestWholeZoom(this.zoomTarget + (factor > 1 ? 1 : -1), this.zooms);
  }

  /** Puts the camera back on the farmer, the same ease a walk does. */
  recenter(): void {
    if (this.booted) this.homeCamera();
  }

  /** The district panel's travel buttons: the two home districts are on the Homestead; the rest aren't built yet. */
  focusZone(zone: MapPlaceId): void {
    if (!this.booted) return;
    // The Crop Fields are ground on the Homestead rather than a district, so
    // they are not in SECTOR_AREAS: open, walk into the field; shut, stand at
    // the north gate, where a tap says what opens it.
    if (zone === "cropfields") {
      this.path = [];
      this.pending = null;
      if (this.cropFieldsUnlocked) this.enterArea("oldfields", this.specs.get("oldfields")!.spawn);
      else this.enterArea("homestead", CROP_FIELDS_GATE_APPROACH);
      this.callbacks.onViewMoved();
      return;
    }
    const sectorArea = SECTOR_AREAS[zone];
    if (sectorArea) {
      this.path = [];
      this.pending = null;
      // Open: go there. Not yet: stand at its gate on the Homestead, where tapping the gate says what opens it.
      if (this.opened(zone)) this.enterArea(sectorArea, this.specs.get(sectorArea)!.spawn);
      // The Pasture's gate is the fallen fence inside the Fold, which itself may still be shut.
      else if (zone === "oxfields" && this.opened("wallow")) this.enterArea("fold", { x: 396, y: 184 });
      else this.enterArea("homestead", GATE_APPROACH[zone === "oxfields" ? "wallow" : zone]!);
      this.callbacks.onViewMoved();
      return;
    }
    if (zone === "farmstead" || zone === "henhaven") {
      const spawn = zone === "henhaven" ? { x: 450, y: 370 } : this.specs.get("homestead")!.spawn;
      this.path = [];
      this.pending = null;
      this.enterArea("homestead", spawn);
      this.callbacks.onViewMoved();
      return;
    }
    this.floatAt({ x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 }, "That place isn't in this preview yet", "deny");
  }

  // ------------------------------------------------------------------ dev handle (e2e specs, never production)

  /** A map point in viewport CSS pixels, for a real pointer event. */
  clientPointFor(x: number, y: number): TapPoint {
    const rect = this.host.getBoundingClientRect();
    const at = this.mapToCss({ x, y });
    return { x: rect.left + at.x, y: rect.top + at.y };
  }

  /** The middle of a visible NPC's body, or null when they aren't on this map. */
  npcPoint(name: string): Point | null {
    const node = this.npcSprites.get(name);
    return node?.sprite.visible ? { x: node.sprite.x, y: node.sprite.y - 14 } : null;
  }

  /** Where the farmer really is, in world units -- the same space
   *  lib/stackacres/hunt-proximity.ts plays its stalk in. Read fresh every
   *  frame rather than cached, since the joystick keeps moving him while a
   *  stalk is up. */
  farmerPoint(): Point {
    return { ...this.pos };
  }

  /** A world point (farmer position, a wandering animal) projected to CSS
   *  pixels relative to the canvas host -- the same box every DOM overlay on
   *  this screen is positioned in. Public alias of `mapToCss` for
   *  HuntScopeScene's floating alert gauge, which follows the animal instead
   *  of owning a screen-space layer of its own. */
  screenPoint(p: Point): TapPoint {
    return this.mapToCss(p);
  }

  /** Puts the farmer straight down somewhere, so a spec needn't walk across the map first. */
  placeFarmer(area: TopdownArea, at: Point): void {
    this.path = [];
    this.pending = null;
    this.enterArea(area, at);
    this.callbacks.onViewMoved();
  }

  /** Which map place the farmer is standing in, for the map sheet's "you are here". */
  currentPlace(): MapPlaceId {
    if (this.areaName === "oldfields") return "cropfields";
    return AREA_SECTOR[this.areaName] ?? "farmstead";
  }

  /**
   * e2e only (through the dev-only `__stackacres` handle): what the camera is
   * doing, so a spec can tell a pan from a walk and check that a pinch really
   * did settle on a whole-number zoom.
   */
  cameraState(): { zoom: number; following: boolean; centre: Point } {
    return { zoom: this.zoom, following: this.following, centre: { ...this.centre } };
  }

  isWalking(): boolean {
    return this.path.length > 0 || this.stickWalking;
  }

  /** Pins the time of day to an hour (0-24) to preview dusk and night, or null for the player's local clock. */
  setClock(hour: number | null): void {
    this.daylight.setOverride(hour);
  }

  /** Cloud shadows drifting over the map. Off by default until Kayo has seen them. */
  setCloudShadows(on: boolean): void {
    this.life.setClouds(on);
  }

  private marker: Phaser.GameObjects.Graphics | null = null;

  private drawMarker(at: Point): void {
    this.clearMarker();
    this.marker = this.keep(this.add.graphics().setDepth(-3));
    this.marker.lineStyle(1, 0xdeeed6, 0.9).strokeCircle(at.x, at.y, 3);
  }

  private clearMarker(): void {
    this.marker?.destroy();
    this.marker = null;
  }
}
