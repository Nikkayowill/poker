import type Phaser from "phaser";
import type { Point } from "@/lib/stackacres-td/movement";
import { RUSTLE_COOLDOWN_MS, RUSTLE_REACH, rustleOffset, swayOffset } from "@/lib/stackacres-td/wind";

interface Part {
  image: Phaser.GameObjects.Image;
  /** The prop's base point: the pivot it bends from, what seeds its rhythm, and what the farmer brushes past. */
  x: number;
  y: number;
  /** Map px from the pivot to the top of the picture: the lever a sideways lean is measured along. */
  lever: number;
  amp: number;
  rustle: boolean;
  rustleAt: number | null;
  lastRustle: number;
  offset: number;
}

/** How far past the edge of the view a swaying thing may stand and still be moved, in map px: a tall tree
 *  whose foot is just off the bottom of the screen still has its crown on it. */
const VIEW_MARGIN = 96;

/**
 * Bends the swaying part of trees, reeds and grasses (exported as its own image over the part that stays put)
 * from its base: a slow lean east with gusts rolling across (lib/stackacres-td/wind.ts), and a quick rustle when
 * the farmer walks through grass. Off entirely under prefers-reduced-motion.
 *
 * BENT, NOT SLID. The crown turns about the foot of its trunk, so the top moves most and the base not at all,
 * the way a tree actually moves. It used to slide the whole crown sideways by a whole pixel, which read as a
 * tree standing still with a twitch.
 *
 * ONLY WHAT IS ON SCREEN. A farm has a few hundred swaying things and a view shows a few dozen; the rest are not
 * touched until the camera comes to them. Moving all of them every frame was work a phone paid for and nobody saw.
 */
export class WindSway {
  private parts: Part[] = [];

  clear(): void {
    this.parts = [];
  }

  /**
   * Starts moving `image` in the wind, pivoting at the base point (x, y). The image arrives placed by its top-left
   * corner; this moves its origin to the base and puts it back where it was, so nothing shifts on screen.
   */
  add(image: Phaser.GameObjects.Image, x: number, y: number, amp: number, rustle: boolean): void {
    const left = image.x - image.displayOriginX * image.scaleX;
    const top = image.y - image.displayOriginY * image.scaleY;
    image.setOrigin((x - left) / image.displayWidth, (y - top) / image.displayHeight).setPosition(x, y);
    const lever = Math.max(1, y - top);
    this.parts.push({ image, x, y, lever, amp, rustle, rustleAt: null, lastRustle: Number.NEGATIVE_INFINITY, offset: 0 });
  }

  update(timeMs: number, feet: Point, walking: boolean, reducedMotion: boolean, view: Phaser.Geom.Rectangle): void {
    const left = view.x - VIEW_MARGIN;
    const right = view.right + VIEW_MARGIN;
    const top = view.y - VIEW_MARGIN;
    const bottom = view.bottom + VIEW_MARGIN * 2;
    for (const part of this.parts) {
      if (part.x < left || part.x > right || part.y < top || part.y > bottom) continue;
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
        part.image.rotation = Math.atan2(offset, part.lever);
      }
    }
  }
}
