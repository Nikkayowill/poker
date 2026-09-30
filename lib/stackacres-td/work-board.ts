/**
 * The bulletin board a shop's staff work from, and how everyone in the shop walks the grid.
 *
 * Nobody tells a worker what to do. Things that need doing post a note: an empty shelf, a customer at the
 * produce counter, a customer at the till. Each note is keyed by the thing it is about, so a shelf can't
 * post its restock twice. A worker whose job covers that kind of note claims it, walks to it, does it, and
 * tears it up.
 *
 * Walking is one tile at a time over the same 16px walk grid the farmer uses. A walker's `tile` changes
 * the moment they set off for the next square, so the grid always knows who is heading where, and the
 * sprite tweens across the square behind it. People take up room: nobody steps onto a square someone else
 * stands on or is stepping off. Held up, a walker waits a moment, then finds a way round, and if that
 * fails for long enough steps aside to let the other pass. Waiting for the square they're headed to (a
 * place in a queue, a shelf someone's browsing) they just wait their turn.
 *
 * Pure, tested without Phaser (worksite.test.ts).
 */

import { tilePath, type Grid } from "./movement";
import type { Dir } from "./npc-routine";

export interface Tile {
  tx: number;
  ty: number;
}

export type TaskKind = "restock" | "serve" | "checkout";

/** The stocker fills shelves from the stockroom, the produce clerk serves at the produce counter, cashiers work the tills. */
export type Job = "stocker" | "produce" | "cashier";

/** Which notes each job will take off the board. */
export const JOB_TASKS: Record<Job, readonly TaskKind[]> = {
  stocker: ["restock"],
  produce: ["serve"],
  cashier: ["checkout"],
};

/** Higher goes first. A customer waiting to be served beats a shelf running low. */
export const PRIORITY: Record<TaskKind, number> = { checkout: 3, serve: 3, restock: 2 };

/**
 * What someone is doing, which is what the view animates: walking, walking with a crate in their arms,
 * standing, reaching out (stocking a shelf, picking produce, taking something off a shelf), handing
 * something over (produce across the counter, money at the till), ringing items through, sitting on a
 * break, and throwing up their hands on the way out of a shop that let them down.
 */
export type Act = "walk" | "carry" | "idle" | "reach" | "give" | "scan" | "sit" | "despair";

export interface Task {
  id: number;
  kind: TaskKind;
  /** What the note is about ("restock:dairy", "checkout:1"). One note per key. */
  key: string;
  /** Where the job starts. */
  at: Tile;
  postedAt: number;
  claimedBy: string | null;
}

export function keyOf(t: Tile): string {
  return `${t.tx},${t.ty}`;
}

/**
 * The tiles from one square to another, start left out, or null when there is no way there. `avoid` are
 * squares to walk round this time (other people); the destination itself is never avoided.
 */
export type Router = (from: Tile, to: Tile, avoid?: ReadonlySet<string>) => Tile[] | null;

/**
 * The grid's walls plus the squares to keep off, apart from the goal, read without copying either: routing
 * only ever asks whether a square is blocked, and a crowd asks for a lot of routes.
 */
class Avoiding extends Set<string> {
  constructor(
    private readonly walls: ReadonlySet<string>,
    private readonly avoid: ReadonlySet<string>,
    private readonly goal: string,
  ) {
    super();
  }

  override has(key: string): boolean {
    return this.walls.has(key) || (key !== this.goal && this.avoid.has(key));
  }
}

export function gridRouter(grid: Grid): Router {
  return (from, to, avoid) => {
    const g = avoid && avoid.size > 0 ? { ...grid, blocked: new Avoiding(grid.blocked, avoid, keyOf(to)) } : grid;
    return tilePath(g, [from.tx, from.ty], [to.tx, to.ty])?.map(([tx, ty]) => ({ tx, ty })) ?? null;
  };
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.tx === b.tx && a.ty === b.ty;
}

/** Squares apart, counting a diagonal step as one. */
export function tileDistance(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty));
}

export class Board {
  private readonly notes = new Map<string, Task>();
  private nextId = 1;

  /** Put a note up, unless one is already up for the same thing. */
  post(kind: TaskKind, key: string, at: Tile, now: number): Task {
    const up = this.notes.get(key);
    if (up) return up;
    const task: Task = { id: this.nextId++, kind, key, at, postedAt: now, claimedBy: null };
    this.notes.set(key, task);
    return task;
  }

  has(key: string): boolean {
    return this.notes.has(key);
  }

  get(key: string): Task | undefined {
    return this.notes.get(key);
  }

  /** Done, or no longer needed. */
  tear(key: string): void {
    this.notes.delete(key);
  }

  /** Put a claimed note back up for someone else. */
  release(key: string): void {
    const task = this.notes.get(key);
    if (task) task.claimedBy = null;
  }

  /** Take one particular note, if nobody has it. */
  claimKey(key: string, worker: string): Task | null {
    const task = this.notes.get(key);
    if (!task || task.claimedBy !== null) return null;
    task.claimedBy = worker;
    return task;
  }

