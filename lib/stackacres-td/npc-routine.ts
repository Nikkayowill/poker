/**
 * Where a person on the farm is at any moment of the day, worked out from the clock.
 *
 * Chef RPG's approach (devlog #7): every character follows a list of timed activities, each tied to a
 * spot on the map (a shopkeeper's counter, a bed), and the game knows where everyone is even when the
 * player can't see them. Stardew does the same with timed schedule entries and a route over the doors
 * between maps.
 *
 * Here a routine is a list of steps ("at 7:00 go to the greenhouse"). Each step names a station: one or
 * more spots in one area, each with a chore to act out there. At a step's hour the person walks from
 * wherever they were to the station's first spot, through doors when the station is in another area,
 * then loops round the station's spots until the next step.
 *
 * Nothing is simulated frame by frame and nothing is saved. A person's position is a pure function of
 * the hour (and the day, when the caller seeds one), so entering an area mid-walk finds them mid-walk, on
 * every device, with no server. The plan for a day is built once from the walk grids and cached by the caller.
 *
 * A seeded day is never quite the same as the last: each step starts a little early or late, the spots
 * at a station are visited in a shuffled order for shuffled lengths of time, and the walking pace drifts
 * a touch, slower at dawn and dusk. Real people keep a routine without keeping a timetable.
 *
 * Pure, tested without Phaser (npc-routine.test.ts).
 */

import { findPath, type Grid, type Point } from "./movement";

export type Dir = "down" | "up" | "left" | "right";

/** What a person acts out at a spot. Each is a tag on every character sheet (`water_down` and so on). */
export type Chore = "idle" | "water" | "harvest" | "chop" | "fish";

export interface Spot extends Point {
  facing: Dir;
  chore: Chore;
  /** How long they stay at this spot before moving to the next, in real ms. */
  ms: number;
}

export interface Station {
  area: string;
  spots: Spot[];
}

export interface RoutineStep {
  /** The hour (0-24, fractions allowed) they set off for the station. */
  hour: number;
  station: string;
}

export interface Routine {
  /** Walking speed in map px per real second. The farmer walks at 72. */
  speed: number;
  steps: RoutineStep[];
}

export interface AreaExit {
  to: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where someone walking through lands in `to`. */
  spawn: Point;
}

export interface AreaMap {
  grid: Grid;
  exits: AreaExit[];
}

export type Doing = "walk" | Chore;

export interface Pose extends Point {
  area: string;
  facing: Dir;
  doing: Doing;
  /** How fast they are walking right now, in map px per real second: 0 unless `doing` is "walk". */
  speed: number;
}

/** One stretch of walking inside one area. `points[0]` is where it starts. */
interface Leg {
  area: string;
  points: Point[];
  length: number;
}

type LoopPart = { kind: "work"; area: string; spot: Spot; ms: number } | { kind: "walk"; leg: Leg; ms: number };

interface StepPlan {
  station: Station;
  /** This step's walking pace, in map px per real second. */
  speed: number;
  /** Real ms after midnight of the plan's day that they set off. */
  startMs: number;
  endMs: number;
  travel: Leg[];
  travelMs: number;
  loop: LoopPart[];
  loopMs: number;
}

export interface DayPlan {
  msPerHour: number;
  /** The first step's start: the plan covers [firstMs, firstMs + one day). */
  firstMs: number;
  dayMs: number;
  steps: StepPlan[];
}

function legLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

/** A leg from `from` to `to` over the grid. When `to` can't be reached, the walk goes as near as it can
 *  and steps the rest of the way straight (a shopkeeper slipping behind a counter). */
function walkLeg(map: AreaMap, area: string, from: Point, to: Point): Leg {
  const path = findPath(map.grid, from, to);
  const last = path[path.length - 1];
  const points = [from, ...path];
  if (!last || Math.hypot(last.x - to.x, last.y - to.y) > 0.5) points.push({ x: to.x, y: to.y });
  return { area, points, length: legLength(points) };
}

/** Where someone steps through a door: the open tile inside the exit nearest its middle. An exit on a
 *  map edge is drawn a little taller than the gap in the trees, so its middle can be on a blocked tile. */
