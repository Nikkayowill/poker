import type Phaser from "phaser";
import type { Point } from "@/lib/stackacres-td/movement";
import type { Facing } from "@/lib/stackacres/tractor";

/**
 * The tractor on the Homestead (lib/stackacres/tractor.ts): parked by the barn
 * once it is bought, and driven by the farmer. The scene owns where he is and
 * which way he faces; this only draws the machine there.
 *
 * The art is `common/tractor`: `tractor_{dir}[_driven]_{0|1}`, 64x54, anchored
 * bottom-centre. The two numbered frames are the tread, swapped while it moves.
 * The driven frames carry the farmer from the waist up, so the scene hides his
 * own sprite while he drives.
 */

/** Beside the barn, on the grass right of its hay bales. Bottom-centre, map pixels. */
export const TRACTOR_PARKING: Point = { x: 752, y: 332 };
const PARKED_FACING: Facing = "left";
const TREAD_MS = 140;

export class TractorRig {
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private owned = false;
  private at: Point = { ...TRACTOR_PARKING };
  private facing: Facing = PARKED_FACING;
  private tread = 0;
  private treadAt = 0;
  /** Whether the farmer is up on it. */
  driving = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
  ) {}

  /** Bought or not. An unbought tractor is not drawn at all. */
  setOwned(owned: boolean, area: string): void {
    if (owned === this.owned) return;
    this.owned = owned;
    this.build(area);
  }

  /** Draws it for the area just entered. Only the Homestead has one. */
  build(area: string): void {
    if (this.sprite?.active) this.sprite.destroy();
    this.sprite = null;
    if (!this.owned || area !== "homestead" || !this.scene.textures.exists("tractor")) return;
    this.sprite = this.keep(this.scene.add.sprite(this.at.x, this.at.y, "tractor", this.frame(false)).setOrigin(0.5, 1).setDepth(this.at.y));
  }

  /** Climbs on: the tractor is wherever the farmer now stands. Returns where he should stand. */
  mount(): { at: Point; facing: Facing } {
    this.driving = true;
    return { at: { ...this.at }, facing: this.facing };
  }

  /** Climbs off: it stays parked where it was driven to, facing the same way. */
  dismount(): void {
    this.driving = false;
    this.draw(false);
  }

  /** He left the Homestead some other way than driving (the map sheet): it goes back by the barn. */
  sendHome(): void {
    this.driving = false;
    this.at = { ...TRACTOR_PARKING };
    this.facing = PARKED_FACING;
  }

  /** Each frame while he drives: follow him, face his way, run the tread while moving. */
  update(time: number, at: Point, facing: Facing, moving: boolean): void {
    if (!this.driving) return;
    this.at = { ...at };
    this.facing = facing;
    if (moving && time - this.treadAt >= TREAD_MS) {
      this.tread = 1 - this.tread;
      this.treadAt = time;
    }
    this.draw(true);
  }

  /** Whether a tap at this map point lands on it. */
  hit(map: Point): boolean {
    return this.sprite !== null && this.sprite.visible && this.sprite.getBounds().contains(map.x, map.y);
  }

  /** Where the farmer walks to climb on, and what he faces when he gets there. */
  approach(): { anchor: Point; face: Point } {
    return { anchor: { x: this.at.x, y: this.at.y + 6 }, face: { x: this.at.x, y: this.at.y - 12 } };
  }

  /** Whether it is on the map being looked at. */
  get drawn(): boolean {
    return this.sprite !== null;
  }

  get position(): Point {
    return { ...this.at };
  }

  private draw(driven: boolean): void {
    if (!this.sprite) return;
    this.sprite.setPosition(this.at.x, this.at.y).setDepth(this.at.y).setFrame(this.frame(driven));
  }

  private frame(driven: boolean): string {
    return `tractor_${this.facing}${driven ? "_driven" : ""}_${this.tread}`;
  }
}
