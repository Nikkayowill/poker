import Phaser from "phaser";
import {
  BIRD_EVERY,
  BUTTERFLIES,
  FIREFLIES,
  FISH_EVERY,
  LEAF_EVERY,
  activeCritters,
  between,
  fireflyAlpha,
  fishFrame,
  leafFall,
  nearbyTile,
  tileId,
  type Tile,
} from "@/lib/stackacres-td/ambient";
import { gustAt } from "@/lib/stackacres-td/wind";
import { DAYLIGHT_DEPTH } from "./daylight-layer";

/** The tiles critters may use and the broadleaf canopies that drop leaves, exported per area. */
export interface AmbientSpec {
  meadow: [number, number][];
  pond: [number, number][];
  canopies: { x: number; y: number }[];
}

const TILE = 16;
/** Critters fly above props and people but under the daylight tint, so evening darkens them too. */
const FLYER_DEPTH = 8_400;
const BIRD_DEPTH = 8_600;
const CLOUD_DEPTH = 8_900;
/** On the water or the ground: over the ground image (-10), under beds (-5) and everything standing. */
const WATER_DEPTH = -9;
const GROUND_SHADOW_DEPTH = -8;
const BUTTERFLY_KINDS = ["white", "yellow", "blue"] as const;
const MAX_LEAVES = 6;

type Keep = <T extends Phaser.GameObjects.GameObject>(object: T) => T;

interface Wanderer {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  target: Tile | null;
  restUntil: number;
  seed: number;
}

/**
 * Ambient critters on the farm (lib/stackacres-td/ambient.ts decides who is out and how they move): butterflies over
 * the meadow, a dragonfly darting over the pond, now and then a bird crossing the view with its shadow on the ground,
 * leaves falling from broadleaf trees when the wind gusts, a fish jumping, fireflies at night. They stay on the
 * area's `ambient` tiles, which keep clear of everything a player taps, move in whole art pixels, and all vanish under
 * prefers-reduced-motion. Cloud shadows are here too, off until switched on (Kayo signs those off first).
 */
