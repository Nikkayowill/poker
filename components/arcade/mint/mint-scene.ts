import Phaser from "phaser";
import type { MintNodeType } from "@/lib/mint/nodes";
import {
  MINT_STAGE_H,
  MINT_STAGE_W,
  MINT_TILE_HALF_H,
  MINT_TILE_HALF_W,
  mintPaintOrder,
  mintTileCenter,
} from "./iso";
import { MINT_WINDMILL_HUB, MINT_WORLD_TEXTURE, paintMintWorld } from "./mint-world";

/**
 * The diorama, and nothing but the diorama. This scene owns no rules and no
 * data: mint-treasury.tsx tells it what each tile looks like via setPlots
 * and it paints, full stop. Input is not handled here either -- the DOM
 * overlay's buttons (real, focusable, screen-reader-visible) sit on top of
 * the canvas and do all the tapping, so the canvas stays pure paint.
 *
 * Everything static lives in mint-world.ts, baked into one texture at boot
 * (read its header for the art direction and why the land runs off all four
 * edges). What is left here is the part that moves or changes: the sixteen
 * plots, the crops growing in them, and three pieces of ambient life.
 *
 * The frame budget is deliberately small, because the target is a landscape
 * phone: one static quad for the world, one rotating sprite, two drifting
 * cloud shadows, ten fireflies, and at most three pulsing ripe glows. Nothing
 * rebuilds per frame -- the plot layer is only rebuilt when a tile's visible
 * state actually changes, and the growth bar moves in 24 discrete steps (see
 * mint-canvas.tsx's signature) rather than every tick.
 *
 * This file imports Phaser, so nothing outside mint-canvas.tsx's dynamic
 * import chain may import it -- that boundary is what keeps the engine out
 * of the lobby shell bundle.
 */

export interface MintSceneTile {
  plotIndex: number;
  state: "locked" | "empty" | "growing" | "ripe";
  nodeType: MintNodeType | null;
  /** 0..1 while growing. */
  growthPercent: number | null;
  selected: boolean;
}

const GLOW_TEXTURE = "mint-glow";
const COIN_TEXTURE = "mint-coin";
const BLADE_TEXTURE = "mint-blades";
const CLOUD_TEXTURE = "mint-cloud";

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
const ANIMAL: Record<MintNodeType, { body: number; shade: number }> = {
  pulse: { body: 0xe4d9c4, shade: 0x8f8676 },
  core: { body: 0xbb9098, shade: 0x704d57 },
  matrix: { body: 0xbfae9c, shade: 0x6a5f54 },
};

/** Set back per species, since the three silhouettes are not the same size. */
const ANIMAL_SCALE: Record<MintNodeType, number> = { pulse: 0.8, core: 0.7, matrix: 0.68 };

const BEAK_GOLD = 0xf2a63c;
const COMB_RED = 0xc23a34;
const EYE_DARK = 0x1a1420;
const HORN_CHALK = 0xe8e0d2;

/**
 * Slab thickness under each plot's top face, straight from the homestead
 * branch's tiles. This is the whole "it sits IN the ground" read: a flat
 * diamond is a decal painted on the field, and the same diamond with two near
 * faces under it is a bed of earth with depth. Only the near faces are ever
 * visible from this camera, so only those are drawn -- and rows overlap
 * heavily in this projection, so the lift shows exactly where a plot has no
 * neighbour in front of it, which is where it should.
 */
const TILE_LIFT = 12;

function diamond(halfW: number, halfH: number): Phaser.Geom.Point[] {
  return [
    new Phaser.Geom.Point(0, -halfH),
    new Phaser.Geom.Point(halfW, 0),
    new Phaser.Geom.Point(0, halfH),
    new Phaser.Geom.Point(-halfW, 0),
  ];
}

export class MintScene extends Phaser.Scene {
  private plotLayer: Phaser.GameObjects.Container | null = null;
  /**
   * Only the PLOT tweens are tracked. Phaser does not kill a tween just
   * because its target was destroyed, and the plot layer is destroyed on
   * every repaint, so a ripe pulse left running would tick against a dead
   * object forever. The ambient tweens in buildAmbience own targets that live
   * as long as the scene does, and the scene's tween manager takes them with
   * it when the game is destroyed.
   */
  private plotTweens: Phaser.Tweens.Tween[] = [];
  private pending: MintSceneTile[] | null = null;
  private booted = false;
  private reducedMotion = false;

