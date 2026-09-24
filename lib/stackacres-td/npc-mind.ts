/**
 * What a person on the farm notices and does from moment to moment, on top of where their day has them.
 *
 * npc-routine.ts says where someone should be at any hour. Played back to the letter that reads as a
 * machine: they turn on the spot the instant you come near, stare at you forever, walk straight through
 * you and each other, go from standing to full pace in one frame, and start a chore the frame they
 * arrive. This is the layer that makes them read as people:
 *
 * - They take a moment to react (a fifth to half a second, by temperament) and then hold a look; the
 *   head doesn't flick back and forth when the farmer stands on a diagonal.
 * - They give the farmer their attention for a few seconds, get back to what they were doing, and
 *   glance over now and then while he stays.
 * - They turn toward where they are going before they set off, speed up and slow down instead of
 *   snapping to pace, and stand a beat when they arrive before starting the chore.
 * - They keep a little personal space, stepping round the farmer and each other, and stop to let him
 *   pass if he is stood in their way.
 * - A quiet moment turns into a look around; a long chore gets a breather; nobody's rhythm is even.
 * - While the farmer talks to them they stop and face him, then hurry to catch up with their day.
 *
 * None of it ever moves their day. Stopping only puts them behind the clock (`lag`), and they catch up
 * by playing their own day back a little faster along the same paths, so nobody can get stuck and
 * nobody ever cuts through a wall to catch up. Sidesteps are a few pixels, only onto open ground, and
 * ease back to nothing.
 *
 * Pure, so it is tested without Phaser (npc-mind.test.ts): time and chance come in from outside.
 */

import type { Point } from "./movement";
import type { Dir, Pose } from "./npc-routine";

export interface Temperament {
  /** How long before they react to something, in ms: [quickest, slowest]. */
  react: [number, number];
  /** How long they give the farmer their full attention before getting back to it, in ms. */
  attention: [number, number];
  /** How long a quiet moment lasts before they look around, in ms. */
  fidget: [number, number];
  /** 0 to 1: how keen they are to stop for a word with someone nearby. */
  chatty: number;
  /** Their own speed of breathing and working, as a multiple of the sheet's timing. */
  tempo: number;
}

export type Anim = "walk" | "idle" | "water" | "harvest" | "chop" | "fish";

export interface Other extends Point {
  name: string;
}

export interface Frame {
  /** Real ms, any origin. */
  now: number;
  /** Real ms since the last frame. */
  dt: number;
  night: boolean;
  /** Where their day had them `lagMs` of real time ago. */
  scheduled: (lagMs: number) => Pose;
  /** The farmer, when he is on the same map. */
  farmer: (Point & { walking: boolean }) | null;
  /** The farmer is talking to this person. */
  talking: boolean;
  /** Everyone else on this map, where they are shown. */
  others: Other[];
  /** Whether a point on this map is open ground. */
  open: (p: Point) => boolean;
}

export interface Look extends Point {
  area: string;
  facing: Dir;
  anim: Anim;
  /** Walking: how fast they cover the ground, in map px per real second, so the feet match it. */
  walkSpeed: number;
  /** Anything but walking: how fast the animation plays, as a multiple of the sheet's timing. */
  animRate: number;
  /** They greet the farmer with an emote this frame. */
  says: "greet" | null;
}

/** How far the farmer is when they first notice him, in map px. */
export const NOTICE_REACH = 72;
/** How close before they greet him with an emote. */
export const GREET_REACH = 40;
const GREET_COOLDOWN_MS = 90_000;
/** Catching up with their day after a long stop, as a multiple of its pace. */
export const CATCH_UP = 1.8;
/** Behind by this much or more, they hurry at CATCH_UP; less, proportionally less, down to a brisk step. */
const HURRY_FROM_MS = 3000;
const BRISK = 1.15;
/** From standing to their own walking pace. */
const RAMP_MS = 280;
/** The furthest behind their day a conversation can hold them before they have to get on. */
export const MAX_LAG_MS = 45_000;
/** Personal space, feet to feet, in map px. */
const SPACE_FROM_FARMER = 14;
const SPACE_FROM_PERSON = 12;
/** The biggest step aside anyone takes. */
export const MAX_SIDESTEP = 12;
/** How far ahead they look for someone in their way while walking. */
const LOOK_AHEAD = 28;
const YIELD_REACH = 22;
const YIELD_COOLDOWN_MS = 5000;

