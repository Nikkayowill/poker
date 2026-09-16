import Phaser from "phaser";
import { advance, findPath, tileKey, type Grid, type Point } from "@/lib/stackacres-td/movement";
import {
  fieldMapToWorld,
  fieldWorldToMap,
  soilTileToMap,
  worldToMap,
  type TopdownArea,
} from "@/lib/stackacres-td/field";
import { SOIL_TILE, createSoilMap, soilTileAt, soilTileKey, type SoilTile } from "@/lib/stackacres/soil";
import type { SoilTier } from "@/lib/stackacres/soil-tiers";
import type { SectorId } from "@/lib/stackacres/sectors";
import type { HiddenZoneId } from "@/lib/stackacres/secrets";
import type { TravelerId } from "@/lib/stackacres/story/travelers";
import { cropSpot, penFeedSpot, stockZone, type WorldPoint } from "@/lib/stackacres/world";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { StackAcresSceneUnit, StoryCues, TapPoint, TravelerUnlocks } from "../stackacres/stackacres-scene";
import type { FarmerAction } from "../stackacres/stackacres-world";

/**
 * The top-down farm: the Homestead and the Old Fields, walked with tap-to-move.
 *
 * It answers the same callbacks the isometric scene does (see
 * stackacres-world.tsx's `StackAcresWorldProps`), so the whole React shell,
 * its menus and its server actions work unchanged. The one difference in feel
 * is deliberate: tapping a thing walks the farmer over to it first, and the
 * shell's menu opens when he arrives.
 *
 * Everything static was drawn by the area rig and exported by export.py:
 *   areas/<area>/ground-<f>.png   terrain, ground items, prop shadows, one per water frame
 *   areas/<area>/props.*          standing props, with what tapping each one does (`tag`)
 *   areas/<area>/area.json        props, NPCs, spawn, zones, exits, water that blocks walking
 *   common/sprites.*              soil, crops, hens, cue bubbles
 *   characters/<name>.*           the rig's Aseprite sheets
 * The player's real beds, crops and hens are drawn on top from the shell's props.
 */

const ASSETS = "/stackacres-td";
const AREAS: TopdownArea[] = ["homestead", "oldfields"];
const CHARACTERS = ["farmer", "ray", "pilgrim", "pierre", "ivy", "merchant"];
const TRAVELERS_ON_MAP: readonly TravelerId[] = ["pierre", "ivy"];
const WALK_SPEED = 72; // px/s; the rig's walk frames were timed for 44
const WATER_FRAME_MS = 170;
const REACH = 26; // how close the farmer stands before the shell's menu opens
const TAP_SLOP = 14; // css px a finger may drift and still count as a tap

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
  plant: { anim: "chop", repeat: 1 },
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
}

