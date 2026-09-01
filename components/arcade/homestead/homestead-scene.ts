import Phaser from "phaser";
import { isLivestock, type HomesteadStock } from "@/lib/homestead/catalogue";
import {
  HOMESTEAD_STAGE_H,
  HOMESTEAD_STAGE_W,
  HOMESTEAD_TILE_HALF_H,
  HOMESTEAD_TILE_HALF_W,
  plotPaintOrder,
  plotCenter,
} from "./iso";
import {
  HOMESTEAD_WINDMILL_HUB,
  HOMESTEAD_WORLD_TEXTURE,
  homesteadPhaseFor,
  paintHomesteadWorld,
  type HomesteadPhase,
} from "./homestead-world";

/**
 * The diorama, and nothing but the diorama. This scene owns no rules and no
 * data: homestead-farm.tsx tells it what each tile looks like via setPlots
 * and it paints, full stop. Input is not handled here either -- the DOM
 * overlay's buttons (real, focusable, screen-reader-visible) sit on top of
 * the canvas and do all the tapping, so the canvas stays pure paint.
 *
 * Everything static lives in homestead-world.ts, baked into one texture at boot
 * (read its header for the art direction and why the land runs off all four
 * edges). What is left here is the part that moves or changes: the sixteen
 * plots, the crops growing in them, and three pieces of ambient life.
 *
 * The frame budget is deliberately small, because the target is a landscape
 * phone: one static quad for the world, one rotating sprite, two drifting
 * cloud shadows, ten fireflies, and at most three pulsing ripe glows. Nothing
 * rebuilds per frame -- the plot layer is only rebuilt when a tile's visible
 * state actually changes, and the growth bar moves in 24 discrete steps (see
 * homestead-canvas.tsx's signature) rather than every tick.
 *
 * This file imports Phaser, so nothing outside homestead-canvas.tsx's dynamic
 * import chain may import it -- that boundary is what keeps the engine out
 * of the lobby shell bundle.
 */

export interface HomesteadSceneTile {
  plotIndex: number;
  state: "locked" | "empty" | "working" | "hungry" | "ready" | "mucked";
  stock: HomesteadStock | null;
  /** 0..1 while working. */
  progress: number | null;
  selected: boolean;
}

const GLOW_TEXTURE = "hs-glow";
const COIN_TEXTURE = "hs-coin";
const BLADE_TEXTURE = "hs-blades";
const CLOUD_TEXTURE = "hs-cloud";

/**
 * Depths. The cloud shadows sit ABOVE the plots on purpose: the plots cover
 * the field bed completely, so a shadow underneath them would visibly
 * disappear the moment it reached the field.
 */
const DEPTH_WORLD = 0;
const DEPTH_BLADES = 6;
const DEPTH_PLOTS = 10;
const DEPTH_CLOUD = 800;
const DEPTH_AIR = 900;
const DEPTH_CELEBRATION = 1000;

/**
 * Plot colours, and the one rule they exist to enforce: an OWNED plot is the
 * warmest, most legible surface on the screen, and a LOCKED one recedes. The
 * first cut had this exactly backwards -- locked plots were bright green scrub
 * against violet-grey soil, so twelve tiles nobody can use were the most
 * inviting thing in the frame and the four you actually own read as dead
 * ground. Warm turned earth against cool dark scrub also gives the field its
 * only real colour contrast, which is what makes the grid readable at a
 * glance on a phone.
 */
const SOIL_DARK = 0x2a1a12;
const SOIL = 0x4d3320;
const SOIL_LIT = 0x6b4728;
const FURROW = 0x33200f;
const FALLOW_GRASS = 0x1b3128;
const FALLOW_GRASS_LIT = 0x274536;
const STONE = 0x413552;

const GROWING_RING = 0xb073f2;
const RIPE_GOLD = 0xffd23f;
const RIPE_GOLD_BRIGHT = 0xffe98a;
const SELECT_RING = 0xffe98a;

/**
 * Livestock, one species per node type, adapted from the homestead branch's
 * hen and cattle and recoloured for this world: those were authored against a
 * near-black stage, and a cream bird that read cleanly there goes chalky over
 * warm tilled soil at dusk. The pig is new, in the same idiom, and sits on the
 * violet side of the palette so the three animals span it.
 */
const ANIMAL: Record<"hen" | "pig" | "cattle", { body: number; shade: number }> = {
  hen: { body: 0xf4efe4, shade: 0x9c917c },
  pig: { body: 0xd9a3ac, shade: 0x855762 },
  cattle: { body: 0xdccfba, shade: 0x776a5c },
};

/** Set back per species, since the three silhouettes are not the same size. */
const ANIMAL_SCALE: Record<"hen" | "pig" | "cattle", number> = { hen: 0.86, pig: 0.76, cattle: 0.74 };

const BEAK_GOLD = 0xffb43d;
const COMB_RED = 0xdc3f36;
const EYE_DARK = 0x1a1420;
const HORN_CHALK = 0xe8e0d2;
const OUTLINE = 0x18110f;
const HUNGRY_RING = 0xff8a3d;
const MUCK_DARK = 0x2b1d0e;
const MUCK_WET = 0x4a361f;
const CROP_STEM = 0x2f7a4b;
const CROP_LEAF = 0x6fd08c;
const CROP_GRAIN = 0xe8c15a;
const COW_PATCH = 0x4a3d33;