  constructor() {
    super("mint");
  }

  create(): void {
    this.booted = true;
    // The CSS toast already honors this; the canvas must too. Read once at
    // boot -- flipping the OS setting mid-session re-applies on next mount.
    this.reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  setPlots(tiles: MintSceneTile[]): void {
    if (!this.booted) {
      this.pending = tiles;
      return;
    }
    this.renderTiles(tiles);
  }

  /** The gold fountain a settled harvest earns. Purely celebratory. */
  celebrateHarvest(plotIndex: number): void {
    if (!this.booted || this.reducedMotion) return;
    const { x, y } = mintTileCenter(plotIndex);
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
    const world = this.canvasTexture(MINT_WORLD_TEXTURE, MINT_STAGE_W, MINT_STAGE_H);
    if (world) {
      paintMintWorld(world.getContext(), MINT_STAGE_W, MINT_STAGE_H);
      world.refresh();
      this.add.image(0, 0, MINT_WORLD_TEXTURE).setOrigin(0, 0).setDepth(DEPTH_WORLD);
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
      .image(MINT_WINDMILL_HUB.x, MINT_WINDMILL_HUB.y, BLADE_TEXTURE)
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
          x: MINT_STAGE_W + 280,
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
    const rand = new Phaser.Math.RandomDataGenerator(["mint-fireflies"]);
    for (let i = 0; i < 10; i += 1) {
      const gold = i % 3 === 0;
      const fly = this.add
        .image(rand.between(20, MINT_STAGE_W - 20), rand.between(150, MINT_STAGE_H - 24), GLOW_TEXTURE)
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

  private renderTiles(tiles: MintSceneTile[]): void {
    for (const tween of this.plotTweens) tween.remove();
    this.plotTweens = [];
    this.plotLayer?.destroy(true);
    this.plotLayer = this.add.container(0, 0).setDepth(DEPTH_PLOTS);

    const byIndex = new Map(tiles.map((tile) => [tile.plotIndex, tile]));
    for (const plotIndex of mintPaintOrder()) {
      const tile = byIndex.get(plotIndex);
      if (tile) this.plotLayer.add(this.buildTile(tile));
    }
  }

  private buildTile(tile: MintSceneTile): Phaser.GameObjects.Container {
    const { x, y } = mintTileCenter(tile.plotIndex);
    const container = this.add.container(x, y);
    const ground = this.add.graphics();
    container.add(ground);

    const points = diamond(MINT_TILE_HALF_W, MINT_TILE_HALF_H);
    this.paintSlab(ground, tile.state === "locked");

    if (tile.state === "locked") {
      this.paintFallow(ground, points, tile.plotIndex);
    } else {
      this.paintTilled(ground, points);
    }

    // Under the crop, not over it: the ring marks the ground you selected, and
    // a gold line drawn across the stalks reads as damage to them.
    if (tile.selected) {
      const ring = this.add.graphics();
      ring.lineStyle(2, SELECT_RING, 0.9);
      ring.strokePoints(diamond(MINT_TILE_HALF_W - 2, MINT_TILE_HALF_H - 1), true);
      container.add(ring);
    }

    if (tile.state === "growing" || tile.state === "ripe") {
      const ripe = tile.state === "ripe";
      const growth = ripe ? 1 : Math.min(1, Math.max(0, tile.growthPercent ?? 0));
      this.paintPen(container, tile.nodeType ?? "pulse", growth, ripe);
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
        new Phaser.Geom.Point(-MINT_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, MINT_TILE_HALF_H),
        new Phaser.Geom.Point(0, MINT_TILE_HALF_H + TILE_LIFT),
        new Phaser.Geom.Point(-MINT_TILE_HALF_W, TILE_LIFT),
      ],
      true,
    );
    // Right-near face catches the low sun, so it stays a step lighter.
    gfx.fillStyle(locked ? 0x1b2b23 : 0x33200f, alpha);
    gfx.fillPoints(
      [
        new Phaser.Geom.Point(MINT_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, MINT_TILE_HALF_H),
        new Phaser.Geom.Point(0, MINT_TILE_HALF_H + TILE_LIFT),
        new Phaser.Geom.Point(MINT_TILE_HALF_W, TILE_LIFT),
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
        new Phaser.Geom.Point(0, -MINT_TILE_HALF_H),
        new Phaser.Geom.Point(MINT_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, 0),
      ],
      true,
    );
    gfx.lineStyle(1, 0x0d1a18, 0.5);
    gfx.strokePoints(points, true);

    // Weeds, fixed per plot so a repaint never reshuffles them.
    const rand = new Phaser.Math.RandomDataGenerator([`mint-fallow-${plotIndex}`]);
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
        new Phaser.Geom.Point(0, -MINT_TILE_HALF_H),
        new Phaser.Geom.Point(MINT_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, 0),
      ],
      true,
    );
    gfx.fillStyle(SOIL_DARK, 0.5);
    gfx.fillPoints(
      [
        new Phaser.Geom.Point(-MINT_TILE_HALF_W, 0),
        new Phaser.Geom.Point(0, MINT_TILE_HALF_H),
        new Phaser.Geom.Point(0, 0),
      ],
      true,
    );

    // Furrows, running with the tile's long axis.
    gfx.lineStyle(2, FURROW, 0.7);
    for (let i = -2; i <= 2; i += 1) {
      const offset = i * 13;
      gfx.beginPath();
      gfx.moveTo(-MINT_TILE_HALF_W + Math.abs(offset) * 1.6, offset);
      gfx.lineTo(MINT_TILE_HALF_W - Math.abs(offset) * 1.6, offset);
      gfx.strokePath();
    }

    gfx.lineStyle(1.5, 0xa9803f, 0.45);
    gfx.beginPath();
    gfx.moveTo(-MINT_TILE_HALF_W, 0);
    gfx.lineTo(0, -MINT_TILE_HALF_H);
    gfx.lineTo(MINT_TILE_HALF_W, 0);
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
    nodeType: MintNodeType,
    growth: number,
    ripe: boolean,
  ): void {
    const glow = this.add
      .image(0, -14, GLOW_TEXTURE)
      .setTint(ripe ? RIPE_GOLD : GROWING_RING)
      .setScale(ripe ? 1.35 : 0.75, ripe ? 0.9 : 0.5)
      .setAlpha(ripe ? 0.55 : 0.1);
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
    const skin = ANIMAL[nodeType];
    if (nodeType === "pulse") this.paintHen(animal, skin);
    else if (nodeType === "core") this.paintPig(animal, skin);
    else this.paintCow(animal, skin);
    animal.setScale(ANIMAL_SCALE[nodeType]);
    container.add(animal);

    const edge = this.add.graphics();
    if (ripe) {
      edge.lineStyle(2.5, RIPE_GOLD, 0.9);
      edge.strokePoints(diamond(MINT_TILE_HALF_W - 3, MINT_TILE_HALF_H - 2), true);
    } else {
      this.paintProgressRim(edge, growth);
    }
    container.add(edge);

    if (ripe) {
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
   * A violet stroke walking the diamond's perimeter from the near corner.
   * Perimeter rather than a progress bar because the plot is a diamond, and a
   * straight bar laid over it fights the projection at every angle.
   */
  private paintProgressRim(gfx: Phaser.GameObjects.Graphics, growth: number): void {
    const corners = [
      { x: 0, y: MINT_TILE_HALF_H - 2 },
      { x: -(MINT_TILE_HALF_W - 3), y: 0 },
      { x: 0, y: -(MINT_TILE_HALF_H - 2) },
      { x: MINT_TILE_HALF_W - 3, y: 0 },
      { x: 0, y: MINT_TILE_HALF_H - 2 },
    ];
    gfx.lineStyle(2, GROWING_RING, 0.22);
    gfx.strokePoints(diamond(MINT_TILE_HALF_W - 3, MINT_TILE_HALF_H - 2), true);

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

  /** Pulse: a hen. Adapted from the homestead branch's chicken. */
  private paintHen(g: Phaser.GameObjects.Graphics, skin: { body: number; shade: number }): void {
    g.lineStyle(2, skin.shade, 1);
    for (const legX of [-5, 6]) {
      g.beginPath();
      g.moveTo(legX, 2);
      g.lineTo(legX, -7);
      g.strokePath();
    }
    g.fillStyle(skin.body, 1);
    g.fillEllipse(0, -18, 40, 26);
    g.fillStyle(skin.shade, 0.75);
    g.fillEllipse(-6, -16, 22, 14);
    g.fillStyle(skin.body, 1);
    g.fillCircle(16, -31, 10);
    g.fillStyle(BEAK_GOLD, 1);
    g.fillTriangle(24, -31, 34, -28, 24, -26);
    g.fillStyle(COMB_RED, 1);
    g.fillTriangle(12, -40, 16, -47, 20, -40);
    g.fillStyle(EYE_DARK, 1);
    g.fillCircle(19, -33, 1.8);
    g.fillStyle(skin.shade, 1);
    g.fillTriangle(-22, -20, -34, -14, -22, -10);
  }

  /** Core: a pig. New, drawn in the same idiom as the two it stands beside. */
  private paintPig(g: Phaser.GameObjects.Graphics, skin: { body: number; shade: number }): void {
    g.lineStyle(3, skin.shade, 1);
    for (const legX of [-16, -6, 8, 17]) {
      g.beginPath();
      g.moveTo(legX, 2);
      g.lineTo(legX, -11);
      g.strokePath();
    }
    g.fillStyle(skin.body, 1);
    g.fillEllipse(0, -25, 52, 30);
    g.fillStyle(skin.shade, 0.65);
    g.fillEllipse(-8, -20, 26, 14);
    g.fillStyle(skin.body, 1);
    g.fillCircle(23, -33, 13);
    // Snout, then the two ears that stop it reading as a bean with a face.
    g.fillStyle(skin.shade, 0.9);
    g.fillEllipse(33, -31, 12, 9);
    g.fillStyle(EYE_DARK, 1);
    g.fillCircle(31, -32, 1.5);
    g.fillCircle(36, -31, 1.5);
    g.fillCircle(24, -37, 1.9);
    g.fillStyle(skin.body, 1);
    g.fillTriangle(16, -44, 24, -46, 18, -37);
    g.fillTriangle(28, -46, 34, -42, 27, -37);
    g.lineStyle(2.5, skin.shade, 1);
    g.beginPath();
    g.moveTo(-26, -28);
    g.lineTo(-33, -33);
    g.strokePath();
  }

  /** Matrix: a cow. Adapted from the homestead branch's cattle. */
  private paintCow(g: Phaser.GameObjects.Graphics, skin: { body: number; shade: number }): void {
    g.lineStyle(3, skin.shade, 1);
    for (const legX of [-18, -8, 10, 20]) {
      g.beginPath();
      g.moveTo(legX, 2);
      g.lineTo(legX, -14);
      g.strokePath();
    }
    g.fillStyle(skin.body, 1);
    g.fillRoundedRect(-27, -40, 54, 27, 9);
    g.fillStyle(skin.shade, 0.7);
    g.fillEllipse(-8, -24, 26, 12);
    g.fillEllipse(10, -34, 16, 9);
    g.fillStyle(skin.body, 1);
    g.fillRoundedRect(20, -52, 22, 20, 7);
    g.fillStyle(HORN_CHALK, 1);
    g.fillTriangle(23, -51, 13, -57, 25, -46);
    g.fillTriangle(39, -51, 49, -57, 37, -46);
    g.fillStyle(EYE_DARK, 1);
    g.fillCircle(28, -44, 2);
    g.fillCircle(37, -44, 2);
    g.lineStyle(3, skin.shade, 1);
    g.beginPath();
    g.moveTo(-27, -36);
    g.lineTo(-36, -20);
    g.strokePath();
  }
}