export interface TopdownCallbacks {
  onReady: () => void;
  onUnitTap: (unitId: string, at: TapPoint) => void;
  onGroundTap: (zone: ZoneId, at: TapPoint, world: WorldPoint) => void;
  onBarnTap: () => void;
  onSignpostTap: () => void;
  onWorkshopTap: () => void;
  onWellTap: (at: TapPoint) => void;
  onDockTap: (at: TapPoint) => void;
  onGreenhouseTap: () => void;
  onMerchantTap: () => void;
  onMonkTap: (at: TapPoint) => void;
  onRayTap: (at: TapPoint) => void;
  onTravelerTap: (traveler: TravelerId, at: TapPoint) => void;
  onSecretZoneTap: (zoneId: HiddenZoneId, at: TapPoint) => void;
  onLockedSectorTap: (zone: ZoneId, at: TapPoint) => void;
  onCropFieldsLockedTap: (at: TapPoint) => void;
  onViewMoved: () => void;
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
  private preview: Phaser.GameObjects.Graphics | null = null;
  private waterFrame = 0;
  private path: Point[] = [];
  private pending: Target | null = null;
  private facing: Dir = "down";
  private booted = false;
  private down: { x: number; y: number; t: number } | null = null;

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
      this.load.json(`area:${area}`, `${ASSETS}/areas/${area}/area.json`);
      for (let f = 0; f < 4; f++) this.load.image(`ground:${area}:${f}`, `${ASSETS}/areas/${area}/ground-${f}.png`);
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
    this.host.addEventListener("pointerup", this.onPointerUp);
    this.host.addEventListener("pointercancel", this.onPointerCancel);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.host.removeEventListener("pointerdown", this.onPointerDown);
      this.host.removeEventListener("pointerup", this.onPointerUp);
      this.host.removeEventListener("pointercancel", this.onPointerCancel);
    });
    this.enterArea("homestead", this.specs.get("homestead")!.spawn);
    this.booted = true;
    this.callbacks.onReady();
  }

  update(_time: number, delta: number): void {
    if (this.path.length > 0) this.walk(delta);
    this.placeCamera();
  }

  private walk(delta: number): void {
    const from = this.pos;
    // Face along the segment he is on, not the last frame's step, so the walk only turns at a waypoint.
    const next = this.path[0];
    if (Math.hypot(next.x - from.x, next.y - from.y) > 0.01) this.facing = this.headingFor(next.x - from.x, next.y - from.y);
    const key = `walk_${this.facing}`;
    if (this.player.anims.currentAnim?.key !== key || !this.player.anims.isPlaying) {
      this.player.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onActionDone);
      this.player.play({ key, repeat: -1, timeScale: WALK_SPEED / 44 });
    }
    const { at, path } = advance(from, this.path, (WALK_SPEED * delta) / 1000);
    this.path = path;
    this.setPlayerAt(at);
    const exit = this.area.exits.find((e) => at.x >= e.x && at.x < e.x + e.w && at.y >= e.y && at.y < e.y + e.h);
    if (exit) {
      this.path = [];
      this.pending = null;
      this.enterArea(exit.to, exit.spawn);
      this.callbacks.onViewMoved();
      return;
    }
    if (this.path.length === 0) this.arrive();
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
   */
  private placeCamera(): void {
    const cam = this.cameras.main;
    const viewW = cam.width / this.zoom;
    const viewH = cam.height / this.zoom;
    const mapW = this.area.width * this.area.tile;
    const mapH = this.area.height * this.area.tile;
    const edge = (centre: number, view: number, map: number) =>
      view >= map ? (map - view) / 2 : Math.min(Math.max(centre - view / 2, 0), map - view);
    const left = this.snap(edge(this.snap(this.pos.x), viewW, mapW));
    const top = this.snap(edge(this.snap(this.pos.y), viewH, mapH));
    // Phaser zooms about the camera's centre, so scroll is the view's left edge shifted by the zoomed-away margin.
    cam.setScroll(left + viewW / 2 - cam.width / 2, top + viewH / 2 - cam.height / 2);
  }

  // ------------------------------------------------------------------ areas

  private enterArea(name: TopdownArea, spawn: Point): void {
    for (const object of this.layer) object.destroy();
    this.layer = [];
    this.animated = [];
    this.propImages = [];
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
    }
    for (const npc of this.area.npcs) {
      const sprite = this.keep(this.add.sprite(npc.x, npc.y, npc.name, STANDING.down).setOrigin(0.5, 44 / 48).setDepth(npc.y));
      const shadow = this.keep(this.add.ellipse(npc.x + 1, npc.y + 1, 13, 4, 0x140c1c, 0.28).setDepth(-1));
      this.npcSprites.set(npc.name, { sprite, shadow, cue: null });
    }

    this.player = this.keep(this.add.sprite(spawn.x, spawn.y, "farmer", STANDING[this.facing]).setOrigin(0.5, 44 / 48).setDepth(spawn.y));
    this.anims.createFromAseprite("farmer", undefined, this.player);
    this.playerShadow = this.keep(this.add.ellipse(spawn.x + 1, spawn.y + 1, 13, 4, 0x140c1c, 0.28).setDepth(-1));
    this.setPlayerAt(spawn);
    this.placeCamera();

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
      const visible = !(spec.tag === "gate:oldfields" && this.cropFieldsUnlocked);
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

  private drawSoil(): void {
    for (const image of this.soilImages) image.destroy();
    this.soilImages = [];
    if (this.areaName !== "oldfields") return;
    const map = createSoilMap(this.soil);
    for (const tile of this.soil) {
      const has = (dx: number, dy: number) => map.has(soilTileKey(tile.tx + dx, tile.ty + dy));
      const mask = (has(0, -1) ? 1 : 0) | (has(1, 0) ? 2 : 0) | (has(0, 1) ? 4 : 0) | (has(-1, 0) ? 8 : 0);
      const at = soilTileToMap(tile.tx, tile.ty);
      const tier: SoilTier = tile.tier ?? "dirt";
      this.soilImages.push(this.keep(this.add.image(at.x, at.y, "common", `soil_${tier}_${mask}`).setOrigin(0, 0).setDepth(-5)));
    }
  }

  private unitPlacement(unit: StackAcresSceneUnit): { x: number; y: number } | null {
    if (unit.housedIn) return null;
    const zone = stockZone(unit.stock);
    if (zone === "farmstead") {
      if (this.areaName !== "oldfields") return null;
      const world = cropSpot("farmstead", unit.id, { soil: createSoilMap(this.soil), slot: unit.soilSlot ?? null });
      return fieldWorldToMap(world);
    }
    if (zone === "henhaven" && this.areaName === "homestead") {
      const spots = this.area.zones.find((z) => z.tag === "hen-spots");
      if (!spots) return null;
      const hens = this.units.filter((u) => stockZone(u.stock) === "henhaven").map((u) => u.id).sort();
      const i = hens.indexOf(unit.id);
      const cols = 4;
      return { x: spots.x + 12 + ((i % cols) * (spots.w - 24)) / (cols - 1), y: spots.y + 14 + Math.floor(i / cols) * 22 };
    }
    return null;
  }

  private unitFrame(unit: StackAcresSceneUnit): string {
    if (stockZone(unit.stock) === "henhaven") return unit.id.charCodeAt(unit.id.length - 1) % 2 ? "hen_left" : "hen_right";
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
    this.unitTiles.clear();
    for (const unit of this.units) {
      const at = this.unitPlacement(unit);
      if (!at) continue;
      seen.add(unit.id);
      if (this.areaName === "oldfields") {
        const world = fieldMapToWorld(at);
        if (world) {
          const { tx, ty } = soilTileAt(world.x, world.y);
          this.unitTiles.set(soilTileKey(tx, ty), unit.id);
        }
      }
      const frame = this.unitFrame(unit);
      const cue = this.unitCue(unit);
      const signature = `${frame}|${cue}|${at.x},${at.y}`;
      const existing = this.unitNodes.get(unit.id);
      if (existing?.signature === signature) continue;
      existing?.sprite.destroy();
      existing?.cue?.destroy();
      const hen = stockZone(unit.stock) === "henhaven";
      const baseY = hen ? at.y : at.y + 6;
      const sprite = this.keep(this.add.image(at.x, baseY, "common", frame).setOrigin(0.5, 1).setDepth(baseY));
      let cueImage: Phaser.GameObjects.Image | null = null;
      if (cue) {
        cueImage = this.keep(this.add.image(at.x, baseY - sprite.height - 5, "common", cue).setDepth(10_000));
        this.bob(cueImage);
      }
      this.unitNodes.set(unit.id, { sprite, cue: cueImage, signature });
    }
    for (const [id, node] of this.unitNodes) {
      if (seen.has(id)) continue;
      node.sprite.destroy();
      node.cue?.destroy();
      this.unitNodes.delete(id);
    }
  }

  private bob(image: Phaser.GameObjects.Image): void {
    this.tweens.add({ targets: image, y: image.y - 2, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  // ------------------------------------------------------------------ input

  private onPointerDown = (event: PointerEvent): void => {
    this.down = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP) return;
    this.tapAt(event.clientX, event.clientY);
  };

  private onPointerCancel = (): void => {
    this.down = null;
  };

  /** A tap at a viewport point: find what it landed on, walk there, and hand it to the shell on arrival. */
  tapAt(clientX: number, clientY: number): void {
    if (!this.booted) return;
    const rect = this.host.getBoundingClientRect();
    const map = this.cssToMap(clientX - rect.left, clientY - rect.top);
    const target = this.targetAt(map);
    // For a crop or a bed, stand just below it rather than on it, so the farmer never covers the menu's target.
    const goal =
      target.kind === "nothing"
        ? map
        : target.kind === "unit" || target.kind === "field"
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
      if (image.getBounds().contains(map.x, map.y)) consider({ kind: "tag", tag: spec.tag, anchor: { x: spec.x, y: spec.y + 10 }, face: { x: spec.x, y: spec.y } }, spec.y);
    }
    if (best) return (best as { target: Target }).target;

    for (const zone of this.area.zones) {
      if (map.x < zone.x || map.y < zone.y || map.x >= zone.x + zone.w || map.y >= zone.y + zone.h) continue;
      if (zone.tag === "field") {
        const world = fieldMapToWorld(map);
        if (!world) continue;
        const { tx, ty } = soilTileAt(world.x, world.y);
        const centre = fieldWorldToMap({ x: tx * SOIL_TILE + SOIL_TILE / 2, y: ty * SOIL_TILE + SOIL_TILE / 2 });
        // A tap anywhere on a planted bed means its crop, as it does on the isometric farm:
        // a sprout is a few pixels, and the bed square is what a finger actually hits.
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
      return;
    }
    this.fire(target);
  }

  private stand(): void {
    this.player.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onActionDone);
    this.player.anims.stop();
    this.player.setFrame(STANDING[this.facing]);
  }

  private onActionDone = (): void => {
    if (this.path.length === 0) this.player.setFrame(STANDING[this.facing]);
  };

  /** The shell's water, harvest or planting drop landed: act it out, facing whatever he walked up to. */
  farmerAction(action: FarmerAction): void {
    if (!this.booted || this.path.length > 0) return;
    const { anim, repeat } = ACTIONS[action];
    this.stand();
    this.player.once(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onActionDone);
    this.player.play({ key: `${anim}_${this.facing}`, repeat });
  }

  private fire(target: Target): void {
    const cb = this.callbacks;
    if (target.kind === "unit") {
      const node = this.unitNodes.get(target.id);
      const at = node ? this.mapToCss({ x: node.sprite.x, y: node.sprite.y - node.sprite.height / 2 }) : this.mapToCss(target.anchor);
      cb.onUnitTap(target.id, at);
      return;
    }
    if (target.kind === "field") {
      cb.onGroundTap("farmstead", this.mapToCss(target.anchor), target.world);
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
        return cb.onDockTap(at);
      case "greenhouse":
        return cb.onGreenhouseTap();
      case "rayhouse":
        return cb.onRayTap(at);
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
        this.floatAt(at, "Crops grow in the Old Fields, up the north lane", "deny");
        return;
    }
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
  }

  setTravelerUnlocks(unlocked: TravelerUnlocks): void {
    this.travelerUnlocks = unlocked;
    if (this.booted) this.applyNpcs();
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

  /** topdown-world.tsx picks this from the host's size and the device pixel ratio. */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    if (!this.booted) return;
    this.cameras.main.setZoom(zoom);
    this.setPlayerAt(this.pos);
    this.placeCamera();
  }

  /** The district panel's travel buttons: the two home districts are on the Homestead; the rest aren't built yet. */
  focusZone(zone: ZoneId): void {
    if (!this.booted) return;
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