const VECTORS: Record<Dir, Point> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/**
 * The way to face something at (dx, dy). Near a diagonal they keep facing the way they already are, so
 * a farmer stood at 45 degrees doesn't make them flick between two directions every frame.
 */
export function facingToward(dx: number, dy: number, current: Dir): Dir {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if ((current === "left" && dx < 0) || (current === "right" && dx > 0)) {
    if (ax * 1.35 >= ay) return current;
  } else if ((current === "up" && dy < 0) || (current === "down" && dy > 0)) {
    if (ay * 1.35 >= ax) return current;
  }
  if (ax > ay) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

export class Mind {
  /** Real ms behind their day. */
  private lag = 0;
  /** How fast their day is playing for them: 0 stopped, 1 on time, CATCH_UP hurrying. */
  private rate = 1;
  private offset: Point = { x: 0, y: 0 };
  private prev: Pose | null = null;
  private facing: Dir = "down";
  /** Last frame they were turned toward something they were watching (the farmer, someone they talk to). */
  private tracking = false;
  private pending: { dir: Dir; at: number } | null = null;

  private holdUntil = 0;
  private holdFace: Dir | null = null;
  private settleUntil = 0;
  private yieldedAt = Number.NEGATIVE_INFINITY;

  private noticeAt: number | null = null;
  private attentionUntil = 0;
  private closest = Infinity;
  private glanceUntil = 0;
  private nextGlanceAt = 0;
  private greetedAt = Number.NEGATIVE_INFINITY;

  private beat: { facing: Dir | null; anim: Anim | null; until: number } | null = null;
  private nextBeatAt = 0;
  private chat: { with: string; until: number } | null = null;

  constructor(
    private readonly temper: Temperament,
    private readonly random: () => number,
  ) {}

  /** Out of sight: nothing they were in the middle of carries over to when they are next seen. */
  reset(): void {
    this.lag = 0;
    this.rate = 1;
    this.offset = { x: 0, y: 0 };
    this.prev = null;
    this.tracking = false;
    this.pending = null;
    this.holdUntil = 0;
    this.holdFace = null;
    this.settleUntil = 0;
    this.noticeAt = null;
    this.beat = null;
    this.chat = null;
  }

  /** How far behind their day they are, in real ms. */
  behind(): number {
    return this.lag;
  }

  /** Free for a word: stood still at their own chores, not busy with the farmer or anyone else. */
  free(now: number): boolean {
    return (
      this.prev !== null &&
      this.prev.doing !== "walk" &&
      this.prev.doing !== "fish" &&
      this.lag === 0 &&
      this.chat === null &&
      now >= this.holdUntil &&
      now >= this.settleUntil &&
      (this.noticeAt === null || now >= this.attentionUntil)
    );
  }

  chatty(): number {
    return this.temper.chatty;
  }

  /** Turn to someone for a few words. They let go of whatever quiet beat they were in. */
  startChat(partner: string, until: number): void {
    this.chat = { with: partner, until };
    this.beat = null;
  }

  /** The pause before the next swing of a can or pull at a plant: never the same twice. */
  choreRest(): number {
    return 250 + this.random() * 650;
  }

  private between([low, high]: [number, number]): number {
    return low + this.random() * (high - low);
  }

  step(f: Frame): Look {
    const { now, dt } = f;
    const holding = f.talking || now < this.holdUntil;

    // How their day plays for them: stopped while held, hurrying while behind, easing between.
    // A breath before setting off leaves them a moment behind, made up with a brisker step, not a sprint.
    const hurry = Math.max(BRISK, 1 + (CATCH_UP - 1) * Math.min(1, this.lag / HURRY_FROM_MS));
    const target = holding ? (this.lag >= MAX_LAG_MS ? 1 : 0) : this.lag > 0 ? hurry : 1;
    this.rate = approach(this.rate, target, dt / RAMP_MS);
    this.lag = Math.max(0, this.lag + dt * (1 - this.rate));
    if (this.lag === 0 && this.rate > 1) this.rate = 1;
    const pose = f.scheduled(this.lag);

    const prev = this.prev;
    if (!prev) this.nextBeatAt = now + this.between(this.temper.fidget);
    if (prev && prev.area === pose.area) {
      if (prev.doing !== "walk" && pose.doing === "walk" && !holding && this.lag < 1000) {
        // Setting off: turn the way they are going and take a breath first. They were stood still, so
        // stopping their day here shows no jump. Not when they are hurrying to catch up.
        this.rate = 0;
        this.holdUntil = now + this.between(this.temper.react);
        this.holdFace = pose.facing;
      } else if (prev.doing === "walk" && pose.doing !== "walk") {
        // Arriving: stand a beat, then get to it.
        this.settleUntil = now + 300 + this.random() * 400;
        this.beat = null;
      }
    }
    if (prev && prev.area !== pose.area) {
      this.offset = { x: 0, y: 0 };
      this.chat = null;
    }

    const moving = pose.doing === "walk" && pose.speed * this.rate > 1;
    const heading = moving ? this.heading(f, pose) : VECTORS[pose.facing];
    const here = { x: pose.x + this.offset.x, y: pose.y + this.offset.y };

    // The farmer: noticed after a moment, watched for a while, then glanced at now and then.
    const farmer = f.farmer;
    const toFarmer = farmer ? { x: farmer.x - here.x, y: farmer.y - here.y } : null;
    const farmerDist = toFarmer ? Math.hypot(toFarmer.x, toFarmer.y) : Infinity;
    if (farmerDist < NOTICE_REACH) {
      if (this.noticeAt === null) {
        this.noticeAt = now + this.between(this.temper.react);
        this.attentionUntil = this.noticeAt + this.between(this.temper.attention) * (f.night ? 0.5 : 1);
        this.nextGlanceAt = this.attentionUntil + this.between(this.temper.fidget);
        this.closest = farmerDist;
      } else if (farmerDist < this.closest - 16) {
        // Coming right up to them is worth another look.
        this.closest = farmerDist;
        this.attentionUntil = Math.max(this.attentionUntil, now + this.between(this.temper.attention) * 0.6);
      }
    } else if (farmerDist > NOTICE_REACH + 12) {
      this.noticeAt = null;
    }
    const aware = this.noticeAt !== null && now >= this.noticeAt;

    let says: Look["says"] = null;
    if (aware && farmerDist < GREET_REACH && !f.talking && now - this.greetedAt > GREET_COOLDOWN_MS) {
      this.greetedAt = now;
      says = "greet";
    }

    let watching = f.talking;
    if (!watching && aware && !moving) {
      if (now < this.attentionUntil) watching = true;
      else {
        if (now >= this.nextGlanceAt) {
          this.glanceUntil = now + 900 + this.random() * 700;
          this.nextGlanceAt = this.glanceUntil + this.between(this.temper.fidget);
        }
        watching = now < this.glanceUntil;
      }
    }

    // Someone stood in the way: stop and let them be, then step round.
    if (moving && farmer && toFarmer && !farmer.walking && !holding && now - this.yieldedAt > YIELD_COOLDOWN_MS) {
      const ahead = toFarmer.x * heading.x + toFarmer.y * heading.y;
      if (farmerDist < YIELD_REACH && ahead > farmerDist * 0.6) {
        this.yieldedAt = now;
        this.holdUntil = now + 450 + this.random() * 400;
        this.holdFace = facingToward(toFarmer.x, toFarmer.y, pose.facing);
      }
    }

    this.steer(f, pose, here, heading, moving);

    if (this.chat && (moving || f.talking || now >= this.chat.until || !f.others.some((o) => o.name === this.chat!.with))) this.chat = null;

    // A quiet moment: look around, catch a breath.
    const idleNow = !moving && !watching && !holding && !this.chat && now >= this.settleUntil;
    if (this.beat && (now >= this.beat.until || !idleNow)) this.beat = null;
    if (idleNow && !this.beat && now >= this.nextBeatAt) {
      // At night they are too sleepy to look about.
      this.beat = f.night ? null : this.quietBeat(f, pose, here);
      this.nextBeatAt = (this.beat?.until ?? now) + this.between(this.temper.fidget);
    }

    let facing: Dir;
    let anim: Anim;
    let tracking = false;
    if (moving) {
      facing = pose.facing;
      anim = "walk";
    } else if (watching && toFarmer) {
      facing = this.watch(toFarmer.x, toFarmer.y, now);
      anim = "idle";
      tracking = true;
    } else if (holding) {
      facing = this.holdFace ?? this.facing;
      anim = "idle";
    } else if (now < this.settleUntil) {
      facing = pose.doing === "walk" ? this.facing : pose.facing;
      anim = "idle";
    } else if (this.chat) {
      const partner = f.others.find((o) => o.name === this.chat!.with)!;
      facing = this.watch(partner.x - here.x, partner.y - here.y, now);
      anim = "idle";
      tracking = true;
    } else if (this.beat) {
      facing = this.beat.facing ?? pose.facing;
      anim = this.beat.anim ?? (pose.doing === "walk" ? "idle" : pose.doing);
    } else if (pose.doing === "walk") {
      // Their day has them walking but they are stood still: turned the way they are going.
      facing = pose.facing;
      anim = "idle";
    } else {
      facing = pose.facing;
      anim = pose.doing;
    }
    this.tracking = tracking;
    if (!tracking) this.pending = null;
    this.facing = facing;
    this.prev = pose;

    const tempo = this.temper.tempo * (f.night ? 0.75 : 1);
    return {
      area: pose.area,
      x: pose.x + this.offset.x,
      y: pose.y + this.offset.y,
      facing,
      anim,
      walkSpeed: anim === "walk" ? pose.speed * this.rate : 0,
      animRate: anim === "idle" ? tempo : tempo * Math.max(1, this.rate),
      says,
    };
  }

  /** Where they are really heading: a moment further along their own walk. Four-way facing is too coarse
   *  for noticing someone in the way on a diagonal. */
  private heading(f: Frame, pose: Pose): Point {
    // 150 ms further on their day than they are shown: past the clock when they are on time.
    const ahead = f.scheduled(this.lag - 150);
    const dx = ahead.x - pose.x;
    const dy = ahead.y - pose.y;
    const length = Math.hypot(dx, dy);
    return length > 0.01 && ahead.area === pose.area ? { x: dx / length, y: dy / length } : VECTORS[pose.facing];
  }

  /** Turning to keep watching something: at once when they first look, then only once a new direction has
   *  held for a moment, so a passing farmer is followed with the eyes, not flicked at. */
  private watch(dx: number, dy: number, now: number): Dir {
    const want = facingToward(dx, dy, this.facing);
    if (!this.tracking) {
      this.pending = null;
      return want;
    }
    if (want === this.facing) {
      this.pending = null;
      return want;
    }
    if (!this.pending || this.pending.dir !== want) this.pending = { dir: want, at: now + this.between(this.temper.react) * 0.6 };
    return now >= this.pending.at ? want : this.facing;
  }

  private quietBeat(f: Frame, pose: Pose, here: Point): { facing: Dir | null; anim: Anim | null; until: number } | null {
    const roll = this.random();
    const now = f.now;
    if (pose.doing === "idle") {
      if (roll < 0.25) {
        const near = f.others
          .map((o) => ({ o, d: Math.hypot(o.x - here.x, o.y - here.y) }))
          .filter(({ d }) => d < 110)
          .sort((a, b) => a.d - b.d)[0];
        if (near) return { facing: facingToward(near.o.x - here.x, near.o.y - here.y, pose.facing), anim: "idle", until: now + 1200 + this.random() * 900 };
      }
      if (roll < 0.7) {
        // Facing sideways, a look round is mostly out toward the player, sometimes back over the shoulder.
        const turned = this.random();
        const side: Dir =
          VECTORS[pose.facing].x === 0 ? (turned < 0.5 ? "left" : "right") : turned < 0.6 ? "down" : pose.facing === "left" ? "right" : "left";
        return { facing: side, anim: "idle", until: now + 700 + this.random() * 900 };
      }
      return null;
    }
    if (pose.doing === "fish") {
      return roll < 0.2 ? { facing: VECTORS[pose.facing].x === 0 ? "left" : "down", anim: "idle", until: now + 800 + this.random() * 600 } : null;
    }
    // A long chore: straighten up and catch a breath.
    return roll < 0.35 ? { facing: null, anim: "idle", until: now + 1200 + this.random() * 1000 } : null;
  }

  /** A few pixels aside from anyone too close, and round someone in the way before bumping into them. */
  private steer(f: Frame, pose: Pose, here: Point, heading: Point, moving: boolean): void {
    let px = 0;
    let py = 0;
    const away = (from: Point, space: number, share: number) => {
      const dx = here.x - from.x;
      const dy = here.y - from.y;
      const d = Math.hypot(dx, dy);
      if (d >= space) return;
      // Right on top of each other: step to the side of the way they face.
      const ux = d > 0.5 ? dx / d : -heading.y;
      const uy = d > 0.5 ? dy / d : heading.x;
      px += ux * (space - d) * share;
      py += uy * (space - d) * share;
    };
    const around = (from: Point) => {
      const dx = from.x - here.x;
      const dy = from.y - here.y;
      const ahead = dx * heading.x + dy * heading.y;
      const side = dx * -heading.y + dy * heading.x;
      if (ahead <= 0 || ahead > LOOK_AHEAD || Math.abs(side) >= 10) return;
      const sign = side > 0 ? -1 : 1;
      const push = (10 - Math.abs(side)) * 0.5;
      px += -heading.y * sign * push;
      py += heading.x * sign * push;
    };
    if (f.farmer) {
      away(f.farmer, SPACE_FROM_FARMER, 1);
      if (moving) around(f.farmer);
    }
    for (const other of f.others) {
      away(other, SPACE_FROM_PERSON, 0.5);
      if (moving) around(other);
    }

    let next: Point;
    if (px !== 0 || py !== 0) {
      const k = Math.min(1, f.dt / 120);
      next = { x: this.offset.x + px * k, y: this.offset.y + py * k };
    } else {
      const k = Math.max(0, 1 - f.dt / 500);
      next = { x: this.offset.x * k, y: this.offset.y * k };
      if (Math.hypot(next.x, next.y) < 0.05) next = { x: 0, y: 0 };
    }
    const length = Math.hypot(next.x, next.y);
    if (length > MAX_SIDESTEP) next = { x: (next.x / length) * MAX_SIDESTEP, y: (next.y / length) * MAX_SIDESTEP };
    // Only ever onto open ground; otherwise as far as it is open, or back on their own path.
    for (const scale of [1, 0.5, 0]) {
      const candidate = { x: next.x * scale, y: next.y * scale };
      if (scale === 0 || f.open({ x: pose.x + candidate.x, y: pose.y + candidate.y })) {
        this.offset = candidate;
        break;
      }
    }
  }
}

/**
 * Who stops for a word with whom this moment: two people free, on the same map, a few steps apart, and not
 * together too recently. At most one new conversation a call; chance keeps it from happening like
 * clockwork. `lastTalked` is keyed by the pair's names in order, "a|b", and is updated here.
 */
export function pickChat(
  people: { name: string; x: number; y: number; mind: Mind }[],
  now: number,
  lastTalked: Map<string, number>,
  random: () => number,
): { a: string; b: string; until: number } | null {
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      if (!a.mind.free(now) || !b.mind.free(now)) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 56) continue;
      const key = [a.name, b.name].sort().join("|");
      if (now - (lastTalked.get(key) ?? Number.NEGATIVE_INFINITY) < 25_000) continue;
      if (random() > ((a.mind.chatty() + b.mind.chatty()) / 2) * 0.35) continue;
      lastTalked.set(key, now);
      return { a: a.name, b: b.name, until: now + 2500 + random() * 2000 };
    }
  }
  return null;
}