  all(): Task[] {
    return [...this.notes.values()];
  }

  /**
   * The note a worker in `job` standing on `from` should take: the most urgent, then the nearest, then
   * the oldest, skipping any they can't walk to. It is claimed for them, along with the route there.
   * `atLeast` skips anything less urgent than that (a worker already busy only looks up for worse news).
   */
  claim(
    worker: string,
    job: Job,
    from: Tile,
    route: Router,
    atLeast = 0,
    /** Narrows it further: a cashier only takes their own till's customers. */
    mine: (task: Task) => boolean = () => true,
  ): { task: Task; path: Tile[] } | null {
    const kinds = JOB_TASKS[job];
    const open = this.all()
      .filter((task) => task.claimedBy === null && kinds.includes(task.kind) && PRIORITY[task.kind] >= atLeast && mine(task))
      .sort(
        (a, b) =>
          PRIORITY[b.kind] - PRIORITY[a.kind] || tileDistance(from, a.at) - tileDistance(from, b.at) || a.postedAt - b.postedAt || a.id - b.id,
      );
    for (const task of open) {
      const path = sameTile(from, task.at) ? [] : route(from, task.at);
      if (!path) continue;
      task.claimedBy = worker;
      return { task, path };
    }
    return null;
  }
}

/** Anyone who walks the grid: a hired hand or a customer. */
export interface Walker {
  /** The square they stand on, or the one they are stepping onto. */
  tile: Tile;
  /** The square the current step started from. Equal to `tile` when standing still. */
  from: Tile;
  path: Tile[];
  /** How long the current step takes, and how much of it is left, in ms. */
  stepMs: number;
  stepLeft: number;
  facing: Dir;
  /** How long they have stood waiting for someone to get out of the way, and whether they've tried a way round. */
  blockedMs: number;
  rerouted: boolean;
}

export function standingAt(tile: Tile, facing: Dir = "down"): Walker {
  return { tile, from: tile, path: [], stepMs: 0, stepLeft: 0, facing, blockedMs: 0, rerouted: false };
}

/** Which way someone faces to look from one square toward another, keeping `current` when there is no clear answer. */
export function faceToward(from: Tile, to: Tile, current: Dir): Dir {
  const dx = to.tx - from.tx;
  const dy = to.ty - from.ty;
  if (dx === 0 && dy === 0) return current;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "down" : "up";
  // Straight diagonal: keep whichever of the two they already face.
  const horizontal: Dir = dx > 0 ? "right" : "left";
  const vertical: Dir = dy > 0 ? "down" : "up";
  return current === vertical ? vertical : horizontal;
}

/**
 * Walk `dt` ms along the path at `msPerTile` a square (diagonals take longer). Returns true once they
 * stand on the last square. Leftover time carries into the next step, so a slow frame never stalls them.
 * A square `canEnter` refuses is not stepped onto: they stand and the wait is counted in `blockedMs`.
 */
export function stepWalk(walker: Walker, dt: number, msPerTile: number, canEnter?: (t: Tile) => boolean): boolean {
  let left = dt;
  for (;;) {
    if (walker.stepLeft > 0) {
      const used = Math.min(left, walker.stepLeft);
      walker.stepLeft -= used;
      left -= used;
      if (walker.stepLeft > 0) return false;
    }
    const next = walker.path[0];
    if (!next) {
      walker.from = walker.tile;
      walker.blockedMs = 0;
      walker.rerouted = false;
      return true;
    }
    if (canEnter && !canEnter(next)) {
      walker.from = walker.tile;
      walker.blockedMs += left;
      return false;
    }
    walker.path.shift();
    walker.blockedMs = 0;
    walker.rerouted = false;
    const diagonal = next.tx !== walker.tile.tx && next.ty !== walker.tile.ty;
    walker.facing = faceToward(walker.tile, next, walker.facing);
    walker.from = walker.tile;
    walker.tile = next;
    walker.stepMs = diagonal ? msPerTile * Math.SQRT2 : msPerTile;
    walker.stepLeft = walker.stepMs;
    if (left <= 0) return false;
  }
}

/** Held up this long, a walker looks for a way round. */
export const REROUTE_AFTER_MS = 600;
/** Held up this long, still on the way somewhere else, a walker steps aside to let the other pass. */
export const SIDESTEP_AFTER_MS = 2400;

/** Where everyone on a worksite is, so nobody walks into anybody. Built afresh each step. */
export class Crowd {
  private readonly walkers: readonly Walker[];

  constructor(walkers: readonly Walker[]) {
    this.walkers = walkers;
  }

  /** The squares taken by everyone but `self`: where each stands, and the one they're stepping off. */
  taken(self: Walker): Set<string> {
    const out = new Set<string>();
    for (const w of this.walkers) {
      if (w === self) continue;
      out.add(keyOf(w.tile));
      if (w.stepLeft > 0) out.add(keyOf(w.from));
    }
    return out;
  }

