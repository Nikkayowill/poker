import Phaser from "phaser";
import { COINS, HOLD_MS, ORB_BURST_MS, SPLIT_MS, SWARM_MS, makeOrbBurst, motesLanded, orbPointAt, type OrbBurst, type OrbPixel } from "@/lib/stackacres-td/orb-burst";
import { makeShards, shardAt, shardGrid, type Shard } from "@/lib/stackacres-td/shards";

/** Over the daylight tint, so the orb glows at night the way it does on the arcade's dark ground; under the emotes. */
const ORB_DEPTH = 9_500;
/** The orb's soft dot, drawn once. */
const DOT = "orb-dot";
/** One dot's width at full size, in map pixels. */
const DOT_SIZE = 4.5;
/** What a chip warms toward as it reaches him. */
const WARM = 0xfff1c4;

interface LiveOrb {
  burst: OrbBurst;
  dots: Phaser.GameObjects.Image[];
  /** One wide soft glow behind the orb while it holds together. */
  halo: Phaser.GameObjects.Image;
  started: number;
  landed: number;
  onCoin: (index: number, last: boolean) => void;
}

interface LiveChips {
  shards: Shard[];
  dots: Phaser.GameObjects.Image[];
  started: number;
}

/** Which part of a picture the pieces come from, as shares of its height from the top. */
export interface PixelBand {
  readonly from: number;
  readonly to: number;
}

/**
 * The arcade's particle orb on the farm (lib/stackacres-td/orb-burst.ts has the motion): what
 * he breaks swarms into a glowing orb, which splits into coins that fly into him. Every point is
 * one soft additive dot, the same radial falloff the sign-in orb's points use, tinted per point.
 * A single swing's chips fly the short way (lib/stackacres-td/shards.ts) in the same dots.
 */
export class OrbBursts {
  private orbs: LiveOrb[] = [];
  private chipSets: LiveChips[] = [];
  /** Each picture's pixels, read once. */
  private readonly pixels = new Map<string, ImageData | null>();

  constructor(
    private readonly scene: Phaser.Scene,
    /** Where the coins go: his chest, read every frame so they follow him. */
    private readonly target: () => { x: number; y: number },
  ) {}

  /** Breaks `images` into an orb over where they stood. `onCoin` fires as each coin lands on him. */
  burst(images: readonly Phaser.GameObjects.Image[], onCoin: (index: number, last: boolean) => void): void {
    const pixels = images.flatMap((image) => this.sample(image, Math.floor(260 / images.length)));
    if (pixels.length === 0) return;
    let cx = 0;
    let cy = 0;
    for (const pixel of pixels) {
      cx += pixel.x;
      cy += pixel.y;
    }
    const centre = { x: cx / pixels.length, y: cy / pixels.length - 4 };
    const burst = makeOrbBurst(pixels, centre, this.target());
    const halo = this.dot(true).setDepth(ORB_DEPTH - 1).setTint(0xfff1c4);
    this.orbs.push({ burst, dots: burst.points.map(() => this.dot(false)), halo, started: this.scene.time.now, landed: 0, onCoin });
  }

  /** A few chips off the bottom of what one swing hit, straight into him. */
  chips(image: Phaser.GameObjects.Image, max: number, band: PixelBand): void {
    const pixels = this.sample(image, max, band);
    if (pixels.length === 0) return;
    let cx = 0;
    let cy = 0;
    for (const pixel of pixels) {
      cx += pixel.x;
      cy += pixel.y;
    }
    const shards = makeShards(pixels, { x: cx / pixels.length, y: cy / pixels.length }, this.target(), 0.25);
    this.chipSets.push({ shards, dots: shards.map(() => this.dot(false)), started: this.scene.time.now });
  }

  /** Drops everything in flight, for an area change: the pieces were flying across a map that is gone. */
  clear(): void {
    for (const { dots } of [...this.orbs, ...this.chipSets]) for (const dot of dots) dot.destroy();
    for (const { halo } of this.orbs) halo.destroy();
    this.orbs = [];
    this.chipSets = [];
  }

