import Phaser from "phaser";
import type { Grid, Point } from "@/lib/stackacres-td/movement";
import { Mind, NOTICE_REACH, GREET_REACH, pickChat, facingToward, type Other } from "@/lib/stackacres-td/npc-mind";
import {
  areaMapOf,
  daySeed,
  planDay,
  poseOn,
  type AreaMap,
  type AreaSpecForRoutines,
  type DayPlan,
  type Dir,
  type Pose,
} from "@/lib/stackacres-td/npc-routine";
import { NPC_ROUTINES, NPC_STATIONS, NPC_TEMPERAMENTS } from "@/lib/stackacres-td/npc-schedules";

/** The NPC sheets' four-frame walk was timed for this pace. */
const WALK_TIMED_FOR = 40;
/** How often two people who happen to be near each other think about stopping for a word. */
const CHAT_CHECK_MS = 1000;
const GREET_COOLDOWN_MS = 90_000;
/** Talking holds someone only while the farmer stays with them. */
const TALK_REACH = 48;

export interface WalkerNode {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
}

export interface FarmerView extends Point {
  walking: boolean;
}

export type Says = "greet" | "chat";

/** Whether someone keeps a routine, and so is placed by the clock rather than by area.json. */
export function keepsRoutine(name: string): boolean {
  return Object.hasOwn(NPC_ROUTINES, name);
}

/**
 * The people on the farm going about their day (lib/stackacres-td/npc-schedules.ts), each with a mind of
 * their own on top of it (lib/stackacres-td/npc-mind.ts). Every frame each one is put where their day
 * has them, walking, fishing, watering or picking, as their mind plays it: noticing the farmer, looking
 * about, stepping out of the way, stopping for a word. Someone whose day has taken them to another area
 * (Ray at his barn counter, or home in town) is hidden here and seen there.
 *
 * Each day is that day's own variation on the routine, seeded by the farm's day number, so it is the
 * same on every device and different from yesterday.
 */
export class NpcWalkers {
  private plans = new Map<string, DayPlan>();
  private minds = new Map<string, Mind>();
  private keys = new Map<string, string>();
  private hooked = new WeakSet<Phaser.GameObjects.Sprite>();
  private live: { area: string; grid: Grid } | null = null;
  private msPerHour = 3_600_000;
  private varied = true;
  /** Real ms per hour of the clock their day is read from: the farm's own, or a pinned dev clock's. */
  private clockMsPerHour: number | null = null;
  private stale = true;
  private lastTalked = new Map<string, number>();
  private nextChatCheck = 0;
  private talk: { name: string; at: Point; until: number } | null = null;
  private greetedAt = new Map<string, number>();

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

  /** A pinned dev clock, ticking at `realMsPerHour`, or null for the farm clock. Pinned, every day is the
   *  routine to the letter, so a preview or an e2e spec finds everyone where the schedule says, and a
   *  pause is measured on the pinned clock so it never rewinds anyone along their walk. */
  setPinnedClock(realMsPerHour: number | null): void {
    this.clockMsPerHour = realMsPerHour;
    if (this.varied === (realMsPerHour === null)) return;
    this.varied = realMsPerHour === null;
    this.stale = true;
  }

  /** On entering an area: everyone is placed afresh, not walked in from where they stood on the last map. */
  clear(): void {
    for (const mind of this.minds.values()) mind.reset();
    this.keys.clear();
    this.talk = null;
  }

  /** The farmer has started talking to someone (or has tapped them and is walking over): they stop for
   *  him while he stays with them, up to a limit, then hurry to catch up with their day. */
  talkTo(name: string, farmer: Point, now: number): void {
    if (keepsRoutine(name)) this.talk = { name, at: { ...farmer }, until: now + 45_000 };
  }

  /** Where someone is and what they are doing on `day` at `hour`, or null when they keep no routine. */
  pose(name: string, day: number, hour: number, reducedMotion: boolean): Pose | null {
    if (!keepsRoutine(name)) return null;
    return this.scheduled(name, day * 24 + hour, reducedMotion);
  }

  /** Their day at an absolute game time (game hours since day 0). */
  private scheduled(name: string, gameHours: number, reducedMotion: boolean): Pose {
    return poseOn((day) => this.plan(name, day), gameHours, reducedMotion);
  }

  private plan(name: string, day: number): DayPlan {
    if (this.stale) {
      this.stale = false;
      this.plans.clear();
    }
    const key = `${name}:${day}`;
    let plan = this.plans.get(key);
    if (!plan) {
      const areas: Record<string, AreaMap> = {};
      for (const [area, spec] of this.specs) areas[area] = areaMapOf(spec);
      if (this.live && areas[this.live.area]) areas[this.live.area] = { ...areas[this.live.area], grid: this.live.grid };
      plan = planDay(NPC_ROUTINES[name], NPC_STATIONS, areas, this.msPerHour, this.varied ? daySeed(name, day) : undefined);
      this.plans.set(key, plan);
      // Today and yesterday are all anyone needs; the oldest go first.
      while (this.plans.size > this.names().length * 3) this.plans.delete(this.plans.keys().next().value!);
    }
    return plan;
  }

  private mind(name: string): Mind {
    let mind = this.minds.get(name);
    if (!mind) {
      mind = new Mind(NPC_TEMPERAMENTS[name], Math.random);
      this.minds.set(name, mind);
    }
    return mind;
  }