/**
 * Slab thickness under each plot's top face, straight from the homestead
 * branch's tiles. This is the whole "it sits IN the ground" read: a flat
 * diamond is a decal painted on the field, and the same diamond with two near
 * faces under it is a bed of earth with depth. Only the near faces are ever
 * visible from this camera, so only those are drawn -- and rows overlap
 * heavily in this projection, so the lift shows exactly where a plot has no
 * neighbour in front of it, which is where it should.
 */
const TILE_LIFT = 8;

function diamond(halfW: number, halfH: number): Phaser.Geom.Point[] {
  return [
    new Phaser.Geom.Point(0, -halfH),
    new Phaser.Geom.Point(halfW, 0),
    new Phaser.Geom.Point(0, halfH),
    new Phaser.Geom.Point(-halfW, 0),
  ];
}

export class HomesteadScene extends Phaser.Scene {
  private plotLayer: Phaser.GameObjects.Container | null = null;
  /**
   * Only the PLOT tweens are tracked. Phaser does not kill a tween just
   * because its target was destroyed, and the plot layer is destroyed on
   * every repaint, so a ripe hen left running would tick against a dead
   * object forever. The ambient tweens in buildAmbience own targets that live
   * as long as the scene does, and the scene's tween manager takes them with
   * it when the game is destroyed.
   */
  private plotTweens: Phaser.Tweens.Tween[] = [];
  private pending: HomesteadSceneTile[] | null = null;
  private booted = false;
  private reducedMotion = false;
  /** Read once at boot; a mount is short enough that the hour cannot turn under it. */
  private phase: HomesteadPhase = "dusk";

  constructor() {
    super("homestead");
  }

  create(): void {
    this.booted = true;
    // The CSS toast already honors this; the canvas must too. Read once at
    // boot -- flipping the OS setting mid-session re-applies on next mount.
    this.reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.phase = homesteadPhaseFor();

    this.buildTextures();
    this.buildWorld();
    this.buildAmbience();

    if (this.pending) {
      const tiles = this.pending;
      this.pending = null;
      this.renderTiles(tiles);
    }
  }

  /** Repaints the whole 16-plot field. Called on state changes, not per frame. */
  setPlots(tiles: HomesteadSceneTile[]): void {
    if (!this.booted) {
      this.pending = tiles;
      return;
    }
    this.renderTiles(tiles);
  }

  /** The gold fountain a settled harvest earns. Purely celebratory. */
  celebrateHarvest(plotIndex: number): void {
    if (!this.booted || this.reducedMotion) return;
    const { x, y } = plotCenter(plotIndex);
    const fountain = this.add.particles(x, y - 10, COIN_TEXTURE, {
      speed: { min: 160, max: 320 },
      angle: { min: -125, max: -55 },
      gravityY: 700,
      lifespan: 900,
      scale: { start: 1, end: 0.4 },
      emitting: false,
    });
    fountain.setDepth(DEPTH_CELEBRATION);
    fountain.explode(26);
    this.time.delayedCall(1200, () => fountain.destroy());
  }

  /**
   * The three generated textures nothing else provides. There is no asset
   * pipeline entry for a 12px coin or a soft glow, and generating them costs
   * one boot-time draw each against a per-frame gradient we could not
   * otherwise have (Phaser.Graphics has no radial fill).
   */
  private buildTextures(): void {
    const coin = this.add.graphics();
    coin.fillStyle(RIPE_GOLD, 1);
    coin.fillCircle(6, 6, 6);
    coin.fillStyle(RIPE_GOLD_BRIGHT, 1);
    coin.fillCircle(4.5, 4.5, 2.5);
    coin.generateTexture(COIN_TEXTURE, 12, 12);
    coin.destroy();

    // A white radial falloff, tinted at each use site: crop glow, ripe bloom,
    // and (inverted in colour) the drifting cloud shadows.
    const glow = this.canvasTexture(GLOW_TEXTURE, 128, 128);
    if (glow) {
      const ctx = glow.getContext();
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.45, "rgba(255,255,255,0.42)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      glow.refresh();
    }

    const cloud = this.canvasTexture(CLOUD_TEXTURE, 256, 128);
    if (cloud) {
      const ctx = cloud.getContext();
      const gradient = ctx.createRadialGradient(128, 64, 0, 128, 64, 64);
      gradient.addColorStop(0, "rgba(6, 8, 22, 0.85)");
      gradient.addColorStop(0.55, "rgba(6, 8, 22, 0.35)");
      gradient.addColorStop(1, "rgba(6, 8, 22, 0)");
      ctx.save();
      ctx.translate(128, 64);
      ctx.scale(2, 1);
      ctx.translate(-128, -64);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 128);
      ctx.restore();
      cloud.refresh();
    }