function doorPoint(map: AreaMap, exit: AreaExit): Point {
  const middle = { x: exit.x + exit.w / 2, y: exit.y + exit.h / 2 };
  const { tile, blocked, width, height } = map.grid;
  let best: Point | null = null;
  let bestDist = Infinity;
  for (let ty = Math.floor(exit.y / tile); ty <= Math.floor((exit.y + exit.h - 1) / tile); ty++) {
    for (let tx = Math.floor(exit.x / tile); tx <= Math.floor((exit.x + exit.w - 1) / tile); tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height || blocked.has(`${tx},${ty}`)) continue;
      const centre = { x: Math.min(Math.max(tx * tile + tile / 2, exit.x), exit.x + exit.w), y: Math.min(Math.max(ty * tile + tile / 2, exit.y), exit.y + exit.h) };
      const dist = Math.hypot(centre.x - middle.x, centre.y - middle.y);
      if (dist < bestDist) {
        best = centre;
        bestDist = dist;
      }
    }
  }
  return best ?? middle;
}

/** The areas to pass through from `from` to `to` over the doors between them, or null when no door leads there. */
export function areaRoute(areas: Record<string, AreaMap>, from: string, to: string): AreaExit[] | null {
  if (from === to) return [];
  const came = new Map<string, { area: string; exit: AreaExit } | null>([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head];
    for (const exit of areas[here]?.exits ?? []) {
      if (came.has(exit.to) || !areas[exit.to]) continue;
      came.set(exit.to, { area: here, exit });
      if (exit.to === to) {
        const route: AreaExit[] = [];
        for (let at: string = to; came.get(at); at = came.get(at)!.area) route.unshift(came.get(at)!.exit);
        return route;
      }
      queue.push(exit.to);
    }
  }
  return null;
}

/** The walk from a point in one area to a point in (maybe) another, through the doors between. With no door
 *  route, they simply appear at the destination, which reads better than never arriving. */
function travelLegs(areas: Record<string, AreaMap>, fromArea: string, from: Point, toArea: string, to: Point): Leg[] {
  const route = areaRoute(areas, fromArea, toArea);
  if (!route) return [];
  const legs: Leg[] = [];
  let area = fromArea;
  let at = from;
  for (const exit of route) {
    legs.push(walkLeg(areas[area], area, at, doorPoint(areas[area], exit)));
    // They come in through the doorway that leads back, not at the player's landing spot: a person
    // arriving should be seen stepping through the door, and a few exported landing spots predate
    // the current Homestead.
    const back = areas[exit.to].exits.find((door) => door.to === area);
    area = exit.to;
    at = back ? doorPoint(areas[area], back) : exit.spawn;
  }
  legs.push(walkLeg(areas[area], area, at, to));
  return legs;
}