  private open(area: string, p: Point): boolean {
    if (!this.live || this.live.area !== area) return true;
    const { grid } = this.live;
    const tx = Math.floor(p.x / grid.tile);
    const ty = Math.floor(p.y / grid.tile);
    return tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height && !grid.blocked.has(`${tx},${ty}`);
  }

  update(
    now: number,
    delta: number,
    day: number,
    hour: number,
    area: string,
    farmer: FarmerView,
    nodes: Map<string, WalkerNode>,
    allowed: (name: string) => boolean,
    reducedMotion: boolean,
    /** Someone the farmer has tapped and is walking over to: they wait for him. */
    waitingFor: string | null,
    say: (name: string, what: Says) => void,
  ): void {
    const dt = Math.min(delta, 100);
    const gameHours = day * 24 + hour;
    const night = hour >= 22 || hour < 5;

    if (this.talk && (now > this.talk.until || (farmer.walking && Math.hypot(farmer.x - this.talk.at.x, farmer.y - this.talk.at.y) > TALK_REACH))) {
      this.talk = null;
    }

    const shown: { name: string; x: number; y: number; mind: Mind }[] = [];
    for (const name of this.names()) {
      const node = nodes.get(name);
      if (!node) continue;
      const mind = this.mind(name);
      const at = (lagMs: number) => this.scheduled(name, gameHours - lagMs / (this.clockMsPerHour ?? this.msPerHour), reducedMotion);
      const here = at(mind.behind()).area === area && allowed(name);
      node.sprite.setVisible(here);
      node.shadow.setVisible(here);
      if (!here) {
        mind.reset();
        this.keys.delete(name);
        continue;
      }

      if (reducedMotion) {
        // Standing at their station, only turning to the farmer when he is close: nothing walks.
        const pose = at(0);
        const dx = farmer.x - pose.x;
        const dy = farmer.y - pose.y;
        const near = Math.hypot(dx, dy) < NOTICE_REACH;
        const facing = near ? facingToward(dx, dy, pose.facing) : pose.facing;
        this.place(node, pose.x, pose.y);
        if (node.sprite.anims.isPlaying) node.sprite.anims.stop();
        if (node.sprite.frame.name !== this.standing[facing]) node.sprite.setFrame(this.standing[facing]);
        this.keys.delete(name);
        if (Math.hypot(dx, dy) < GREET_REACH && now - (this.greetedAt.get(name) ?? Number.NEGATIVE_INFINITY) > GREET_COOLDOWN_MS) {
          this.greetedAt.set(name, now);
          say(name, "greet");
        }
        continue;
      }

      const others: Other[] = [];
      for (const [other, otherNode] of nodes) {
        if (other !== name && otherNode.sprite.visible) others.push({ name: other, x: otherNode.sprite.x, y: otherNode.sprite.y });
      }
      const look = mind.step({
        now,
        dt,
        night,
        scheduled: at,
        farmer,
        talking: this.talk?.name === name || waitingFor === name,
        others,
        open: (p) => this.open(area, p),
      });
      // Catching up can carry them through a door this very frame: they are on the other map now.
      if (look.area !== area) {
        node.sprite.setVisible(false);
        node.shadow.setVisible(false);
        mind.reset();
        this.keys.delete(name);
        continue;
      }
      this.place(node, look.x, look.y);
      shown.push({ name, x: look.x, y: look.y, mind });
      if (look.says) say(name, look.says);

      const key = `${look.anim}_${look.facing}`;
      const timeScale = look.anim === "walk" ? look.walkSpeed / WALK_TIMED_FOR : look.animRate;
      const chore = look.anim !== "walk" && look.anim !== "idle";
      if (!this.hooked.has(node.sprite)) {
        this.hooked.add(node.sprite);
        // Nobody works like a metronome: a fresh pause before every swing of the can or pull at a plant.
        node.sprite.on(Phaser.Animations.Events.ANIMATION_REPEAT, (anim: Phaser.Animations.Animation) => {
          if (!anim.key.startsWith("walk_") && !anim.key.startsWith("idle_")) node.sprite.anims.repeatDelay = this.mind(name).choreRest();
        });
      }
      if (key !== this.keys.get(name) || !node.sprite.anims.isPlaying) {
        node.sprite.play({
          key,
          repeat: -1,
          repeatDelay: chore ? mind.choreRest() : 0,
          timeScale,
          // Breathing out of step with everyone else.
          startFrame: look.anim === "idle" ? Math.floor(Math.random() * 3) : 0,
        });
        this.keys.set(name, key);
      } else {
        node.sprite.anims.timeScale = timeScale;
      }
    }

    if (!reducedMotion && !night && now >= this.nextChatCheck) {
      this.nextChatCheck = now + CHAT_CHECK_MS;
      const chat = pickChat(shown, now, this.lastTalked, Math.random);
      if (chat) {
        this.mind(chat.a).startChat(chat.b, chat.until);
        this.mind(chat.b).startChat(chat.a, chat.until);
        // Half the time one of them says something you can see; the rest is just the turn to each other.
        if (Math.random() < 0.5) say(Math.random() < 0.5 ? chat.a : chat.b, "chat");
      }
    }
  }

  private place(node: WalkerNode, x: number, y: number): void {
    const rx = Math.round(x);
    const ry = Math.round(y);
    node.sprite.setPosition(rx, ry).setDepth(ry);
    node.shadow.setPosition(rx + 1, ry + 1);
  }
}