    const blades = this.add.graphics();
    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI / 2) * i;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const point = (along: number, across: number) =>
        new Phaser.Geom.Point(50 + along * cos - across * sin, 50 + along * sin + across * cos);
      blades.fillStyle(0x241b3d, 1);
      blades.fillPoints([point(4, -2.5), point(44, -6), point(44, 6), point(4, 2.5)], true);
      blades.fillStyle(0x463870, 1);
      blades.fillPoints([point(4, -2.5), point(44, -6), point(44, -1.5), point(4, -0.5)], true);
    }
    blades.fillStyle(0x554378, 1);
    blades.fillCircle(50, 50, 4.5);
    blades.generateTexture(BLADE_TEXTURE, 100, 100);
    blades.destroy();
  }

  /**
   * Phaser keeps textures per Game, so a remount gets a fresh manager -- but a
   * scene restart inside one Game would collide on the key, and createCanvas
   * returns null on a duplicate rather than replacing it.
   */
  private canvasTexture(key: string, w: number, h: number): Phaser.Textures.CanvasTexture | null {
    if (this.textures.exists(key)) this.textures.remove(key);
    return this.textures.createCanvas(key, w, h);
  }

  private buildWorld(): void {
    const world = this.canvasTexture(HOMESTEAD_WORLD_TEXTURE, HOMESTEAD_STAGE_W, HOMESTEAD_STAGE_H);
    if (world) {
      paintHomesteadWorld(world.getContext(), HOMESTEAD_STAGE_W, HOMESTEAD_STAGE_H, this.phase);
      world.refresh();
      this.add.image(0, 0, HOMESTEAD_WORLD_TEXTURE).setOrigin(0, 0).setDepth(DEPTH_WORLD);
    }
  }

  /**
   * Ambient life: turning blades, cloud shadows crossing the ground, and
   * fireflies over the near grass. The cloud shadows do the heaviest lifting
   * for almost nothing -- a shadow sweeping the field is the clearest
   * possible statement that there is open sky above this place, without
   * spending a single pixel of the frame on drawing one.
   */
  private buildAmbience(): void {
    const blades = this.add
      .image(HOMESTEAD_WINDMILL_HUB.x, HOMESTEAD_WINDMILL_HUB.y, BLADE_TEXTURE)
      .setDepth(DEPTH_BLADES);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: blades,
        rotation: Math.PI * 2,
        duration: 11000,
        repeat: -1,
        ease: "Linear",
      });
    }

    if (!this.reducedMotion) {
      const drift = (y: number, scale: number, alpha: number, duration: number, delay: number) => {
        const shadow = this.add
          .image(-260, y, CLOUD_TEXTURE)
          .setDepth(DEPTH_CLOUD)
          .setScale(scale, scale * 0.62)
          .setAlpha(alpha);
        this.tweens.add({
          targets: shadow,
          x: HOMESTEAD_STAGE_W + 280,
          duration,
          delay,
          repeat: -1,
          ease: "Linear",
        });
      };
      drift(196, 1.5, 0.5, 42000, 0);
      drift(372, 2.1, 0.38, 55000, 14000);
    }

    // A scene-local generator, not Phaser.Math.RND: sowing the global one
    // would reseed every other consumer in the game.
    const rand = new Phaser.Math.RandomDataGenerator(["homestead-fireflies"]);
    for (let i = 0; i < 10; i += 1) {
      const gold = i % 3 === 0;
      const fly = this.add
        .image(rand.between(20, HOMESTEAD_STAGE_W - 20), rand.between(150, HOMESTEAD_STAGE_H - 24), GLOW_TEXTURE)
        .setDepth(DEPTH_AIR)
        .setScale(gold ? 0.09 : 0.07)
        .setTint(gold ? RIPE_GOLD_BRIGHT : 0xc07bff)
        .setAlpha(this.reducedMotion ? 0.4 : 0.15);
      if (this.reducedMotion) continue;
      this.tweens.add({
        targets: fly,
        alpha: { from: 0.12, to: 0.85 },
        y: fly.y - rand.between(10, 26),
        x: fly.x + rand.between(-18, 18),
        duration: rand.between(2400, 5200),
        delay: rand.between(0, 2600),
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  private renderTiles(tiles: HomesteadSceneTile[]): void {
    for (const tween of this.plotTweens) tween.remove();
    this.plotTweens = [];
    this.plotLayer?.destroy(true);
    this.plotLayer = this.add.container(0, 0).setDepth(DEPTH_PLOTS);

    const byIndex = new Map(tiles.map((tile) => [tile.plotIndex, tile]));
    for (const plotIndex of plotPaintOrder()) {
      const tile = byIndex.get(plotIndex);
      if (tile) this.plotLayer.add(this.buildTile(tile));
    }
  }

  private buildTile(tile: HomesteadSceneTile): Phaser.GameObjects.Container {
    const { x, y } = plotCenter(tile.plotIndex);
    const container = this.add.container(x, y);
    const ground = this.add.graphics();
    container.add(ground);

    const points = diamond(HOMESTEAD_TILE_HALF_W, HOMESTEAD_TILE_HALF_H);
    this.paintSlab(ground, tile.state === "locked");

    if (tile.state === "locked") {
      this.paintFallow(ground, points, tile.plotIndex);
    } else if (tile.state === "mucked") {
      this.paintMuck(ground, points, tile.plotIndex);
    } else {
      this.paintTilled(ground, points);
    }

    // Under the crop, not over it: the ring marks the ground you selected, and
    // a gold line drawn across the stalks reads as damage to them.
    if (tile.selected) {
      const ring = this.add.graphics();
      ring.lineStyle(2, SELECT_RING, 0.9);
      ring.strokePoints(diamond(HOMESTEAD_TILE_HALF_W - 2, HOMESTEAD_TILE_HALF_H - 1), true);
      container.add(ring);
    }

    if (tile.state === "working" || tile.state === "hungry" || tile.state === "ready") {
      const ready = tile.state === "ready";
      const progress = ready ? 1 : Math.min(1, Math.max(0, tile.progress ?? 0));
      const stock = tile.stock ?? "hen";
      if (isLivestock(stock)) {
        this.paintPen(container, stock, progress, ready, tile.state === "hungry");
      } else {
        this.paintField(container, stock, progress, ready);
      }
    }

    return container;
  }

  /**
   * The two near faces under a plot's top face. Drawn first, so the top face
   * and everything standing on it paints over the seam.
   */
  private paintSlab(gfx: Phaser.GameObjects.Graphics, locked: boolean): void {
    const alpha = locked ? 0.72 : 1;
    gfx.fillStyle(0x120b08, alpha);
    gfx.fillPoints(
      [
        new Phaser.Geom.Point(-HOMESTEAD_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, HOMESTEAD_TILE_HALF_H),
        new Phaser.Geom.Point(0, HOMESTEAD_TILE_HALF_H + TILE_LIFT),
        new Phaser.Geom.Point(-HOMESTEAD_TILE_HALF_W, TILE_LIFT),
      ],
      true,
    );
    // Right-near face catches the low sun, so it stays a step lighter.
    gfx.fillStyle(locked ? 0x1b2b23 : 0x33200f, alpha);
    gfx.fillPoints(
      [
        new Phaser.Geom.Point(HOMESTEAD_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, HOMESTEAD_TILE_HALF_H),
        new Phaser.Geom.Point(0, HOMESTEAD_TILE_HALF_H + TILE_LIFT),
        new Phaser.Geom.Point(HOMESTEAD_TILE_HALF_W, TILE_LIFT),
      ],
      true,
    );
  }

  /** A locked plot: never broken, grown over, with a boundary stone on it. */
  private paintFallow(
    gfx: Phaser.GameObjects.Graphics,
    points: Phaser.Geom.Point[],
    plotIndex: number,
  ): void {
    gfx.fillStyle(FALLOW_GRASS, 1);
    gfx.fillPoints(points, true);
    gfx.fillStyle(FALLOW_GRASS_LIT, 0.32);
    gfx.fillPoints(
      [
        new Phaser.Geom.Point(0, -HOMESTEAD_TILE_HALF_H),
        new Phaser.Geom.Point(HOMESTEAD_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, 0),
      ],
      true,
    );
    gfx.lineStyle(1, 0x0d1a18, 0.5);
    gfx.strokePoints(points, true);

    // Weeds, fixed per plot so a repaint never reshuffles them.
    const rand = new Phaser.Math.RandomDataGenerator([`homestead-fallow-${plotIndex}`]);
    gfx.lineStyle(1.2, FALLOW_GRASS_LIT, 0.6);
    for (let i = 0; i < 7; i += 1) {
      const wx = rand.between(-40, 40);
      const wy = rand.between(-13, 15);
      gfx.beginPath();
      gfx.moveTo(wx, wy);
      gfx.lineTo(wx + rand.between(-3, 3), wy - rand.between(3, 7));
      gfx.strokePath();
    }

    // A marker that says "not yours yet" without twelve identical cones
    // marching across the field: each plot gets its own rubble, placed off
    // centre so the eye reads scattered debris, not a repeated icon.
    const markers = rand.between(2, 3);
    for (let i = 0; i < markers; i += 1) {
      const mx = rand.between(-26, 26);
      const my = rand.between(-8, 10);
      const size = rand.between(4, 8);
      gfx.fillStyle(0x0d1a18, 0.45);
      gfx.fillEllipse(mx, my + size * 0.5, size * 2.2, size * 0.8);
      gfx.fillStyle(STONE, 1);
      gfx.fillEllipse(mx, my, size * 1.5, size);
      gfx.fillStyle(0x5f4f77, 0.8);
      gfx.fillEllipse(mx + size * 0.35, my - size * 0.3, size * 0.7, size * 0.45);
    }
  }

  /** An owned plot: broken soil, furrowed, with a lit rim on the sun side. */
  private paintTilled(gfx: Phaser.GameObjects.Graphics, points: Phaser.Geom.Point[]): void {
    gfx.fillStyle(SOIL, 1);
    gfx.fillPoints(points, true);

    // The sun rakes the two upper faces; the two lower ones fall into shade.
    gfx.fillStyle(SOIL_LIT, 0.45);
    gfx.fillPoints(
      [
        new Phaser.Geom.Point(0, -HOMESTEAD_TILE_HALF_H),
        new Phaser.Geom.Point(HOMESTEAD_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, 0),
      ],
      true,
    );
    gfx.fillStyle(SOIL_DARK, 0.5);
    gfx.fillPoints(
      [
        new Phaser.Geom.Point(-HOMESTEAD_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, HOMESTEAD_TILE_HALF_H),
        new Phaser.Geom.Point(0, 0),
      ],
      true,
    );

    // Furrows, running with the tile's long axis.
    gfx.lineStyle(2, FURROW, 0.7);
    for (let i = -2; i <= 2; i += 1) {
      const offset = i * 13;
      gfx.beginPath();
      gfx.moveTo(-HOMESTEAD_TILE_HALF_W + Math.abs(offset) * 1.6, offset);
      gfx.lineTo(HOMESTEAD_TILE_HALF_W - Math.abs(offset) * 1.6, offset);
      gfx.strokePath();
    }

    gfx.lineStyle(1.5, 0xa9803f, 0.45);
    gfx.beginPath();
    gfx.moveTo(-HOMESTEAD_TILE_HALF_W, 0);
    gfx.lineTo(0, -HOMESTEAD_TILE_HALF_H);
    gfx.lineTo(HOMESTEAD_TILE_HALF_W, 0);
    gfx.strokePath();
  }

  /**
   * The pen: one animal per node type, plus the read that tells you at a
   * glance whether it is ready. Colour carries exactly one message and it has
   * not changed from the crystal version -- violet means still working, gold
   * means take it -- but the thing that grows had to change with it. An animal
   * does not get taller as it matures, so progress moved off the prop and onto
   * the plot's own edge: a violet stroke creeping around the diamond while it
   * works, a full gold rim plus coins and a glow when it is done.
   */
  private paintPen(
    container: Phaser.GameObjects.Container,
    stock: HomesteadStock,
    progress: number,
    ready: boolean,
    hungry: boolean,
  ): void {
    const glow = this.add
      .image(0, -14, GLOW_TEXTURE)
      .setTint(ready ? RIPE_GOLD : hungry ? HUNGRY_RING : GROWING_RING)
      .setScale(ready ? 1.35 : 0.75, ready ? 0.9 : 0.5)
      .setAlpha(ready ? 0.55 : hungry ? 0.22 : 0.1);
    container.add(glow);

    // Trodden ground under the animal, so it stands in the pen rather than on
    // a decal of one.
    const floor = this.add.graphics();
    floor.fillStyle(SOIL_DARK, 0.34);
    floor.fillEllipse(0, 7, 54, 16);
    floor.fillStyle(SOIL_LIT, 0.16);
    floor.fillEllipse(2, 5, 40, 11);
    container.add(floor);

    // Authored against the homestead branch's 108x54 tiles; these plots are
    // 132x82, but an animal that fills its plot edge to edge overlaps its
    // neighbours in this projection, so each is set back to roughly two
    // thirds of the diamond.
    const animal = this.add.graphics();
    const skin = ANIMAL[stock as "hen" | "pig" | "cattle"];
    if (stock === "hen") this.paintHen(animal, skin);
    else if (stock === "pig") this.paintPig(animal, skin);
    else this.paintCow(animal, skin);
    animal.setScale(ANIMAL_SCALE[stock as "hen" | "pig" | "cattle"]);
    // A hungry animal drains toward the alert colour and sits a touch lower.
    if (hungry) animal.setAlpha(0.72);
    container.add(animal);

    const edge = this.add.graphics();
    if (ready) {
      edge.lineStyle(2.5, RIPE_GOLD, 0.9);
      edge.strokePoints(diamond(HOMESTEAD_TILE_HALF_W - 3, HOMESTEAD_TILE_HALF_H - 2), true);
    } else if (hungry) {
      // A frozen clock gets a frozen rim: the progress arc stops where it was
      // and the whole edge goes amber, so "this one wants you" reads from
      // across the field without a countdown.
      edge.lineStyle(2.5, HUNGRY_RING, 0.85);
      edge.strokePoints(diamond(HOMESTEAD_TILE_HALF_W - 3, HOMESTEAD_TILE_HALF_H - 2), true);
    } else {
      this.paintProgressRim(edge, progress);
    }
    container.add(edge);

    if (hungry) container.add(this.feedGlyph());

    if (ready) {
      const coins = this.add.graphics();
      for (let i = 0; i < 5; i += 1) {
        const cx = -22 + i * 11 + (i % 2 === 0 ? 3 : -4);
        coins.fillStyle(RIPE_GOLD, 1);
        coins.fillEllipse(cx, 8 + (i % 3), 8, 4.5);
        coins.fillStyle(RIPE_GOLD_BRIGHT, 1);
        coins.fillEllipse(cx - 1, 7 + (i % 3), 3.4, 2);
      }
      container.add(coins);

      if (this.reducedMotion) {
        glow.setAlpha(0.55);
      } else {
        this.plotTweens.push(
          this.tweens.add({
            targets: glow,
            alpha: { from: 0.34, to: 0.68 },
            scaleX: { from: 1.28, to: 1.48 },
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          }),
        );
      }
    }
  }

  /**
   * The bowl over a hungry pen. Deliberately a shape rather than a colour
   * change alone: an amber tint on a beige cow is nearly invisible on a phone
   * at dusk, and the whole point of the state is that you can spot it without
   * opening anything.
   */
  private feedGlyph(): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(0x140d09, 0.55);
    g.fillEllipse(0, -54, 30, 12);
    g.fillStyle(HUNGRY_RING, 1);
    g.fillEllipse(0, -56, 24, 10);
    g.fillStyle(0x2a1a0c, 1);
    g.fillEllipse(0, -58, 18, 6);
    g.fillStyle(CROP_GRAIN, 1);
    g.fillEllipse(-4, -59, 5, 3);
    g.fillEllipse(3, -58, 5, 3);
    return g;
  }

  /**
   * A field of crops. Unlike an animal, a plant genuinely does get bigger as
   * it matures, so height carries progress here and the rim is left to say
   * only whether it is ready.
   */
  private paintField(
    container: Phaser.GameObjects.Container,
    stock: HomesteadStock,
    progress: number,
    ready: boolean,
  ): void {
    const cash = stock === "cash_crop";
    const eased = 0.18 + 0.82 * progress;

    if (ready) {
      const glow = this.add
        .image(0, -18, GLOW_TEXTURE)
        .setTint(RIPE_GOLD)
        .setScale(1.3, 0.85)
        .setAlpha(0.5);
      container.add(glow);
      if (!this.reducedMotion) {
        this.plotTweens.push(
          this.tweens.add({
            targets: glow,
            alpha: { from: 0.32, to: 0.62 },
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          }),
        );
      }
    }

    const rows = this.add.graphics();
    // Two rows of three, offset, so a full field reads as planted ground
    // rather than three lonely stalks.
    const stalks: Array<{ x: number; y: number }> = [
      { x: -22, y: 6 }, { x: 0, y: 9 }, { x: 22, y: 6 },
      { x: -11, y: -4 }, { x: 11, y: -4 },
    ];
    for (const at of stalks) {
      const height = (cash ? 34 : 22) * eased;
      rows.lineStyle(cash ? 3 : 2.4, CROP_STEM, 1);
      rows.beginPath();
      rows.moveTo(at.x, at.y);
      rows.lineTo(at.x, at.y - height);
      rows.strokePath();

      if (cash && ready) {
        // Grain heads: stacked diamonds up the top third.
        for (let i = 0; i < 3; i += 1) {
          const y = at.y - height + i * 6;
          rows.fillStyle(i % 2 === 0 ? CROP_GRAIN : RIPE_GOLD_BRIGHT, 1);
          rows.fillPoints(
            [
              new Phaser.Geom.Point(at.x, y - 5),
              new Phaser.Geom.Point(at.x + 5, y),
              new Phaser.Geom.Point(at.x, y + 5),
              new Phaser.Geom.Point(at.x - 5, y),
            ],
            true,
          );
        }
      } else {
        // Leaves either side of a centre shoot. A rounded crown here read as
        // a ball on a stick, which is the note the homestead branch's own
        // sprout carries.
        const leaf = (dx: number, colour: number) => {
          rows.fillStyle(colour, 1);
          rows.fillPoints(
            [
              new Phaser.Geom.Point(at.x, at.y - height + 4),
              new Phaser.Geom.Point(at.x + dx, at.y - height - 2),
              new Phaser.Geom.Point(at.x + dx * 0.2, at.y - height + 8),
            ],
            true,
          );
        };
        leaf(-9 * eased, CROP_LEAF);
        leaf(9 * eased, CROP_STEM);
        rows.fillStyle(CROP_LEAF, 1);
        rows.fillPoints(
          [
            new Phaser.Geom.Point(at.x - 3, at.y - height),
            new Phaser.Geom.Point(at.x + 3, at.y - height),
            new Phaser.Geom.Point(at.x, at.y - height - 10 * eased),
          ],
          true,
        );
      }
    }
    container.add(rows);

    const edge = this.add.graphics();
    if (ready) {
      edge.lineStyle(2.5, RIPE_GOLD, 0.9);
      edge.strokePoints(diamond(HOMESTEAD_TILE_HALF_W - 3, HOMESTEAD_TILE_HALF_H - 2), true);
    } else {
      this.paintProgressRim(edge, progress);
    }
    container.add(edge);
  }

  /** A plot that needs maintenance: churned mud, un-plantable until paid for. */
  private paintMuck(
    gfx: Phaser.GameObjects.Graphics,
    points: Phaser.Geom.Point[],
    plotIndex: number,
  ): void {
    gfx.fillStyle(MUCK_DARK, 1);
    gfx.fillPoints(points, true);

    const rand = new Phaser.Math.RandomDataGenerator([`homestead-muck-${plotIndex}`]);
    for (let i = 0; i < 7; i += 1) {
      // Keep every blob inside the diamond: |x/halfW| + |y/halfH| <= 1.
      const u = rand.realInRange(-1, 1);
      const v = rand.realInRange(-1, 1);
      const k = Math.min(1, 0.72 / (Math.abs(u) + Math.abs(v) + 0.001));
      gfx.fillStyle(i % 2 === 0 ? MUCK_DARK : MUCK_WET, 0.9);
      gfx.fillEllipse(
        u * HOMESTEAD_TILE_HALF_W * k,
        v * HOMESTEAD_TILE_HALF_H * k,
        14 + rand.between(0, 18),
        7 + rand.between(0, 8),
      );
    }
    // Puddle sheen, so "weather-worn" reads as wet rather than just dark.
    gfx.fillStyle(0x7fa8c8, 0.12);
    gfx.fillEllipse(4, 4, 34, 14);
    gfx.lineStyle(1, 0x120c06, 0.6);
    gfx.strokePoints(points, true);
  }

  /**
   * A violet stroke walking the diamond's perimeter from the near corner.
   * Perimeter rather than a progress bar because the plot is a diamond, and a
   * straight bar laid over it fights the projection at every angle.
   */
  private paintProgressRim(gfx: Phaser.GameObjects.Graphics, growth: number): void {
    const corners = [
      { x: 0, y: HOMESTEAD_TILE_HALF_H - 2 },
      { x: -(HOMESTEAD_TILE_HALF_W - 3), y: 0 },
      { x: 0, y: -(HOMESTEAD_TILE_HALF_H - 2) },
      { x: HOMESTEAD_TILE_HALF_W - 3, y: 0 },
      { x: 0, y: HOMESTEAD_TILE_HALF_H - 2 },
    ];
    gfx.lineStyle(2, GROWING_RING, 0.22);
    gfx.strokePoints(diamond(HOMESTEAD_TILE_HALF_W - 3, HOMESTEAD_TILE_HALF_H - 2), true);

    const travelled = Math.min(1, Math.max(0, growth)) * 4;
    gfx.lineStyle(2.5, GROWING_RING, 0.75);
    for (let leg = 0; leg < 4; leg += 1) {
      const portion = Math.min(1, Math.max(0, travelled - leg));
      if (portion <= 0) break;
      const from = corners[leg];
      const to = corners[leg + 1];
      gfx.beginPath();
      gfx.moveTo(from.x, from.y);
      gfx.lineTo(from.x + (to.x - from.x) * portion, from.y + (to.y - from.y) * portion);
      gfx.strokePath();
    }
  }

  /**
   * Hen. Built on the homestead branch's chicken, with the three things that
   * make it read at plot size: a dark contour so it survives against the soil,
   * a wing breaking up the body, and a three-bump comb instead of one spike.
   */
  private paintHen(g: Phaser.GameObjects.Graphics, skin: { body: number; shade: number }): void {
    g.lineStyle(2.5, OUTLINE, 0.9);
    for (const legX of [-5, 7]) {
      g.beginPath();
      g.moveTo(legX, 3);
      g.lineTo(legX, -8);
      g.strokePath();
    }
    // Feet.
    g.lineStyle(2, OUTLINE, 0.9);
    for (const legX of [-5, 7]) {
      g.beginPath();
      g.moveTo(legX - 4, 3);
      g.lineTo(legX + 4, 3);
      g.strokePath();
    }

    g.fillStyle(skin.body, 1);
    g.fillEllipse(0, -19, 42, 28);
    g.lineStyle(1.8, OUTLINE, 0.8);
    g.strokeEllipseShape(new Phaser.Geom.Ellipse(0, -19, 42, 28));

    // Wing, and the shaded underside.
    g.fillStyle(skin.shade, 0.85);
    g.fillEllipse(-3, -15, 24, 15);
    g.fillStyle(skin.shade, 0.5);
    g.fillEllipse(-4, -22, 20, 11);

    // Tail, behind the body's silhouette but drawn after so it stays crisp.
    g.fillStyle(skin.shade, 1);
    g.fillTriangle(-19, -22, -35, -15, -19, -9);
    g.lineStyle(1.6, OUTLINE, 0.8);
    g.beginPath();
    g.moveTo(-19, -22);
    g.lineTo(-35, -15);
    g.lineTo(-19, -9);
    g.strokePath();

    g.fillStyle(skin.body, 1);
    g.fillCircle(17, -32, 10.5);
    g.lineStyle(1.8, OUTLINE, 0.8);
    g.strokeCircleShape(new Phaser.Geom.Circle(17, -32, 10.5));

    // Comb: three bumps, which is what stops it reading as a horn.
    g.fillStyle(COMB_RED, 1);
    g.fillCircle(12, -41, 3.4);
    g.fillCircle(17, -43, 3.8);
    g.fillCircle(22, -41, 3.2);
    // Wattle under the beak.
    g.fillStyle(COMB_RED, 1);
    g.fillEllipse(23, -25, 5, 7);

    g.fillStyle(BEAK_GOLD, 1);
    g.fillTriangle(25, -33, 36, -30, 25, -27);
    g.fillStyle(EYE_DARK, 1);
    g.fillCircle(20, -34, 2);
  }

  /**
   * Pig. New, in the same idiom as the two it stands beside. The snout is
   * doing the work here -- without a clear disc with two nostrils on it, a
   * pink oval with ears is just a blob.
   */
  private paintPig(g: Phaser.GameObjects.Graphics, skin: { body: number; shade: number }): void {
    g.lineStyle(3.5, OUTLINE, 0.9);
    for (const legX of [-17, -6, 8, 18]) {
      g.beginPath();
      g.moveTo(legX, 3);
      g.lineTo(legX, -12);
      g.strokePath();
    }
    // Trotters.
    g.fillStyle(OUTLINE, 0.9);
    for (const legX of [-17, -6, 8, 18]) g.fillEllipse(legX, 3, 6, 3);

    g.fillStyle(skin.body, 1);
    g.fillEllipse(-2, -26, 54, 32);
    g.lineStyle(2, OUTLINE, 0.8);
    g.strokeEllipseShape(new Phaser.Geom.Ellipse(-2, -26, 54, 32));
    g.fillStyle(skin.shade, 0.55);
    g.fillEllipse(-6, -19, 34, 15);

    // Curl of tail.
    g.lineStyle(2.5, skin.shade, 1);
    g.beginPath();
    g.moveTo(-28, -30);
    g.lineTo(-34, -35);
    g.strokePath();

    // Ears first, so the head's outline cuts over their base.
    g.fillStyle(skin.shade, 1);
    g.fillTriangle(15, -45, 24, -49, 20, -38);
    g.fillTriangle(30, -49, 36, -43, 29, -38);

    g.fillStyle(skin.body, 1);
    g.fillCircle(24, -33, 13.5);
    g.lineStyle(2, OUTLINE, 0.8);
    g.strokeCircleShape(new Phaser.Geom.Circle(24, -33, 13.5));

    // Snout disc plus nostrils.
    g.fillStyle(skin.shade, 1);
    g.fillEllipse(34, -31, 14, 11);
    g.lineStyle(1.6, OUTLINE, 0.8);
    g.strokeEllipseShape(new Phaser.Geom.Ellipse(34, -31, 14, 11));
    g.fillStyle(EYE_DARK, 0.85);
    g.fillEllipse(32, -31, 2.6, 3.4);
    g.fillEllipse(37, -31, 2.6, 3.4);

    g.fillStyle(EYE_DARK, 1);
    g.fillCircle(23, -38, 2);
  }

  /**
   * Cow. The homestead branch's cattle, plus the patches -- an unbroken beige
   * body reads as a generic quadruped at this size, and two dark patches read
   * as a cow immediately.
   */
  private paintCow(g: Phaser.GameObjects.Graphics, skin: { body: number; shade: number }): void {
    g.lineStyle(3.5, OUTLINE, 0.9);
    for (const legX of [-19, -8, 10, 21]) {
      g.beginPath();
      g.moveTo(legX, 3);
      g.lineTo(legX, -15);
      g.strokePath();
    }
    // Hooves.
    g.fillStyle(OUTLINE, 0.9);
    for (const legX of [-19, -8, 10, 21]) g.fillEllipse(legX, 3, 7, 3.4);

    // Tail, behind the body.
    g.lineStyle(2.5, OUTLINE, 0.85);
    g.beginPath();
    g.moveTo(-28, -36);
    g.lineTo(-37, -20);
    g.strokePath();
    g.fillStyle(skin.shade, 1);
    g.fillEllipse(-37, -18, 4, 7);

    g.fillStyle(skin.body, 1);
    g.fillRoundedRect(-28, -41, 56, 29, 10);
    g.lineStyle(2, OUTLINE, 0.8);
    g.strokeRoundedRect(-28, -41, 56, 29, 10);

    // Patches. Kept inside the body's rounded rect so nothing hangs off it.
    g.fillStyle(COW_PATCH, 0.9);
    g.fillEllipse(-13, -32, 20, 15);
    g.fillEllipse(9, -24, 15, 11);

    // Udder, small, on the shaded underside.
    g.fillStyle(COMB_RED, 0.5);
    g.fillEllipse(-4, -12, 12, 6);

    // Ears, then the head over their base.
    g.fillStyle(skin.shade, 1);
    g.fillEllipse(19, -49, 9, 6);
    g.fillEllipse(45, -49, 9, 6);

    g.fillStyle(skin.body, 1);
    g.fillRoundedRect(21, -54, 23, 22, 8);
    g.lineStyle(2, OUTLINE, 0.8);
    g.strokeRoundedRect(21, -54, 23, 22, 8);

    // Horns, short and swept, attached at the skull.
    g.fillStyle(HORN_CHALK, 1);
    g.fillTriangle(24, -53, 15, -59, 26, -48);
    g.fillTriangle(41, -53, 50, -59, 39, -48);

    // Muzzle.
    g.fillStyle(skin.shade, 0.9);
    g.fillEllipse(32, -36, 15, 9);
    g.fillStyle(EYE_DARK, 0.8);
    g.fillEllipse(29, -36, 2.4, 3);
    g.fillEllipse(35, -36, 2.4, 3);

    g.fillStyle(EYE_DARK, 1);
    g.fillCircle(27, -46, 2.2);
    g.fillCircle(38, -46, 2.2);
  }
}
