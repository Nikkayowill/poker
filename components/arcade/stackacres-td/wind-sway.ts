import type Phaser from "phaser";
import type { Point } from "@/lib/stackacres-td/movement";
import { RUSTLE_COOLDOWN_MS, RUSTLE_REACH, rustleOffset, swayOffset } from "@/lib/stackacres-td/wind";

interface Part {
  image: Phaser.GameObjects.Image;
  baseX: number;
  /** The prop's base point, which seeds its rhythm and is what the farmer brushes past. */
  x: number;
  y: number;
  amp: number;
  rustle: boolean;
  rustleAt: number | null;
  lastRustle: number;
  offset: number;
}

/**
 * Moves the swaying part of trees, reeds and grasses (exported as its own image over the part that stays put) by
 * whole art pixels, so nothing blurs: a slow lean east with gusts rolling across (lib/stackacres-td/wind.ts), and a
 * quick rustle when the farmer walks through grass. Off entirely under prefers-reduced-motion.
 */
export class WindSway {
  private parts: Part[] = [];

  clear(): void {
    this.parts = [];
  }

  add(image: Phaser.GameObjects.Image, x: number, y: number, amp: number, rustle: boolean): void {
    this.parts.push({ image, baseX: image.x, x, y, amp, rustle, rustleAt: null, lastRustle: Number.NEGATIVE_INFINITY, offset: 0 });
  }

  update(timeMs: number, feet: Point, walking: boolean, reducedMotion: boolean): void {
    for (const part of this.parts) {
      let offset = 0;
      if (!reducedMotion) {
        offset = swayOffset(timeMs, part.x, part.y, part.amp);
        if (part.rustle) {
          const brushed =
            walking &&
            Math.abs(feet.x - part.x) <= RUSTLE_REACH.x &&
            Math.abs(feet.y - part.y) <= RUSTLE_REACH.y &&
            timeMs - part.lastRustle > RUSTLE_COOLDOWN_MS;
          if (part.rustleAt === null && brushed) part.rustleAt = timeMs;
          if (part.rustleAt !== null) {
            const rustle = rustleOffset(timeMs - part.rustleAt);
            if (rustle === null) {
              part.rustleAt = null;
              part.lastRustle = timeMs;
            } else {
              offset = rustle;
            }
          }
        }
      }
      if (offset !== part.offset) {
        part.offset = offset;
        part.image.x = part.baseX + offset;
      }
    }
  }
}
