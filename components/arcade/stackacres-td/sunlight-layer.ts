import Phaser from "phaser";
import { sunlightAt, type Sunlight } from "@/lib/stackacres-td/daylight";
import { DAYLIGHT_DEPTH } from "./daylight-layer";
import type { WindSway } from "./wind-sway";

/**
 * The sun over the farm, on top of the clock's tint (daylight-layer.ts): three things Stardew's outdoors
 * has and a flat multiply never gives.
 *
 * - God rays: shafts of warm light leaning in from the top-left, added over the whole view, breathing
 *   slowly. Longest with the low sun of morning and late afternoon (lib/stackacres-td/daylight.ts's
 *   `sunlightAt`), gone at night.
 * - Cloud shadows: a few big soft patches of shade drifting east over everything that stands, trees
 *   included, so the light on the farm is never the same two moments running. Their edges are posterized
 *   to three steps rather than blurred, so they stay pixel art.
 * - Lit tree tops: every canopy gets a warm additive copy of its own top half, swaying with it, so the
 *   sun visibly hits the trees before the ground.
 *
 * Everything here is drawn by the engine from textures made once per scene, so the exported art is
 * untouched. Reduced motion keeps the light but stops it moving.
 */

/** Shadows fall on the trees too: over props and people, under the daylight tint. */
const CLOUD_DEPTH = 8_900;
/** Rays add over the tint so the whole view, tree tops first, catches them. */
const RAY_DEPTH = DAYLIGHT_DEPTH + 2;
const RAY_TEXTURE = "sun-ray";
/** One shaft is drawn this big (px) and scaled to the screen; it fades to nothing by its foot. */
const RAY_W = 96;
const RAY_H = 320;
/**
 * Where each beam hangs from, as a share of the screen width, its lean from vertical, its own weight and
 * its width as a share of RAY_W. Nine of them, thick and thin, so the light reads as a fan of beams
 * through a canopy rather than an even wash.
 */
const RAY_SPOTS: readonly [number, number, number, number][] = [
  [0.02, -0.38, 0.9, 0.16],
  [0.13, -0.35, 0.55, 0.08],
  [0.25, -0.4, 1, 0.2],
  [0.36, -0.36, 0.5, 0.07],
  [0.47, -0.39, 0.85, 0.14],
  [0.6, -0.34, 0.6, 0.1],
  [0.72, -0.4, 1, 0.19],
  [0.85, -0.37, 0.5, 0.08],
  [0.96, -0.35, 0.8, 0.15],
];
const CLOUD_TEXTURE = "cloud-shade";
/**
 * A phone at 4x sees about 208x128 map px, so a shadow has to be smaller than that to read as a cloud
 * passing over rather than the whole lawn going dark: a third to a half of the view, several of them,
 * crossing the view in ten seconds or so. Bigger and slower it looked like a damp patch on the grass.
 */
const CLOUD_SIZES: readonly [number, number][] = [
  [112, 64],
  [84, 50],
  [136, 78],
  [96, 58],
  [124, 70],
];
const CLOUD_COUNT = CLOUD_SIZES.length;
/** Map px per second the shade drifts east, and how much south with it. */
const CLOUD_SPEED = 16;
const CLOUD_DRIFT_Y = 0.18;
const RAY_ALPHA = 0.62;
const CLOUD_ALPHA = 0.5;
const CANOPY_ALPHA = 0.3;
const CANOPY_TINT = 0xffd27a;
const RAY_TINT = 0xffe2a0;
const SAMPLE_MS = 1000;

type Keep = <T extends Phaser.GameObjects.GameObject>(object: T) => T;

interface CloudShade {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  speed: number;
}

