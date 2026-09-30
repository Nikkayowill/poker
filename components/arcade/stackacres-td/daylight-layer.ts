import Phaser from "phaser";
import { gameHourAt } from "@/lib/stackacres/clock";
import { brightness, daylightAt, indoorDaylightAt, tintColor, type Daylight } from "@/lib/stackacres-td/daylight";

type GlowKind = "window" | "lamp" | "lantern";

/**
 * A light exported per area by rich/export_rich.py. A window, porch lamp or lantern glows when it gets dark.
 * A `sun` is a patch of window light on a floor, drawn from `frame` in that area's props atlas with its top-left
 * at x,y, and fades out as the lamps come on.
 */
export type LightPoint =
  | { kind: GlowKind; x: number; y: number }
  | { kind: "sun"; x: number; y: number; frame: string; scale: number };

/** Above props and people (their depth is their map y), below cue bubbles (10_000), which are UI. */
export const DAYLIGHT_DEPTH = 9_000;
/** Sunbeams lie on the floor: over the ground picture (-10), under beds, shadows, props and people. */
const SUNBEAM_DEPTH = -9;
/** How strong a sunbeam is at full day. */
const SUNBEAM_ALPHA = 0.85;
const SAMPLE_MS = 1000;

const GLOW: Record<GlowKind, { frame: string; alpha: number; flicker: number }> = {
  window: { frame: "glow_window", alpha: 0.9, flicker: 0 },
  lamp: { frame: "glow_lamp", alpha: 1, flicker: 0.08 },
  lantern: { frame: "glow_lamp", alpha: 1, flicker: 0.12 },
};

type Keep = <T extends Phaser.GameObjects.GameObject>(object: T) => T;

/**
 * The time of day over the map: one multiply-blended rectangle tints the whole view (lib/stackacres-td/daylight.ts
 * says what colour, from the farm clock), and small additive glows light the windows and lamps as it darkens.
 * On the Canvas renderer, which has no multiply, the rectangle is a translucent dusk blue instead.
 */
export class DaylightLayer {
  private overlay: Phaser.GameObjects.Rectangle | null = null;
  private glows: { image: Phaser.GameObjects.Image; kind: GlowKind; seed: number }[] = [];
  private sunbeams: Phaser.GameObjects.Image[] = [];
  private override: number | null = null;
  /** Where the hour comes from. The shell hands in the farm clock with this farm's offset. */
  private source: () => number = () => gameHourAt(Date.now(), 0);
  private light: Daylight = daylightAt(12);
  private sampledAt = Number.NEGATIVE_INFINITY;
  private readonly webgl: boolean;
  /** An interior: its own lamplit curve instead of the yard's. */
  private indoor = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: Keep,
  ) {
    this.webgl = scene.sys.game.renderer.type === Phaser.WEBGL;
  }

  /** Called on entering an area, after the area's objects were cleared. `propsKey` is that area's props atlas. */
  build(mapWidth: number, mapHeight: number, lights: readonly LightPoint[], indoor: boolean, propsKey: string): void {
    this.indoor = indoor;
    this.overlay = this.keep(
      // Well past the map's edges: a cast lifts the camera above its top (scene.ts `easeHeadroom`).
      this.scene.add.rectangle(-160, -160, mapWidth + 320, mapHeight + 320, 0xffffff).setOrigin(0, 0).setDepth(DAYLIGHT_DEPTH),
    );
    if (this.webgl) this.overlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.glows = [];
    this.sunbeams = [];
    const atlas = this.scene.textures.exists(propsKey) ? this.scene.textures.get(propsKey) : null;
    lights.forEach((light, i) => {
      if (light.kind === "sun") {
        // A beam the atlas does not have is left out rather than drawn as a missing-texture box.
        if (!atlas?.has(light.frame)) return;
        this.sunbeams.push(
          this.keep(
            this.scene.add
              .image(light.x, light.y, propsKey, light.frame)
              .setOrigin(0, 0)
              .setScale(light.scale)
              .setDepth(SUNBEAM_DEPTH)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setAlpha(0),
          ),
        );
        return;
      }
      const image = this.keep(this.scene.add.image(0, 0, "common", GLOW[light.kind].frame));
      image
        .setOrigin(0, 0)
        .setPosition(light.x - Math.floor(image.width / 2), light.y - Math.floor(image.height / 2))
        .setDepth(DAYLIGHT_DEPTH + 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0);
      this.glows.push({ image, kind: light.kind, seed: i * 1.7 });
    });
    this.resample();
  }

  /** The hour the farm is lit for: the pinned preview hour, or the farm clock. */
  hour(): number {
    return this.override ?? this.source();
  }

  /** Where the farm clock is read from (the shell's `gameHourNow`). */
  setSource(source: () => number): void {
    this.source = source;
    this.resample();
  }

  /** Dev only: pin the clock to an hour (0-24) to preview dusk or night, or null for the farm clock. */
  setOverride(hour: number | null): void {
    this.override = hour;
    this.resample();
  }

  /** Read the clock again on the next frame rather than up to a second later, as after a sleep. */
  resample(): void {
    this.sampledAt = Number.NEGATIVE_INFINITY;
  }

  update(timeMs: number, reducedMotion: boolean): void {
    if (!this.overlay) return;
    if (timeMs - this.sampledAt >= SAMPLE_MS) {
      this.sampledAt = timeMs;
      this.light = this.indoor ? indoorDaylightAt(this.hour()) : daylightAt(this.hour());
      if (this.webgl) this.overlay.setFillStyle(tintColor(this.light), 1);
      else this.overlay.setFillStyle(0x1c2350, (1 - brightness(this.light)) * 0.9);
      for (const beam of this.sunbeams) beam.setAlpha((1 - this.light.lamps) * SUNBEAM_ALPHA);
    }
    for (const glow of this.glows) {
      const spec = GLOW[glow.kind];
      const flicker =
        reducedMotion || spec.flicker === 0
          ? 0
          : spec.flicker * Math.abs(Math.sin(timeMs / 170 + glow.seed) * Math.sin(timeMs / 530 + glow.seed * 3));
      glow.image.setAlpha(this.light.lamps * spec.alpha * (1 - flicker));
    }
  }
}
