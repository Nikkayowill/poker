import type Phaser from "phaser";

/** A chimney (or anything else that smokes), exported per area by rich/export_rich.py. */
export interface Emitter {
  kind: "smoke";
  x: number;
  y: number;
}

/** Above the roofs, below the daylight tint so smoke darkens with the evening. */
const SMOKE_DEPTH = 8_000;
const EVERY_MS = 850;
const LIFE_MS = 3200;
/** Opacity in hard steps over a puff's life, the way a pixel-art animation fades. */
const FADE = [0.9, 0.75, 0.55, 0.35, 0.15];

type Keep = <T extends Phaser.GameObjects.GameObject>(object: T) => T;

interface Puff {
  image: Phaser.GameObjects.Image;
  born: number;
  x: number;
  y: number;
}

/**
 * Chimney smoke as a few rising, drifting, fading puffs instead of baked frames: each moves in whole art pixels,
 * up about 8px a second and east with the wind, and grows through three sizes. A small fixed pool per chimney.
 * Nothing is drawn under prefers-reduced-motion.
 */
export class ChimneySmoke {
  private emitters: Emitter[] = [];
  private puffs: Puff[] = [];
  private nextAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: Keep,
  ) {}

  build(emitters: readonly Emitter[]): void {
    this.emitters = emitters.filter((e) => e.kind === "smoke");
    this.puffs = [];
    this.nextAt = 0;
  }

  update(timeMs: number, reducedMotion: boolean): void {
    if (reducedMotion) {
      for (const puff of this.puffs) puff.image.setVisible(false);
      return;
    }
    if (timeMs >= this.nextAt && this.emitters.length > 0) {
      this.nextAt = timeMs + EVERY_MS;
      for (const emitter of this.emitters) this.spawn(emitter, timeMs);
    }
    for (const puff of this.puffs) {
      const age = timeMs - puff.born;
      if (age >= LIFE_MS) {
        puff.image.setVisible(false);
        continue;
      }
      const frame = age < 700 ? "smoke_0" : age < 1800 ? "smoke_1" : "smoke_2";
      if (puff.image.frame.name !== frame) puff.image.setFrame(frame);
      const x = puff.x + Math.floor(age / 520) - Math.floor(puff.image.width / 2);
      const y = puff.y - Math.floor(age / 130) - puff.image.height;
      puff.image.setPosition(x, y).setAlpha(FADE[Math.min(FADE.length - 1, Math.floor((age / LIFE_MS) * FADE.length))]);
    }
  }

  private spawn(emitter: Emitter, timeMs: number): void {
    const x = emitter.x + ((Math.floor(timeMs / EVERY_MS) % 3) - 1);
    const idle = this.puffs.find((p) => !p.image.visible);
    if (idle) {
      idle.image.setVisible(true).setFrame("smoke_0");
      Object.assign(idle, { born: timeMs, x, y: emitter.y });
      return;
    }
    const image = this.keep(this.scene.add.image(x, emitter.y, "common", "smoke_0").setOrigin(0, 0).setDepth(SMOKE_DEPTH));
    this.puffs.push({ image, born: timeMs, x, y: emitter.y });
  }
}