export class AmbientLife {
  private meadow = new Set<string>();
  private meadowTiles: Tile[] = [];
  private pond = new Set<string>();
  private pondTiles: Tile[] = [];
  private canopies: { x: number; y: number }[] = [];
  private mapWidth = 0;
  private butterflies: Wanderer[] = [];
  private fireflies: (Wanderer & { on: number; off: number })[] = [];
  private dragonfly: (Wanderer & { darting: boolean }) | null = null;
  private bird: { image: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; x: number; y: number; vx: number; born: number } | null = null;
  private nextBird = 0;
  private fish: { image: Phaser.GameObjects.Image; born: number } | null = null;
  private nextFish = 0;
  private leaves: { image: Phaser.GameObjects.Image; x: number; y: number; drop: number; born: number }[] = [];
  private nextLeaf = 0;
  private clouds: { image: Phaser.GameObjects.Image; x: number; y: number }[] = [];
  private cloudsOn = false;
  private lastTime = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: Keep,
  ) {}

  /** Called on entering an area, after the area's objects were cleared. */
  build(spec: AmbientSpec, mapWidth: number, mapHeight: number): void {
    this.meadowTiles = spec.meadow;
    this.meadow = new Set(spec.meadow.map(tileId));
    this.pondTiles = spec.pond;
    this.pond = new Set(spec.pond.map(tileId));
    this.canopies = spec.canopies;
    this.mapWidth = mapWidth;
    this.butterflies = [];
    this.fireflies = [];
    this.dragonfly = null;
    this.bird = null;
    this.fish = null;
    this.leaves = [];
    this.clouds = [0, 1].map((i) => {
      const image = this.keep(this.scene.add.image(0, 0, "common", `cloud_${i}`).setOrigin(0, 0).setDepth(CLOUD_DEPTH).setVisible(false));
      return { image, x: Math.random() * mapWidth, y: (mapHeight / 3) * (i + 0.5) };
    });
  }

  setClouds(on: boolean): void {
    this.cloudsOn = on;
  }

  update(time: number, hour: number, reducedMotion: boolean, view: Phaser.Geom.Rectangle): void {
    const delta = Math.min(100, time - this.lastTime);
    this.lastTime = time;
    const active = reducedMotion ? new Set() : activeCritters(hour);

    this.updateButterflies(time, delta, active.has("butterflies"), view);
    this.updateDragonfly(time, delta, active.has("dragonfly"), view);
    this.updateFireflies(time, delta, active.has("fireflies"), view);
    this.updateBird(time, delta, active.has("birds"), view);
    this.updateFish(time, active.has("fish"));
    this.updateLeaves(time, active.has("leaves"), view);
    for (const cloud of this.clouds) {
      const on = this.cloudsOn && !reducedMotion;
      cloud.image.setVisible(on);
      if (!on) continue;
      cloud.x += (5 * delta) / 1000;
      if (cloud.x > this.mapWidth + 16) cloud.x = -cloud.image.width;
      cloud.image.setPosition(Math.floor(cloud.x), Math.floor(cloud.y));
    }
  }

  private wanderer(tiles: Tile[], frame: string, seed: number, view: Phaser.Geom.Rectangle): Wanderer {
    const [x, y] = this.tileNear(tiles, view, false);
    const image = this.keep(this.scene.add.image(x, y, "common", frame).setOrigin(0, 0));
    return { image, x, y, target: null, restUntil: 0, seed };
  }

  /**
   * A tile centre where the player will see a critter: inside the view, or (`offscreen`) in a band just outside it,
   * so it flies in rather than popping up. Any allowed tile when neither has one.
   */
  private tileNear(tiles: Tile[], view: Phaser.Geom.Rectangle, offscreen: boolean): [number, number] {
    const centre = (t: Tile): [number, number] => [t[0] * TILE + 8, t[1] * TILE + 8];
    const inside = (x: number, y: number, pad: number) =>
      x >= view.x - pad && x <= view.right + pad && y >= view.y - pad && y <= view.bottom + pad;
    const pool = tiles.map(centre).filter(([x, y]) => (offscreen ? inside(x, y, 40) && !inside(x, y, 0) : inside(x, y, 0)));
    const from = pool.length > 0 ? pool : tiles.map(centre);
    return from[Math.floor(Math.random() * from.length)];
  }

  /** A critter that has wandered well out of view comes back from just off-screen, so the view is never empty. */
  private recall(w: Wanderer, tiles: Tile[], view: Phaser.Geom.Rectangle): void {
    const far = w.x < view.x - 96 || w.x > view.right + 96 || w.y < view.y - 96 || w.y > view.bottom + 96;
    if (!far) return;
    [w.x, w.y] = this.tileNear(tiles, view, true);
    w.target = null;
  }

  /** Steps a wanderer toward its target tile; returns true once it has arrived. */
  private stepToward(w: Wanderer, allowed: ReadonlySet<string>, reach: number, speed: number, delta: number): boolean {
    if (!w.target) w.target = nearbyTile(allowed, [Math.floor(w.x / TILE), Math.floor(w.y / TILE)], reach, Math.random);
    if (!w.target) return true;
    const gx = w.target[0] * TILE + 8;
    const gy = w.target[1] * TILE + 8;
    const dx = gx - w.x;
    const dy = gy - w.y;
    const dist = Math.hypot(dx, dy);
    const step = (speed * delta) / 1000;
    if (dist <= step) {
      w.x = gx;
      w.y = gy;
      w.target = null;
      return true;
    }
    w.x += (dx / dist) * step;
    w.y += (dy / dist) * step;
    if (Math.abs(dx) > 0.5) w.image.setFlipX(dx < 0);
    return false;
  }

  private place(image: Phaser.GameObjects.Image, x: number, y: number): void {
    image.setPosition(Math.round(x) - Math.floor(image.width / 2), Math.round(y) - image.height);
  }

  private updateButterflies(time: number, delta: number, on: boolean, view: Phaser.Geom.Rectangle): void {
    if (on && this.butterflies.length === 0 && this.meadowTiles.length > 0) {
      for (let i = 0; i < BUTTERFLIES; i++) {
        const kind = BUTTERFLY_KINDS[i % BUTTERFLY_KINDS.length];
        this.butterflies.push(this.wanderer(this.meadowTiles, `butterfly_${kind}_0`, i * 2.3, view));
        this.butterflies[i].image.setDepth(FLYER_DEPTH).setData("kind", kind);
      }
    }
    this.butterflies.forEach((b, i) => {
      b.image.setVisible(on);
      if (!on) return;
      const kind = b.image.getData("kind") as string;
      this.recall(b, this.meadowTiles, view);
      const resting = time < b.restUntil;
      if (!resting && this.stepToward(b, this.meadow, 3, 11, delta) && Math.random() < 0.35) {
        b.restUntil = time + 700 + Math.random() * 1500;
      }
      const open = resting ? Math.floor(time / 600) % 2 === 0 : Math.floor(time / 110 + i) % 2 === 0;
      b.image.setFrame(`butterfly_${kind}_${open ? 0 : 1}`);
      const flutter = resting ? 0 : Math.round(Math.sin(time / 160 + b.seed) * 1.5);
      this.place(b.image, b.x, b.y + flutter - 6);
    });
  }

  private updateDragonfly(time: number, delta: number, on: boolean, view: Phaser.Geom.Rectangle): void {
    if (on && !this.dragonfly && this.pondTiles.length > 0) {
      const w = this.wanderer(this.pondTiles, "dragonfly_0", 5.1, view);
      w.image.setDepth(FLYER_DEPTH);
      this.dragonfly = { ...w, darting: false };
    }
    const d = this.dragonfly;
    if (!d) return;
    d.image.setVisible(on);
    if (!on) return;
    if (!d.darting && time >= d.restUntil) d.darting = true;
    if (d.darting && this.stepToward(d, this.pond, 4, 70, delta)) {
      d.darting = false;
      d.restUntil = time + 600 + Math.random() * 1400;
    }
    const jitter = d.darting ? 0 : Math.round(Math.sin(time / 90) * 0.8);
    d.image.setFrame(`dragonfly_${Math.floor(time / 45) % 2}`);
    this.place(d.image, d.x + jitter, d.y - 4);
  }

  private updateFireflies(time: number, delta: number, on: boolean, view: Phaser.Geom.Rectangle): void {
    if (on && this.fireflies.length === 0 && this.meadowTiles.length > 0) {
      for (let i = 0; i < FIREFLIES; i++) {
        const w = this.wanderer(this.meadowTiles, "firefly", i * 1.9, view);
        w.image.setDepth(DAYLIGHT_DEPTH + 2).setBlendMode(Phaser.BlendModes.ADD);
        this.fireflies.push({ ...w, on: 900 + Math.random() * 700, off: 1200 + Math.random() * 1800 });
      }
    }
    for (const f of this.fireflies) {
      f.image.setVisible(on);
      if (!on) continue;
      this.recall(f, this.meadowTiles, view);
      this.stepToward(f, this.meadow, 2, 4, delta);
      f.image.setAlpha(fireflyAlpha(time + f.seed * 1000, f.on, f.off));
      this.place(f.image, f.x, f.y + Math.round(Math.sin(time / 700 + f.seed) * 2) - 8);
    }
  }

  private updateBird(time: number, delta: number, on: boolean, view: Phaser.Geom.Rectangle): void {
    if (this.bird) {
      const b = this.bird;
      b.x += (b.vx * delta) / 1000;
      const gone = b.vx > 0 ? b.x > view.right + 16 : b.x < view.x - 16;
      if (gone || !on) {
        b.image.destroy();
        b.shadow.destroy();
        this.bird = null;
        this.nextBird = time + between(BIRD_EVERY, Math.random);
        return;
      }
      const frames = [0, 1, 2, 1];
      b.image.setFrame(`bird_${frames[Math.floor((time - b.born) / 110) % frames.length]}`);
      this.place(b.image, b.x, b.y + Math.round(Math.sin((time - b.born) / 300) * 1.5));
      this.place(b.shadow, b.x + 8, b.y + 26);
      return;
    }
    if (!on || time < this.nextBird) return;
    if (this.nextBird === 0) {
      this.nextBird = time + between(BIRD_EVERY, Math.random);
      return;
    }
    const rows = this.meadowTiles.map(([, ty]) => ty * TILE + 8).filter((y) => y > view.y + 12 && y < view.bottom - 30);
    if (rows.length === 0) {
      this.nextBird = time + between(BIRD_EVERY, Math.random);
      return;
    }
    const east = Math.random() < 0.5;
    const y = rows[Math.floor(Math.random() * rows.length)];
    const x = east ? view.x - 12 : view.right + 12;
    const image = this.keep(this.scene.add.image(x, y, "common", "bird_0").setOrigin(0, 0).setDepth(BIRD_DEPTH).setFlipX(!east));
    const shadow = this.keep(this.scene.add.image(x, y, "common", "bird_shadow").setOrigin(0, 0).setDepth(GROUND_SHADOW_DEPTH));
    this.bird = { image, shadow, x, y, vx: east ? 46 : -46, born: time };
  }

  private updateFish(time: number, on: boolean): void {
    if (this.fish) {
      const frame = fishFrame(time - this.fish.born, 5);
      if (frame === null || !on) {
        this.fish.image.destroy();
        this.fish = null;
        this.nextFish = time + between(FISH_EVERY, Math.random);
      } else {
        this.fish.image.setFrame(`fish_${frame}`);
      }
      return;
    }
    if (!on || this.pondTiles.length === 0) return;
    if (this.nextFish === 0) {
      this.nextFish = time + between(FISH_EVERY, Math.random);
      return;
    }
    if (time < this.nextFish) return;
    const [tx, ty] = this.pondTiles[Math.floor(Math.random() * this.pondTiles.length)];
    const image = this.keep(this.scene.add.image(tx * TILE + 3, ty * TILE + 4, "common", "fish_0").setOrigin(0, 0).setDepth(WATER_DEPTH));
    this.fish = { image, born: time };
  }

  private updateLeaves(time: number, on: boolean, view: Phaser.Geom.Rectangle): void {
    this.leaves = this.leaves.filter((leaf) => {
      const fall = leafFall(time - leaf.born, leaf.drop);
      if (fall.landed && fall.alpha === 0) {
        leaf.image.destroy();
        return false;
      }
      if (!fall.landed) leaf.image.setFrame(`leaf_${Math.floor((time - leaf.born) / 160) % 4}`);
      leaf.image.setPosition(leaf.x + fall.dx, leaf.y + fall.dy).setAlpha(fall.alpha).setVisible(on);
      return true;
    });
    if (!on || time < this.nextLeaf || this.leaves.length >= MAX_LEAVES) return;
    const near = this.canopies.filter((c) => c.x > view.x - 24 && c.x < view.right + 24 && c.y > view.y - 24 && c.y < view.bottom + 24);
    if (near.length === 0) {
      this.nextLeaf = time + between(LEAF_EVERY, Math.random);
      return;
    }
    const canopy = near[Math.floor(Math.random() * near.length)];
    const x = canopy.x + Math.round((Math.random() - 0.5) * 20);
    const y = canopy.y + Math.round((Math.random() - 0.5) * 10);
    const image = this.keep(this.scene.add.image(x, y, "common", "leaf_0").setOrigin(0, 0).setDepth(canopy.y + 28));
    this.leaves.push({ image, x, y, drop: 16 + Math.round(Math.random() * 14), born: time });
    const gusty = gustAt(time, canopy.x) > 0.5;
    this.nextLeaf = time + between(LEAF_EVERY, Math.random) * (gusty ? 0.35 : 1);
  }
}
