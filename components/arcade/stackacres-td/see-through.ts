import type Phaser from "phaser";
import {
  SEE_THROUGH_ALPHA,
  canHide,
  fadeStep,
  hidesFarmer,
  nearBody,
  tapPassesThrough,
  type Box,
  type Point,
} from "@/lib/stackacres-td/see-through";

/** A tree (trunk and crown) or a building. */
export interface SeeThroughProp {
  readonly images: readonly Phaser.GameObjects.Image[];
  readonly baseY: number;
}

interface Tracked extends SeeThroughProp {
  /** Taken once; tall things only lean in the wind or shiver when chopped. */
  readonly box: Box;
  alpha: number;
  hiding: boolean;
}

/** Soft edges and shadows don't count as hiding him. */
const SOLID = 96;
/** World px of slack for the wind's lean and a chop's shiver. */
const BOX_SLACK = 3;

/** Fades whatever is hiding the farmer (lib/stackacres-td/see-through.ts). */
export class SeeThrough {
  private tracked: Tracked[] = [];
  private readonly byImage = new Map<Phaser.GameObjects.Image, Tracked>();
  private lastFeet: Point | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  /** The area's props, replacing the last area's. */
  track(props: readonly SeeThroughProp[]): void {
    this.tracked = [];
    this.byImage.clear();
    this.lastFeet = null;
    for (const prop of props) {
      const [first] = prop.images;
      if (!first || !canHide(Math.max(...prop.images.map((image) => image.displayHeight)))) continue;
      const bounds = prop.images.map((image) => image.getBounds());
      const x = Math.min(...bounds.map((b) => b.x)) - BOX_SLACK;
      const y = Math.min(...bounds.map((b) => b.y)) - BOX_SLACK;
      const right = Math.max(...bounds.map((b) => b.right)) + BOX_SLACK;
      const bottom = Math.max(...bounds.map((b) => b.bottom)) + BOX_SLACK;
      const tracked: Tracked = { ...prop, box: { x, y, width: right - x, height: bottom - y }, alpha: 1, hiding: false };
      this.tracked.push(tracked);
      for (const image of prop.images) this.byImage.set(image, tracked);
    }
  }

  clear(): void {
    this.track([]);
  }

  update(feet: Point, deltaMs: number, reducedMotion: boolean): void {
    const moved = !this.lastFeet || this.lastFeet.x !== feet.x || this.lastFeet.y !== feet.y;
    this.lastFeet = { x: feet.x, y: feet.y };
    for (const prop of this.tracked) {
      const shown = prop.images[0].visible;
      if (moved || !shown) {
        prop.hiding =
          shown &&
          nearBody(prop.box, feet) &&
          hidesFarmer(prop.baseY, prop.box, feet, (x, y) => prop.images.some((image) => image.visible && this.solidAt(image, x, y)));
      }
      const target = prop.hiding ? SEE_THROUGH_ALPHA : 1;
      if (prop.alpha === target) continue;
      prop.alpha = !shown || reducedMotion ? target : fadeStep(prop.alpha, target, deltaMs);
      for (const image of prop.images) image.setAlpha(prop.alpha);
    }
  }

  /** Whether a tap at this map point should go through `image` to what is behind it. */
  passesTap(image: Phaser.GameObjects.Image, map: Point): boolean {
    const prop = this.byImage.get(image);
    return prop !== undefined && tapPassesThrough(prop.hiding, prop.baseY, map.y);
  }

  /** Wind leans are a degree or two, so the picture is read as if upright. */
  private solidAt(image: Phaser.GameObjects.Image, x: number, y: number): boolean {
    const u = (x - image.x) / image.scaleX + image.displayOriginX;
    const v = (y - image.y) / image.scaleY + image.displayOriginY;
    if (u < 0 || v < 0 || u >= image.width || v >= image.height) return false;
    const column = Math.floor(image.flipX ? image.width - 1 - u : u);
    const alpha = this.scene.textures.getPixelAlpha(column, Math.floor(v), image.texture.key, image.frame.name);
    return (alpha ?? 0) >= SOLID;
  }
}