  update(time: number): void {
    if (this.orbs.length === 0 && this.chipSets.length === 0) return;
    const target = this.target();
    this.orbs = this.orbs.filter((orb) => {
      const ms = time - orb.started;
      orb.burst.points.forEach((point, i) => {
        const at = orbPointAt(orb.burst, point, ms, target);
        const dot = orb.dots[i];
        dot.setVisible(!at.landed).setPosition(at.x, at.y).setTint(at.colour).setAlpha(at.alpha);
        dot.setDisplaySize(DOT_SIZE * at.size, DOT_SIZE * at.size);
      });
      // The glow swells with the swarm, holds with the orb, and goes as it splits.
      const glow = orbGlow(ms);
      orb.halo.setVisible(glow > 0).setPosition(orb.burst.centre.x, orb.burst.centre.y).setAlpha(0.4 * glow);
      orb.halo.setDisplaySize(orb.burst.radius * 4.4, orb.burst.radius * 4.4);
      const landed = motesLanded(orb.burst, ms);
      while (orb.landed < landed) {
        orb.landed += 1;
        orb.onCoin(orb.landed - 1, orb.landed === COINS);
      }
      if (ms < ORB_BURST_MS) return true;
      for (const dot of orb.dots) dot.destroy();
      orb.halo.destroy();
      return false;
    });
    this.chipSets = this.chipSets.filter((set) => {
      const ms = time - set.started;
      let flying = false;
      set.shards.forEach((shard, i) => {
        const at = shardAt(shard, ms, target);
        const dot = set.dots[i];
        dot.setVisible(!at.arrived);
        if (at.arrived) return;
        flying = true;
        const size = DOT_SIZE * (0.7 * at.size + 0.3 * at.glow);
        dot.setPosition(at.x, at.y).setTint(warm(shard.colour, at.glow)).setAlpha(0.7 + 0.3 * at.glow).setDisplaySize(size, size);
      });
      if (flying) return true;
      for (const dot of set.dots) dot.destroy();
      return false;
    });
  }

  /**
   * One soft dot. The orb's points are drawn with plain alpha, not added light: on the arcade's
   * dark ground adding light made the rainbow, but on bright grass it turns every hue lime. The
   * halo behind the orb is the one additive light, which is what makes it glow.
   */
  private dot(additive: boolean): Phaser.GameObjects.Image {
    if (!this.scene.textures.exists(DOT)) {
      // The sign-in orb's own point: bright in the middle, gone by the edge.
      const size = 32;
      const texture = this.scene.textures.createCanvas(DOT, size, size);
      const ctx = texture?.getContext();
      if (texture && ctx) {
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.22, "rgba(255,255,255,0.9)");
        g.addColorStop(0.55, "rgba(255,255,255,0.2)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        texture.refresh();
      }
    }
    return this.scene.add
      .image(0, 0, DOT)
      .setBlendMode(additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setDepth(ORB_DEPTH)
      .setVisible(false);
  }

  /** The opaque pixels of one image, where they stand on the map. */
  private sample(image: Phaser.GameObjects.Image, max: number, band?: PixelBand): OrbPixel[] {
    const frame = image.frame;
    const data = this.read(frame);
    if (!data) return [];
    const w = frame.cutWidth;
    const h = frame.cutHeight;
    const top = Math.floor((band?.from ?? 0) * h);
    const bottom = Math.ceil((band?.to ?? 1) * h);
    const step = shardGrid(w, bottom - top, max);
    const scaleX = image.displayWidth / w;
    const scaleY = image.displayHeight / h;
    const left = image.x - image.originX * image.displayWidth;
    const y0 = image.y - image.originY * image.displayHeight;
    const pixels: OrbPixel[] = [];
    for (let sy = top; sy < bottom; sy += step) {
      for (let sx = 0; sx < w; sx += step) {
        const i = (sy * w + sx) * 4;
        if (data.data[i + 3] < 128) continue;
        pixels.push({
          x: left + (sx + 0.5) * scaleX,
          y: y0 + (sy + 0.5) * scaleY,
          colour: (data.data[i] << 16) | (data.data[i + 1] << 8) | data.data[i + 2],
        });
      }
    }
    return pixels.slice(0, max);
  }

  private read(frame: Phaser.Textures.Frame): ImageData | null {
    const key = `${frame.texture.key}|${frame.name}`;
    const cached = this.pixels.get(key);
    if (cached !== undefined) return cached;
    let data: ImageData | null = null;
    const source = frame.source.image as CanvasImageSource | undefined;
    if (source && frame.cutWidth > 0 && frame.cutHeight > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = frame.cutWidth;
      canvas.height = frame.cutHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(source, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
        data = ctx.getImageData(0, 0, frame.cutWidth, frame.cutHeight);
      }
    }
    this.pixels.set(key, data);
    return data;
  }
}

/** How strong the halo is `ms` into a burst: up through the swarm, full while the orb holds, gone as it splits. */
function orbGlow(ms: number): number {
  if (ms < SWARM_MS) return ms / SWARM_MS;
  if (ms < SWARM_MS + HOLD_MS) return 1;
  return Math.max(0, 1 - (ms - SWARM_MS - HOLD_MS) / SPLIT_MS);
}

/** `colour` moved `t` of the way to the warm glow. */
function warm(colour: number, t: number): number {
  const lerp = (shift: number) => Math.round(((colour >> shift) & 255) + (((WARM >> shift) & 255) - ((colour >> shift) & 255)) * t);
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}
