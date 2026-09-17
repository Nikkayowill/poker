import Phaser from "phaser";
import { brightness, daylightAt, hourOf, tintColor, type Daylight } from "@/lib/stackacres-td/daylight";

/** A window, porch lamp or lantern that glows when it gets dark, exported per area by rich/export_rich.py. */
export interface LightPoint {
  kind: "window" | "lamp" | "lantern";
  x: number;
  y: number;
}

/** Above props and people (their depth is their map y), below cue bubbles (10_000), which are UI. */
export const DAYLIGHT_DEPTH = 9_000;
const SAMPLE_MS = 1000;

const GLOW: Record<LightPoint["kind"], { frame: string; alpha: number; flicker: number }> = {
  window: { frame: "glow_window", alpha: 0.9, flicker: 0 },
  lamp: { frame: "glow_lamp", alpha: 1, flicker: 0.08 },
  lantern: { frame: "glow_lamp", alpha: 1, flicker: 0.12 },
};

type Keep = <T extends Phaser.GameObjects.GameObject>(object: T) => T;

/**
 * The time of day over the map: one multiply-blended rectangle tints the whole view (lib/stackacres-td/daylight.ts
 * says what colour, from the player's local clock), and small additive glows light the windows and lamps as it
 * darkens. On the Canvas renderer, which has no multiply, the rectangle is a translucent dusk blue instead.
 */
export class DaylightLayer {
  private overlay: Phaser.GameObjects.Rectangle | null = null;
  private glows: { image: Phaser.GameObjects.Image; light: LightPoint; seed: number }[] = [];
  private override: number | null = null;
  private light: Daylight = daylightAt(12);
  private sampledAt = Number.NEGATIVE_INFINITY;
  private readonly webgl: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: Keep,
  ) {
    this.webgl = scene.sys.game.renderer.type === Phaser.WEBGL;
  }

  /** Called on entering an area, after the area's objects were cleared. */
  build(mapWidth: number, mapHeight: number, lights: readonly LightPoint[]): void {
    this.overlay = this.keep(
      this.scene.add.rectangle(-32, -32, mapWidth + 64, mapHeight + 64, 0xffffff).setOrigin(0, 0).setDepth(DAYLIGHT_DEPTH),
    );
    if (this.webgl) this.overlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.glows = lights.map((light, i) => {
      const image = this.keep(this.scene.add.image(0, 0, "common", GLOW[light.kind].frame));
      image
        .setOrigin(0, 0)
        .setPosition(light.x - Math.floor(image.width / 2), light.y - Math.floor(image.height / 2))
        .setDepth(DAYLIGHT_DEPTH + 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0);
      return { image, light, seed: i * 1.7 };
    });
    this.sampledAt = Number.NEGATIVE_INFINITY;
  }

  /** The hour the farm is lit for: the pinned preview hour, or the player's local clock. */
  hour(): number {
    return this.override ?? hourOf(new Date());
  }

  /** Dev only: pin the clock to an hour (0-24) to preview dusk or night, or null for the real local time. */
  setOverride(hour: number | null): void {
    this.override = hour;
    this.sampledAt = Number.NEGATIVE_INFINITY;
  }

  update(timeMs: number, reducedMotion: boolean): void {
    if (!this.overlay) return;
    if (timeMs - this.sampledAt >= SAMPLE_MS) {
      this.sampledAt = timeMs;
      this.light = daylightAt(this.hour());
      if (this.webgl) this.overlay.setFillStyle(tintColor(this.light), 1);
      else this.overlay.setFillStyle(0x1c2350, (1 - brightness(this.light)) * 0.9);
    }
    for (const glow of this.glows) {
      const spec = GLOW[glow.light.kind];
      const flicker =
        reducedMotion || spec.flicker === 0
          ? 0
          : spec.flicker * Math.abs(Math.sin(timeMs / 170 + glow.seed) * Math.sin(timeMs / 530 + glow.seed * 3));
      glow.image.setAlpha(this.light.lamps * spec.alpha * (1 - flicker));
    }
  }
}