/** A small, fast, seedable random source (mulberry32): the same seed gives the same day on every device. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed for one person's day: their name and the farm's day number, mixed (FNV-1a). */
export function daySeed(name: string, day: number): number {
  let h = 0x811c9dc5;
  for (const c of `${name}:${day}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

/** The order a station's spots are visited in, always starting at the first (where they walk in). Unseeded,
 *  round the list in order. Seeded, a longer shuffled round that never repeats a spot back to back, so a
 *  watching player can't learn the loop. */
function visitOrder(count: number, random: (() => number) | null): number[] {
  if (count <= 1 || !random) return Array.from({ length: count }, (_, i) => i);
  // Ends on a spot other than the first, so the walk back round to the first is a real walk.
  const length = count === 2 ? 6 : count * 3;
  const order = [0];
  for (let k = 1; k < length; k++) {
    const last = order[k - 1];
    const choices = Array.from({ length: count }, (_, i) => i).filter((i) => i !== last && (k < length - 1 || i !== 0));
    order.push(choices[Math.floor(random() * choices.length)]);
  }
  return order;
}

function stationLoop(areas: Record<string, AreaMap>, station: Station, speed: number, random: (() => number) | null): LoopPart[] {
  const parts: LoopPart[] = [];
  const { spots, area } = station;
  const order = visitOrder(spots.length, random);
  for (let k = 0; k < order.length; k++) {
    const spot = spots[order[k]];
    parts.push({ kind: "work", area, spot, ms: random ? spot.ms * (0.7 + random() * 0.65) : spot.ms });
    if (order.length > 1) {
      const leg = walkLeg(areas[area], area, spot, spots[order[(k + 1) % order.length]]);
      parts.push({ kind: "walk", leg, ms: (leg.length / speed) * 1000 });
    }
  }
  return parts;
}

/** People walk a little slower when the day is young and when it is getting late. */
function paceAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 8) return 0.9;
  if (h >= 19) return 0.88;
  return 1;
}

/** Each step's hour, nudged up to 20 minutes either way on a seeded day, never past a neighbouring step. */
function jitteredHours(hours: number[], random: (() => number) | null): number[] {
  if (!random) return hours;
  return hours.map((hour, i) => {
    const before = i > 0 ? hour - hours[i - 1] : hour + 24 - hours[hours.length - 1];
    const after = i + 1 < hours.length ? hours[i + 1] - hour : hours[0] + 24 - hour;
    const reach = Math.min(1 / 3, before / 4, after / 4);
    return hour + (random() * 2 - 1) * reach;
  });
}

function headingFor(dx: number, dy: number, otherwise: Dir): Dir {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return otherwise;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

function alongLeg(leg: Leg, distance: number, speed: number): Pose {
  let left = Math.max(0, distance);
  for (let i = 1; i < leg.points.length; i++) {
    const a = leg.points[i - 1];
    const b = leg.points[i];
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    const facing = headingFor(b.x - a.x, b.y - a.y, "down");
    if (left <= gap || i === leg.points.length - 1) {
      const t = gap === 0 ? 1 : Math.min(1, left / gap);
      return { area: leg.area, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, facing, doing: "walk", speed };
    }
    left -= gap;
  }
  const end = leg.points[leg.points.length - 1];
  return { area: leg.area, x: end.x, y: end.y, facing: "down", doing: "walk", speed };
}

function travelPose(legs: Leg[], distance: number, speed: number): Pose | null {
  let left = distance;
  for (const leg of legs) {
    if (left <= leg.length) return alongLeg(leg, left, speed);
    left -= leg.length;
  }
  return null;
}

function loopPose(step: StepPlan, elapsedMs: number): Pose {
  const { loop, loopMs, station } = step;
  const first = station.spots[0];
  if (loopMs <= 0) return { area: station.area, x: first.x, y: first.y, facing: first.facing, doing: first.chore, speed: 0 };
  let t = elapsedMs % loopMs;
  for (const part of loop) {
    if (t < part.ms) {
      if (part.kind === "work") return { area: part.area, x: part.spot.x, y: part.spot.y, facing: part.spot.facing, doing: part.spot.chore, speed: 0 };
      return alongLeg(part.leg, (t / part.ms) * part.leg.length, step.speed);
    }
    t -= part.ms;
  }
  return { area: station.area, x: first.x, y: first.y, facing: first.facing, doing: first.chore, speed: 0 };
}

function stepPose(step: StepPlan, ms: number): Pose {
  const elapsed = ms - step.startMs;
  if (elapsed < step.travelMs) {
    const pose = travelPose(step.travel, (elapsed / 1000) * step.speed, step.speed);
    if (pose) return pose;
  }
  return loopPose(step, elapsed - step.travelMs);
}

/**
 * Lays out one day of a routine. `msPerHour` is how long a game hour lasts in real time: an hour
 * (3,600,000) on the player's own clock, less on a faster game clock. Walks always take real time at
 * about `routine.speed`, so they look the same whatever the clock. With a `seed` (daySeed) the day is
 * that day's own variation on the routine; without one it is the routine to the letter.
 */
export function planDay(routine: Routine, stations: Record<string, Station>, areas: Record<string, AreaMap>, msPerHour: number, seed?: number): DayPlan {
  const random = seed === undefined ? null : seededRandom(seed);
  const steps = [...routine.steps].sort((a, b) => a.hour - b.hour);
  if (steps.length === 0) throw new Error("a routine needs at least one step");
  for (const step of steps) {
    const station = stations[step.station];
    if (!station) throw new Error(`no station called ${step.station}`);
    if (!areas[station.area]) throw new Error(`station ${step.station} is in an unknown area, ${station.area}`);
    if (station.spots.length === 0) throw new Error(`station ${step.station} has no spots`);
  }
  const hours = jitteredHours(steps.map((step) => step.hour), random);
  const dayMs = 24 * msPerHour;
  const firstMs = hours[0] * msPerHour;
  const plans: StepPlan[] = [];
  // The day starts where the previous day's last station begins, a fair guess for someone who has been
  // there all night, and the only one that doesn't need yesterday's plan.
  const lastStation = stations[steps[steps.length - 1].station];
  let from: Pose = { area: lastStation.area, ...lastStation.spots[0], doing: "idle", speed: 0 };
  for (let i = 0; i < steps.length; i++) {
    const station = stations[steps[i].station];
    const startMs = hours[i] * msPerHour;
    const endMs = i + 1 < steps.length ? hours[i + 1] * msPerHour : firstMs + dayMs;
    const speed = random ? routine.speed * (0.92 + random() * 0.16) * paceAt(hours[i]) : routine.speed;
    const travel = travelLegs(areas, from.area, from, station.area, station.spots[0]);
    const travelMs = (travel.reduce((sum, leg) => sum + leg.length, 0) / speed) * 1000;
    const loop = stationLoop(areas, station, speed, random);
    const plan: StepPlan = { station, speed, startMs, endMs, travel, travelMs, loop, loopMs: loop.reduce((sum, part) => sum + part.ms, 0) };
    plans.push(plan);
    from = stepPose(plan, endMs);
  }
  return { msPerHour, firstMs, dayMs, steps: plans };
}

/** Ms into the plan at `hour`. `tail` reads it as the small hours after the plan's own day, carrying on
 *  its last step, however late that runs. */
function msAt(plan: DayPlan, hour: number, tail: boolean): number {
  const ms = (((hour % 24) + 24) % 24) * plan.msPerHour;
  return tail || ms < plan.firstMs ? ms + plan.dayMs : ms;
}

function stepAt(plan: DayPlan, ms: number): StepPlan {
  let step = plan.steps[0];
  for (const candidate of plan.steps) if (candidate.startMs <= ms) step = candidate;
  return step;
}

function rest(step: StepPlan): Pose {
  const first = step.station.spots[0];
  return { area: step.station.area, x: first.x, y: first.y, facing: first.facing, doing: "idle", speed: 0 };
}

/** Where they are and what they're doing at `hour` (0-24, fractions allowed). */
export function poseAt(plan: DayPlan, hour: number): Pose {
  const ms = msAt(plan, hour, false);
  return stepPose(stepAt(plan, ms), ms);
}

/**
 * Where they are at an absolute game time (game hours since day 0), each day planned on its own
 * (`planFor`). Until a day's first step it is still the night before: the previous day's last step
 * carried on, since a seeded day can start a little later than the day before it did. `still` (reduced
 * motion) stands them at the first spot of whichever station they are keeping, so a person moves only
 * when their day moves on, never walking across the screen.
 */
export function poseOn(planFor: (day: number) => DayPlan, gameHours: number, still = false): Pose {
  const day = Math.floor(gameHours / 24);
  const hour = gameHours - day * 24;
  const today = planFor(day);
  const tail = hour * today.msPerHour < today.firstMs;
  const plan = tail ? planFor(day - 1) : today;
  const ms = msAt(plan, hour, tail);
  const step = stepAt(plan, ms);
  return still ? rest(step) : stepPose(step, ms);
}

/** Every point a routine stands on or walks to, with its area: what a test checks is open ground. */
export function routineSpots(routine: Routine, stations: Record<string, Station>): { station: string; area: string; spot: Spot }[] {
  const seen = new Set<string>();
  const out: { station: string; area: string; spot: Spot }[] = [];
  for (const step of routine.steps) {
    if (seen.has(step.station)) continue;
    seen.add(step.station);
    const station = stations[step.station];
    for (const spot of station?.spots ?? []) out.push({ station: step.station, area: station.area, spot });
  }
  return out;
}

/** The parts of an exported area.json a routine needs. */
export interface AreaSpecForRoutines {
  width: number;
  height: number;
  tile: number;
  blocked: [number, number][];
  props: { blocks?: [number, number][] }[];
  exits: AreaExit[];
}

/** An area's walk grid as exported: its blocked tiles plus every prop's footprint. The scene swaps in its
 *  live grid for the area the player is in, so a fence the player built is walked round. */
export function areaMapOf(spec: AreaSpecForRoutines): AreaMap {
  const blocked = new Set<string>(spec.blocked.map(([tx, ty]) => `${tx},${ty}`));
  for (const prop of spec.props) for (const [tx, ty] of prop.blocks ?? []) blocked.add(`${tx},${ty}`);
  return { grid: { width: spec.width, height: spec.height, tile: spec.tile, blocked }, exits: spec.exits };
}
