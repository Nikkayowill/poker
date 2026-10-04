import type Phaser from "phaser";
import { advance, findPath, type Grid, type Point } from "@/lib/stackacres-td/movement";

/**
 * Earl, the hired hand (lib/stackacres/hired-hand.ts), on the Homestead.
 *
 * The server has already done the work by the time he moves: each chores pass
 * answers with the beds he watered and picked, and this walks him to each one
 * in turn and acts it out. Nothing here waits on him or changes what the farm
 * holds. Between jobs he waits by the barn.
 *
 * The art is `characters/earl`, the same rig as the farmer and Ray, so its tags
 * are `walk_{dir}`, `water_{dir}`, `harvest_{dir}` and `idle_{dir}`.
 */

export type HandJobKind = "water" | "harvest";

type Dir = "down" | "up" | "left" | "right";

/** By the barn, left of where the tractor parks. Bottom-centre, map pixels. */
export const HAND_HOME: Point = { x: 716, y: 344 };
const SPEED = 46;
const WORK_MS = 1_100;
/** Beds still to visit. Older ones are dropped past this: the farm already shows them done. */
const MAX_QUEUE = 8;
/** He stands this far below the bed he works, so he is not drawn on top of the crop. */
const STAND_BELOW = 10;

export class HandRig {
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private shadow: Phaser.GameObjects.Ellipse | null = null;
  private hired = false;
  private at: Point = { ...HAND_HOME };
  private path: Point[] = [];
  private dir: Dir = "down";
  private jobs: { at: Point; kind: HandJobKind }[] = [];
  private working: { kind: HandJobKind; until: number } | null = null;
  /** What he does once the path he is on runs out. */
  private pending: HandJobKind | null = null;
  private goingHome = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
  ) {}

  setHired(hired: boolean, area: string): void {
    if (hired === this.hired) return;
    this.hired = hired;
    if (!hired) this.reset();
    this.build(area);
  }

  /** Draws him for the area just entered. Only the Homestead has him. */
  build(area: string): void {
    if (this.sprite?.active) this.sprite.destroy();
    if (this.shadow?.active) this.shadow.destroy();
    this.sprite = null;
    this.shadow = null;
    if (!this.hired || area !== "homestead" || !this.scene.textures.exists("earl")) return;
    const sprite = this.keep(this.scene.add.sprite(this.at.x, this.at.y, "earl").setOrigin(0.5, 44 / 48).setDepth(this.at.y));
    this.scene.anims.createFromAseprite("earl", undefined, sprite);
    this.sprite = sprite;
    this.shadow = this.keep(this.scene.add.ellipse(this.at.x + 1, this.at.y + 1, 13, 4, 0x140c1c, 0.28).setDepth(-1));
    this.play(this.working ? `${this.working.kind}_${this.dir}` : this.path.length > 0 ? `walk_${this.dir}` : `idle_${this.dir}`);
  }

  /** The beds a pass just worked, in the order he should walk them. */
  queue(jobs: { at: Point; kind: HandJobKind }[]): void {
    if (!this.hired) return;
    this.jobs = [...this.jobs, ...jobs.map((job) => ({ at: { x: job.at.x, y: job.at.y + STAND_BELOW }, kind: job.kind }))].slice(-MAX_QUEUE);
    this.goingHome = false;
  }

  /** Each frame on the Homestead. */
  update(time: number, delta: number, grid: Grid, reducedMotion: boolean): void {
    if (!this.sprite || !this.hired) return;
    if (this.working) {
      if (time < this.working.until) return;
      this.working = null;
    }
    if (this.path.length === 0) {
      const next = this.jobs.shift();
      if (next) {
        if (reducedMotion) {
          this.place(next.at);
          this.work(time, next.kind);
          return;
        }
        this.path = findPath(grid, this.at, next.at);
        this.pending = next.kind;
        if (this.path.length === 0) {
          this.pending = null;
          return;
        }
      } else if (!this.goingHome && Math.hypot(this.at.x - HAND_HOME.x, this.at.y - HAND_HOME.y) > 2) {
        this.goingHome = true;
        this.path = reducedMotion ? [] : findPath(grid, this.at, HAND_HOME);
        if (this.path.length === 0) {
          this.place(HAND_HOME);
          this.play("idle_down");
        }
        return;
      } else {
        return;
      }
    }

    const step = advance(this.at, this.path, (SPEED * Math.min(delta, 100)) / 1000);
    this.face(step.at.x - this.at.x, step.at.y - this.at.y);
    this.place(step.at);
    this.path = step.path;
    if (this.path.length > 0) {
      this.play(`walk_${this.dir}`);
      return;
    }
    if (this.pending) {
      this.work(time, this.pending);
      this.pending = null;
    } else {
      this.goingHome = false;
      this.dir = "down";
      this.play("idle_down");
    }
  }

  /** Whether he is on the map being looked at. */
  get drawn(): boolean {
    return this.sprite !== null;
  }

  get position(): Point {
    return { ...this.at };
  }

  /** Walking to a bed, working one, or with beds still to visit. */
  get busy(): boolean {
    return this.working !== null || this.pending !== null || this.jobs.length > 0;
  }

  private work(time: number, kind: HandJobKind): void {
    this.dir = "up";
    this.working = { kind, until: time + WORK_MS };
    this.play(`${kind}_${this.dir}`);
  }

  private reset(): void {
    this.at = { ...HAND_HOME };
    this.path = [];
    this.jobs = [];
    this.working = null;
    this.pending = null;
    this.goingHome = false;
    this.dir = "down";
  }

  private place(at: Point): void {
    this.at = { ...at };
    this.sprite?.setPosition(at.x, at.y).setDepth(at.y);
    this.shadow?.setPosition(at.x + 1, at.y + 1);
  }

  private face(dx: number, dy: number): void {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  }

  private play(key: string): void {
    if (!this.sprite || this.sprite.anims.currentAnim?.key === key) return;
    this.sprite.play({ key, repeat: -1 });
  }
}
