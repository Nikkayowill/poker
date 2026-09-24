import type Phaser from "phaser";
import type { Grid, Point } from "@/lib/stackacres-td/movement";
import { areaMapOf, planDay, poseAt, restAt, type AreaMap, type AreaSpecForRoutines, type DayPlan, type Dir, type Pose } from "@/lib/stackacres-td/npc-routine";
import { NPC_ROUTINES, NPC_STATIONS } from "@/lib/stackacres-td/npc-schedules";

/** How close the farmer comes before someone on their rounds, at a stationary chore, turns to face
 *  him instead of the chore's own facing. Only while stationary: someone mid-walk keeps walking,
 *  since freezing a moving body on the farmer's approach is what used to lock them in place for good
 *  when he never stepped away again -- their day must always keep moving underneath. */
const GREET_REACH = 48;
/** How fast someone catches back up with their day after stopping to talk, as a multiple of their pace. */
const CATCH_UP = 2;
/** Further behind than this (in map px), they are simply where their day says. */
const SNAP_GAP = 160;
/** The NPC sheets' four-frame walk was timed for this pace. */
const WALK_TIMED_FOR = 40;
/** A pause between two swings of a watering can or two pulls at a plant, so a chore reads as work, not a twitch. */
const CHORE_REST_MS = 450;

export interface WalkerNode {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
}

interface Walker {
  at: Point;
  shown: boolean;
  key: string;
}

/** Whether someone keeps a routine, and so is placed by the clock rather than by area.json. */
export function keepsRoutine(name: string): boolean {
  return Object.hasOwn(NPC_ROUTINES, name);
}

/**
 * The people on the farm going about their day (lib/stackacres-td/npc-schedules.ts): every frame each
 * one is put where the clock says, walking, fishing, watering or picking. Someone whose day has taken
 * them to another area (Ray at his barn counter, or home in town) is hidden here and seen there.
 *
 * Position is always the schedule's, every frame -- nothing here ever stops it, so nobody can get
 * stuck. When the farmer stands close while someone is at a stationary chore, they turn to face him;
 * it's a cosmetic override on top of wherever the chore already has them.
 */
export class NpcWalkers {
  private plans = new Map<string, DayPlan>();
  private walkers = new Map<string, Walker>();
  private live: { area: string; grid: Grid } | null = null;
  private msPerHour = 3_600_000;
  private stale = true;

  constructor(
    private readonly specs: Map<string, AreaSpecForRoutines>,
    private readonly standing: Record<Dir, string>,
  ) {}

  names(): string[] {
    return Object.keys(NPC_ROUTINES);
  }

  /** The walk grid of the area the farmer is in, with his fences and whatever stands today. */
  setLiveGrid(area: string, grid: Grid): void {
    this.live = { area, grid };
    this.stale = true;
  }

  /** How long a game hour lasts in real ms. */
  setHourLength(ms: number): void {
    if (ms === this.msPerHour) return;
    this.msPerHour = ms;
    this.stale = true;
  }

  /** On entering an area: everyone is placed afresh, not walked in from where they stood on the last map. */
  clear(): void {
    this.walkers.clear();
  }

  /** Where someone is and what they are doing at `hour`, or null when they keep no routine. */
  pose(name: string, hour: number, reducedMotion: boolean): Pose | null {
    this.replan();
    const plan = this.plans.get(name);
    if (!plan) return null;
    return reducedMotion ? restAt(plan, hour) : poseAt(plan, hour);
  }

  private replan(): void {
    if (!this.stale) return;
    this.stale = false;
    const areas: Record<string, AreaMap> = {};
    for (const [name, spec] of this.specs) areas[name] = areaMapOf(spec);
    if (this.live && areas[this.live.area]) areas[this.live.area] = { ...areas[this.live.area], grid: this.live.grid };
    this.plans.clear();
    for (const [name, routine] of Object.entries(NPC_ROUTINES)) this.plans.set(name, planDay(routine, NPC_STATIONS, areas, this.msPerHour));
  }

  update(
    delta: number,
    hour: number,
    area: string,
    farmer: Point,
    nodes: Map<string, WalkerNode>,
    allowed: (name: string) => boolean,
    reducedMotion: boolean,
  ): void {
    for (const name of this.names()) {
      const node = nodes.get(name);
      const pose = this.pose(name, hour, reducedMotion);
      if (!node || !pose) continue;
      const here = pose.area === area && allowed(name);
      let walker = this.walkers.get(name);
      if (!walker) {
        walker = { at: { x: pose.x, y: pose.y }, shown: false, key: "" };
        this.walkers.set(name, walker);
      }
      node.sprite.setVisible(here);
      node.shadow.setVisible(here);
      if (!here) {
        walker.shown = false;
        continue;
      }
      if (!walker.shown) walker.at = { x: pose.x, y: pose.y };
      walker.shown = true;

      // Position always tracks the schedule, every frame -- nothing here ever pins it in place, so a
      // farmer who happens to be standing nearby can never freeze someone's day.
      let facing: Dir = pose.facing;
      let key: string;
      let timeScale = 1;
      const gapX = pose.x - walker.at.x;
      const gapY = pose.y - walker.at.y;
      const gap = Math.hypot(gapX, gapY);
      const speed = NPC_ROUTINES[name].speed;
      const step = (speed * CATCH_UP * Math.min(delta, 100)) / 1000;
      if (gap > SNAP_GAP || reducedMotion || gap <= Math.max(step, 0.5)) {
        walker.at = { x: pose.x, y: pose.y };
        key = pose.doing === "walk" ? `walk_${facing}` : `${pose.doing}_${facing}`;
        timeScale = speed / WALK_TIMED_FOR;
      } else {
        // Behind after stopping to talk: hurrying straight to where their day has got to.
        walker.at = { x: walker.at.x + (gapX / gap) * step, y: walker.at.y + (gapY / gap) * step };
        facing = Math.abs(gapX) > Math.abs(gapY) ? (gapX > 0 ? "right" : "left") : gapY > 0 ? "down" : "up";
        key = `walk_${facing}`;
        timeScale = (speed * CATCH_UP) / WALK_TIMED_FOR;
      }

      // At a stationary chore, the farmer standing close turns their head and pauses the chore's
      // motion to face him, purely cosmetic -- it never touches walker.at, so the moment the chore
      // ends they carry on exactly on schedule.
      if (pose.doing !== "walk" && gap <= Math.max(step, 0.5)) {
        const dx = farmer.x - walker.at.x;
        const dy = farmer.y - walker.at.y;
        if (Math.hypot(dx, dy) < GREET_REACH) {
          facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
          key = `idle_${facing}`;
        }
      }

      const x = Math.round(walker.at.x);
      const y = Math.round(walker.at.y);
      node.sprite.setPosition(x, y).setDepth(y);
      node.shadow.setPosition(x + 1, y + 1);
      if (reducedMotion) {
        if (node.sprite.anims.isPlaying) node.sprite.anims.stop();
        if (node.sprite.frame.name !== this.standing[facing]) node.sprite.setFrame(this.standing[facing]);
        walker.key = "";
        continue;
      }
      if (key !== walker.key || !node.sprite.anims.isPlaying) {
        const chore = !key.startsWith("walk_") && !key.startsWith("idle_");
        node.sprite.play({ key, repeat: -1, repeatDelay: chore ? CHORE_REST_MS : 0, timeScale });
        walker.key = key;
      } else {
        node.sprite.anims.timeScale = timeScale;
      }
    }
  }
}