  /** Anyone standing held up with `t` as their next step. */
  waitingOn(t: Tile, self: Walker): Walker[] {
    return this.walkers.filter((w) => w !== self && w.stepLeft === 0 && w.blockedMs > 0 && w.path[0] !== undefined && sameTile(w.path[0], t));
  }

  /** Someone standing on `self`'s next square who wants `self`'s square next: the two are face to face. */
  headOn(self: Walker): Walker | undefined {
    const next = self.path[0];
    if (!next) return undefined;
    return this.walkers.find((w) => w !== self && w.stepLeft === 0 && sameTile(w.tile, next) && w.path[0] !== undefined && sameTile(w.path[0], self.tile));
  }

  isTaken(t: Tile, self: Walker): boolean {
    const k = keyOf(t);
    return this.walkers.some((w) => w !== self && (keyOf(w.tile) === k || (w.stepLeft > 0 && keyOf(w.from) === k)));
  }
}

/** Held up this long by someone coming the other way, two people squeeze past each other. */
export const SQUEEZE_AFTER_MS = 500;

/** Take the next step on the path now, without asking whether the square is free. */
function stepOnto(walker: Walker, msPerTile: number): void {
  const next = walker.path.shift();
  if (!next) return;
  const diagonal = next.tx !== walker.tile.tx && next.ty !== walker.tile.ty;
  walker.facing = faceToward(walker.tile, next, walker.facing);
  walker.from = walker.tile;
  walker.tile = next;
  walker.stepMs = diagonal ? msPerTile * Math.SQRT2 : msPerTile;
  walker.stepLeft = walker.stepMs;
  walker.blockedMs = 0;
  walker.rerouted = false;
}

/**
 * Walk on toward `goal` among other people. Returns true on arrival. Held up by someone, wait; face to face
 * with someone who wants this square, squeeze past them; after a moment try a way round; after longer, if
 * the square in the way isn't the goal itself, step to any free square beside them and carry on from there.
 */
export function walkAmong(walker: Walker, goal: Tile, dt: number, msPerTile: number, crowd: Crowd, route: Router): boolean {
  if (stepWalk(walker, dt, msPerTile, (t) => !crowd.isTaken(t, walker))) return true;
  if (walker.stepLeft > 0 || walker.blockedMs === 0) return false;
  const inTheWay = walker.path[0];
  // Face to face in a gap one square wide, neither can go round: they squeeze past, trading squares in
  // one step so they never stand on the same one.
  const facing = walker.blockedMs >= SQUEEZE_AFTER_MS ? crowd.headOn(walker) : undefined;
  if (facing) {
    stepOnto(walker, msPerTile);
    stepOnto(facing, msPerTile);
    return false;
  }
  const waitingForGoal = inTheWay !== undefined && sameTile(inTheWay, goal);
  if (!walker.rerouted && walker.blockedMs >= REROUTE_AFTER_MS) {
    walker.rerouted = true;
    const round = route(walker.tile, goal, crowd.taken(walker));
    if (round && round.length > 0 && !(inTheWay && sameTile(round[0], inTheWay))) walker.path = round;
    return false;
  }
  if (!waitingForGoal && walker.blockedMs >= SIDESTEP_AFTER_MS) {
    const taken = crowd.taken(walker);
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const side = { tx: walker.tile.tx + dx, ty: walker.tile.ty + dy };
      if (taken.has(keyOf(side))) continue;
      const step = route(walker.tile, side);
      if (!step || step.length !== 1) continue;
      // Only aside to somewhere they can go on from, or the step aside would count as arriving.
      const onward = route(side, goal);
      if (!onward) continue;
      walker.path = [side, ...onward];
      walker.blockedMs = 0;
      walker.rerouted = false;
      break;
    }
  }
  return false;
}

/**
 * Someone standing about (idle, or resting) who is in another's way steps to a free square beside them
 * that isn't on the other's route. Returns true when they have somewhere to step to.
 */
export function makeWay(walker: Walker, crowd: Crowd, route: Router): boolean {
  if (walker.stepLeft > 0 || walker.path.length > 0) return false;
  const waiting = crowd.waitingOn(walker.tile, walker);
  if (waiting.length === 0) return false;
  const theirWay = new Set(waiting.flatMap((w) => w.path.map(keyOf)));
  const taken = crowd.taken(walker);
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const side = { tx: walker.tile.tx + dx, ty: walker.tile.ty + dy };
    const k = keyOf(side);
    if (taken.has(k) || theirWay.has(k)) continue;
    const step = route(walker.tile, side);
    if (!step || step.length !== 1) continue;
    walker.path = [side];
    return true;
  }
  return false;
}

/** What a view needs to draw someone: where they are, where they came from, and what they are doing. */
export interface WalkerView {
  id: string;
  sprite: string;
  tile: Tile;
  from: Tile;
  stepMs: number;
  stepLeft: number;
  facing: Dir;
  doing: Act;
  /** Goods in their arms (a worker) or their basket (a customer). */
  carrying: number;
}