export class SunlightLayer {
  private rays: { image: Phaser.GameObjects.Image; weight: number; phase: number }[] = [];
  private seeded = false;
  private viewCentre = { x: 0, y: 0 };
  private clouds: CloudShade[] = [];
  private canopies: Phaser.GameObjects.Image[] = [];
  private sun: Sunlight = sunlightAt(12);
  private sampledAt = Number.NEGATIVE_INFINITY;
  private lastTime = 0;
  private mapWidth = 0;
  private mapHeight = 0;
  private indoor = false;
  private readonly webgl: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: Keep,
    private readonly wind: WindSway,
  ) {
    this.webgl = scene.sys.game.renderer.type === Phaser.WEBGL;
  }

  /** Called on entering an area, after the area's objects were cleared and before its props are built. */
  build(mapWidth: number, mapHeight: number, indoor: boolean): void {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.indoor = indoor;
    this.rays = [];
    this.clouds = [];
    this.canopies = [];
    this.sampledAt = Number.NEGATIVE_INFINITY;
    this.seeded = false;
    if (indoor) return;
    this.makeTextures();
    // The shafts hang from the top of the SCREEN, not the map: light comes from above the view wherever
    // the camera is, and each one fades out before the foot of the screen, so the ground below stays calm.
    this.rays = RAY_SPOTS.map(([, lean, weight, , ], i) => {
      const image = this.keep(
        this.scene.add
          .image(0, 0, RAY_TEXTURE)
          .setOrigin(0.5, 0)
          .setScrollFactor(0)
          .setRotation(lean)
          .setDepth(RAY_DEPTH)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(RAY_TINT)
          .setAlpha(0),
      );
      return { image, weight, phase: i * 1.3 };
    });
    for (let i = 0; i < CLOUD_COUNT; i += 1) {
      const image = this.keep(
        this.scene.add
          .image(0, 0, `${CLOUD_TEXTURE}-${i}`)
          .setOrigin(0, 0)
          .setDepth(CLOUD_DEPTH + i)
          .setAlpha(0),
      );
      if (this.webgl) image.setBlendMode(Phaser.BlendModes.MULTIPLY);
      this.clouds.push({
        image,
        x: (mapWidth / CLOUD_COUNT) * i + ((i * 97) % 120),
        y: ((i * 211 + 37) % Math.max(1, mapHeight - image.height)),
        speed: CLOUD_SPEED * (0.85 + (i % 3) * 0.15),
      });
    }
  }

  /**
   * The sunlit top of one canopy: a warm copy of its upper half, added over it and swaying with it.
   * Called wherever the scene builds a tree's canopy, for the map's own trees and the wild land's alike.
   */
  lightCanopy(canopy: Phaser.GameObjects.Image, x: number, y: number, amp: number, rustle: boolean): void {
    if (this.indoor) return;
    const lit = this.keep(
      this.scene.add
        .image(canopy.x, canopy.y, canopy.texture.key, canopy.frame.name)
        .setOrigin(0, 0)
        .setScale(canopy.scaleX, canopy.scaleY)
        .setDepth(canopy.depth + 0.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(CANOPY_TINT)
        .setAlpha(0),
    );
    // The sun is high and to the left: only the top of the crown catches it.
    lit.setCrop(0, 0, canopy.frame.width, Math.round(canopy.frame.height * 0.55));
    this.wind.add(lit, x, y, amp, rustle);
    this.canopies.push(lit);
  }

  /** `view` is the camera's world view: the clouds live in and around it, since a shadow off screen lights nothing. */
  update(timeMs: number, hour: number, reducedMotion: boolean, view: Phaser.Geom.Rectangle): void {
    if (this.indoor) return;
    const delta = Math.min(100, timeMs - this.lastTime);
    this.lastTime = timeMs;
    if (timeMs - this.sampledAt >= SAMPLE_MS) {
      this.sampledAt = timeMs;
      this.sun = sunlightAt(hour);
      for (const lit of this.canopies) lit.setAlpha(CANOPY_ALPHA * this.sun.canopy);
    }
    // A screen-fixed object is still scaled by the camera's zoom, about the middle of the canvas: so the
    // visible screen, in the units these objects are placed in, is the canvas size over the zoom, centred
    // on the canvas's own middle. Everything below is measured in that box.
    const camera = this.scene.cameras.main;
    const zoom = camera.zoom || 1;
    const viewW = camera.width / zoom;
    const viewH = camera.height / zoom;
    const screenLeft = camera.width / 2 - viewW / 2;
    const screenTop = camera.height / 2 - viewH / 2;
    this.rays.forEach((ray, i) => {
      const [at, , , width] = RAY_SPOTS[i];
      // Each beam breathes on its own slow rhythm and sways a little, so the light never sits still.
      const t = reducedMotion ? 0 : timeMs / 1000;
      const breath = 0.72 + 0.28 * Math.sin(t / 4.1 + ray.phase);
      const sway = Math.sin(t / 7.3 + ray.phase * 2) * viewW * 0.02;
      ray.image.setPosition(screenLeft + at * viewW + sway, screenTop - viewH * 0.04);
      ray.image.setDisplaySize(viewW * width, viewH * 1.3);
      ray.image.setAlpha(RAY_ALPHA * this.sun.rays * ray.weight * breath);
    });
    // The camera jumping (the farm opening, a walk through a door, the map's travel buttons) leaves the
    // shade where the view used to be, so a jump re-deals it over the new view.
    const jumped = Math.hypot(view.centerX - this.viewCentre.x, view.centerY - this.viewCentre.y) > view.width;
    this.viewCentre = { x: view.centerX, y: view.centerY };
    if ((!this.seeded || jumped) && view.width > 0) {
      // Spread the shade across the view, so a cloud is already crossing instead of all of them
      // queuing off the west edge.
      this.seeded = true;
      this.clouds.forEach((cloud, i) => {
        cloud.x = view.x - 80 + ((i + 0.3) / this.clouds.length) * (view.width + 160);
        cloud.y = view.y - 40 + ((i * 211 + 37) % Math.max(1, Math.round(view.height + 40)));
      });
    }
    // The clouds keep to a band round the view: one that drifts off its east side comes back in on the
    // west, at a new height, so there is always shade crossing wherever the camera is.
    const left = view.x - 160;
    const right = view.right + 160;
    const top = view.y - 96;
    const bottom = view.bottom + 96;
    this.clouds.forEach((cloud, i) => {
      cloud.image.setAlpha(CLOUD_ALPHA * this.sun.clouds);
      if (!reducedMotion) {
        cloud.x += (cloud.speed * delta) / 1000;
        cloud.y += (cloud.speed * CLOUD_DRIFT_Y * delta) / 1000;
      }
      const w = cloud.image.width;
      const h = cloud.image.height;
      if (cloud.x > right || cloud.x + w < left - 400) {
        cloud.x = left - w - ((i * 61) % 120);
        cloud.y = top + Math.random() * Math.max(1, bottom - top - h);
      } else if (cloud.y > bottom || cloud.y + h < top - 200) {
        cloud.y = top - h + ((i * 41) % 60);
        cloud.x = left + Math.random() * Math.max(1, right - left - w);
      }
      cloud.image.setPosition(Math.round(cloud.x), Math.round(cloud.y));
    });
  }

  private makeTextures(): void {
    const textures = this.scene.textures;
    if (!textures.exists(RAY_TEXTURE)) {
      // One beam: a bright core inside a wide soft halo, full at the top, fading to nothing by its foot.
      const canvas = textures.createCanvas(RAY_TEXTURE, RAY_W, RAY_H);
      if (canvas) {
        const ctx = canvas.getContext();
        const image = ctx.createImageData(RAY_W, RAY_H);
        for (let y = 0; y < RAY_H; y += 1) {
          const v = y / RAY_H;
          const fall = v < 0.06 ? v / 0.06 : Math.max(0, 1 - (v - 0.06) / 0.86) ** 1.25;
          for (let x = 0; x < RAY_W; x += 1) {
            const u = (x / RAY_W) * 2 - 1;
            const body = Math.max(0, 1 - u * u);
            const bell = 0.55 * body ** 3.2 + 0.45 * body ** 1.1;
            const p = (y * RAY_W + x) * 4;
            image.data[p] = 255;
            image.data[p + 1] = 255;
            image.data[p + 2] = 255;
            image.data[p + 3] = Math.round(255 * bell * fall);
          }
        }
        ctx.putImageData(image, 0, 0);
        canvas.refresh();
      }
    }
    CLOUD_SIZES.forEach(([w, h], i) => {
      const key = `${CLOUD_TEXTURE}-${i}`;
      if (textures.exists(key)) return;
      const canvas = textures.createCanvas(key, w, h);
      if (!canvas) return;
      const ctx = canvas.getContext();
      const field = new Float32Array(w * h);
      // A cloud is a few overlapping ovals with a ragged edge; the field is how deep inside each pixel sits.
      const lobes = 5 + (i % 3);
      for (let k = 0; k < lobes; k += 1) {
        const t = (k + 0.5) / lobes;
        const cx = w * (0.14 + t * 0.72) + Math.sin(k * 2.3 + i) * w * 0.05;
        const cy = h * 0.5 + Math.cos(k * 1.7 + i * 2) * h * 0.16;
        const rx = w * (0.15 + 0.09 * Math.sin(t * Math.PI));
        const ry = h * (0.28 + 0.12 * Math.cos(k + i));
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const ragged = 1 + 0.08 * Math.sin(x * 0.9 + k) * Math.cos(y * 1.1 - k);
            const d = 1 - Math.hypot((x - cx) / rx, (y - cy) / ry) * ragged;
            if (d > field[y * w + x]) field[y * w + x] = d;
          }
        }
      }
      const image = ctx.createImageData(w, h);
      for (let p = 0; p < w * h; p += 1) {
        const d = field[p];
        // Five steps of alpha over the rim, then solid: soft enough to read as shade, still a drawn edge.
        const a = d <= 0 ? 0 : d < 0.06 ? 0.2 : d < 0.13 ? 0.4 : d < 0.21 ? 0.6 : d < 0.3 ? 0.8 : 1;
        image.data[p * 4] = 150;
        image.data[p * 4 + 1] = 160;
        image.data[p * 4 + 2] = 190;
        image.data[p * 4 + 3] = Math.round(a * 255);
      }
      ctx.putImageData(image, 0, 0);
      canvas.refresh();
    });
  }
}
