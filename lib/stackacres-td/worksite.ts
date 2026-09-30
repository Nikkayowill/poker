/**
 * A grocery market and the staff who run it, all working off one bulletin board.
 *
 * The store (work-store.ts) posts what needs doing: a display running low, a customer at the produce
 * counter, a customer at a till. Each member of staff takes the notes their job covers (work-crew.ts) and
 * goes back to their post when there's nothing to do. This owns the clock and steps them all in order: the
 * store and its customers, then the staff.
 *
 * The layout comes off the room itself: the grocery's area.json carries a zone on every square someone
 * works or shops from (art/stackacres-td/rich/lpc_rooms.py `grocery`), and `marketLayout` reads them. Nothing
 * here reads the wall clock or Math.random: time only moves through `step`, and the randomness is seeded,
 * so the same day plays out the same on any device, or on the server. It holds no Gold.
 *
 * Pure, tested without Phaser (worksite.test.ts).
 */

import { mulberry32 } from "@/lib/seeded-random";
import { tileKey, type Grid } from "./movement";
import type { Dir } from "./npc-routine";
import { Board, Crowd, faceToward, gridRouter, keyOf, sameTile, type Job, type Router, type Task, type Tile, type WalkerView } from "./work-board";
import { DEFAULT_PROFILE, Worker, type Plan, type WorkerProfile } from "./work-crew";
import {
  GroceryMarket,
  type CustomerView,
  type DisplayLayout,
  type DisplayView,
  type MarketLayout,
  type QueueKind,
  type Spot,
  type Station,
  type StoreEvent,
  type StoreTuning,
} from "./work-store";

export interface WorksiteTuning extends StoreTuning {
  /** A member of staff's walking pace. The farmer walks a 16px tile in about 220ms. */
  msPerTile: number;
  /** A break, from worn out to rested. */
  restMs: number;
}

export const WORKSITE_TUNING: WorksiteTuning = {
  msPerTile: 300,
  restMs: 20_000,
  perSpot: 3,
  restockAt: 0.5,
  crate: 8,
  fetchMs: 1400,
  stockMs: 1600,
  delivery: 320,
  deliveries: [7, 13],
  takeOrderMs: 600,
  pickMs: 900,
  handMs: 700,
  checkoutMs: 900,
  scanMs: 450,
  payMs: 900,
  browseMs: 1800,
  takeMs: 500,
  customerEvery: [4000, 8000],
  maxCustomers: 48,
  shelfWaitMs: 5000,
  patience: [30_000, 50_000],
  customerMsPerTile: 380,
  opens: 7,
  closes: 21,
  rushLift: 8,
};

export type WorksiteEvent = StoreEvent;

/** A worker as a view sees them: the walker, plus their job and how much they have left in them. */
export interface WorkerView extends WalkerView {
  job: Job;
  energy: number;
  onBreak: boolean;
}

export interface WorksiteView {
  workers: WorkerView[];
  customers: CustomerView[];
  displays: DisplayView[];
  stockroom: number;
  /** The store's standing with its customers, 0 to 100. */
  reputation: number;
  open: boolean;
  notes: Task[];
}

/** The part of an area.json this reads. */
export interface MarketArea {
  width: number;
  height: number;
  tile: number;
  blocked: [number, number][];
  props: { blocks: [number, number][] }[];
  zones: { tag: string; x: number; y: number; w: number; h: number }[];
}

/** The area's walk grid: its walls, and what its furniture stands on. */
export function marketGrid(area: MarketArea): Grid {
  const blocked = new Set<string>();
  for (const [tx, ty] of area.blocked) blocked.add(tileKey(tx, ty));
  for (const prop of area.props) for (const [tx, ty] of prop.blocks) blocked.add(tileKey(tx, ty));
  return { width: area.width, height: area.height, tile: area.tile, blocked };
}

const manhattan = (a: Tile, b: Tile) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);

/**
 * The market's layout off its area's zones. Every square faces what it's in front of: the shelf, the
 * counter, the till, or (in a queue) the person ahead.
 */
export function marketLayout(area: MarketArea): MarketLayout {
  const grid = marketGrid(area);
  const byTag = new Map<string, Tile[]>();
  for (const z of area.zones) {
    const t = { tx: Math.floor(z.x / area.tile), ty: Math.floor(z.y / area.tile) };
    byTag.set(z.tag, [...(byTag.get(z.tag) ?? []), t]);
  }
  const one = (tag: string): Tile => {
    const t = byTag.get(tag)?.[0];
    if (!t) throw new Error(`The market has no ${tag} square`);
    return t;
  };
  // Facing whatever solid thing is beside the square, the one above first.
  const facingSolid = (t: Tile, fallback: Dir = "up"): Dir => {
    const solid = (dx: number, dy: number) => grid.blocked.has(tileKey(t.tx + dx, t.ty + dy));
    if (solid(0, -1)) return "up";
    if (solid(0, 1)) return "down";
    if (solid(-1, 0)) return "left";
    if (solid(1, 0)) return "right";
    return fallback;
  };
  const spot = (t: Tile, facing?: Dir): Spot => ({ ...t, facing: facing ?? facingSolid(t) });
  // A queue behind `front`: each next-nearest square in turn, each facing the one ahead.
  const behind = (tiles: Tile[], front: Tile): Spot[] => {
    const left = [...tiles];
    const out: Spot[] = [];
    let ahead = front;
    while (left.length > 0) {
      left.sort((a, b) => manhattan(a, ahead) - manhattan(b, ahead));
      const next = left.shift()!;
      out.push({ ...next, facing: faceToward(next, ahead, "up") });
      ahead = next;
    }
    return out;
  };

  const displays: DisplayLayout[] = [];
  for (const [tag, tiles] of byTag) {
    const [kind, name] = tag.split(":");
    if (kind === "shelf") displays.push({ id: name, kind: "shelf", spots: tiles.map((t) => spot(t)) });
    if (kind === "produce" && name.startsWith("table-")) displays.push({ id: name, kind: "produce", spots: tiles.map((t) => spot(t)) });
  }
  // A till or a place at the produce counter: the clerk and the customer face each other across it, and
  // the station's own queue (if it has one) runs back from the customer's square.
  const station = (n: number, kind: "till" | "produce", front: "pay" | "order"): Station => {
    const c = one(`${kind}:${n}:clerk`);
    const f = one(`${kind}:${n}:${front}`);
    const at = { ...f, facing: faceToward(f, c, "up") };
    return { clerk: { ...c, facing: faceToward(c, f, "up") }, front: at, line: behind(byTag.get(`${kind}:${n}:line`) ?? [], at) };
  };
  const numbered = (kind: string) =>
    [...byTag.keys()]
      .map((tag) => new RegExp(`^${kind}:(\\d+):clerk$`).exec(tag))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  // A queue the stations share: its front is the square nearest a counter, facing it.
  const shared = (tag: string, stations: Station[]): Spot[] => {
    const tiles = byTag.get(tag) ?? [];
    if (tiles.length === 0) return [];
    const near = (t: Tile) => Math.min(...stations.map((st) => manhattan(st.front, t)));
    const head = [...tiles].sort((a, b) => near(a) - near(b))[0];
    const toward = [...stations].sort((a, b) => manhattan(a.front, head) - manhattan(b.front, head))[0].front;
    return [{ ...head, facing: faceToward(head, toward, "up") }, ...behind(tiles.filter((t) => !sameTile(t, head)), head)];
  };
  const tills = numbered("till").map((n) => station(n, "till", "pay"));
  const counters = numbered("produce").map((n) => station(n, "produce", "order"));
  // "door" squares are both ways; "door:in" and "door:out" only one.
  const doorway = (tag: string) => [...(byTag.get("door") ?? []), ...(byTag.get(tag) ?? [])].map((t) => spot(t, "up"));
  const entrances = doorway("door:in");
  const exits = doorway("door:out");
  if (entrances.length === 0 || exits.length === 0) throw new Error("The market has no way in or no way out");
  const breakTile = byTag.get("break")?.[0];
  return {
    displays: displays.sort((a, b) => a.id.localeCompare(b.id)),
    stockroom: spot(one("stockroom"), "up"),
    counters,
    produceLine: shared("produce:line", counters),
    tills,
    tillLine: shared("till:line", tills),
    entrances,
    exits,
    staffOnly: byTag.get("staff") ?? [],
    breakSpot: breakTile ? spot(breakTile, "down") : null,
  };
}

/** Where each member of staff works from. */
export type Post = { at: "till"; till: number } | { at: "produce"; counter: number } | { at: "stockroom" };

export class Worksite {
  readonly board = new Board();
  readonly store: GroceryMarket;
  private readonly workers: { worker: Worker; post: Post }[] = [];
  private readonly route: Router;
  /** How staff get about: never down a checkout lane, where they'd meet the queue head on. */
  private readonly staffRoute: Router;
  private readonly tuning: WorksiteTuning;
  private readonly random: () => number;
  private events: WorksiteEvent[] = [];
  private now = 0;

  constructor(
    readonly layout: MarketLayout,
    route: Router | Grid,
    options: {
      seed: number;
      customerSprites: readonly string[];
      tuning?: WorksiteTuning;
      /** The hour of the day (0 to 24) at a given site time, for opening hours, deliveries and the rush; none means always open. */
      hourAt?: (now: number) => number;
    },
  ) {
    if (layout.tills.length === 0 || layout.displays.length === 0) throw new Error("A market needs a till and something to sell");
    const tuning = (this.tuning = options.tuning ?? WORKSITE_TUNING);
    const site = (this.route = typeof route === "function" ? route : gridRouter(route));
    const lanes = new Set(layout.tills.filter((t) => t.line.length > 0).flatMap((t) => [...t.line, t.front].map(keyOf)));
    this.staffRoute =
      lanes.size === 0 ? site : (from, to, avoid) => (lanes.has(keyOf(to)) ? null : site(from, to, avoid ? new Set([...avoid, ...lanes]) : lanes));
    this.random = mulberry32(options.seed);
    this.store = new GroceryMarket(
      layout,
      tuning,
      (event) => {
        this.events.push(event);
      },
      this.random,
      options.customerSprites,
      options.hourAt ?? null,
    );
  }

  private postSpot(post: Post): Spot {
    if (post.at === "till") return this.layout.tills[post.till].clerk;
    if (post.at === "produce") return this.layout.counters[post.counter].clerk;
    // A stocker waits just out from the stockroom doors, each on their own square along the front of them.
    const already = this.workers.filter((w) => w.post.at === "stockroom").length;
    return { ...this.layout.stockroom, tx: this.layout.stockroom.tx + already, ty: this.layout.stockroom.ty + 1, facing: "up" };
  }

  /**
   * Take someone on at a post. `sprite` is their character sheet; `profile` how fast and how long they work,
   * and their traits. They start at their post; their first look at the board is staggered from the last hire's.
   */
  hire(name: string, job: Job, sprite: string, post: Post, profile: WorkerProfile = DEFAULT_PROFILE): void {
    if (this.workers.some(({ worker }) => worker.name === name)) throw new Error(`${name} is already on the staff`);
    const at = this.postSpot(post);
    const start = this.workers.some(({ worker }) => sameTile(worker.walker.tile, at)) ? { tx: at.tx, ty: at.ty + 1 } : at;
    // A cashier serves their own till and a produce clerk their own place at the counter; covering another
    // is a manager's call, not theirs.
    const mine =
      post.at === "till"
        ? (task: Task) => task.kind !== "checkout" || task.key === `checkout:${post.till}`
        : post.at === "produce"
          ? (task: Task) => task.kind !== "serve" || task.key === `serve:${post.counter}`
          : undefined;
    this.workers.push({ worker: new Worker(name, job, sprite, start, this.now + (this.workers.length % 4) * 125, profile, at, mine), post });
  }

  /** Tills with a cashier on duty, and places at the produce counter with a clerk on duty. */
  private openStations(): Record<QueueKind, number[]> {
    const till = new Set<number>();
    const produce = new Set<number>();
    for (const { worker, post } of this.workers) {
      if (worker.onBreak) continue;
      if (post.at === "till" && worker.job === "cashier") till.add(post.till);
      if (post.at === "produce" && worker.job === "produce") produce.add(post.counter);
    }
    const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);
    return { till: sorted(till), produce: sorted(produce) };
  }

  /** Move the site on by `dt` ms. Returns what happened, oldest first. */
  step(dt: number): WorksiteEvent[] {
    this.now += dt;
    const staff = this.workers.map(({ worker }) => worker);
    this.store.tick(this.board, this.now, dt, this.route, new Crowd([...staff.map((w) => w.walker), ...this.store.walkers()]), this.openStations());
    const planner = (task: Task, worker: Worker): Plan | null => this.store.plan(task, worker, this.route);
    // Rebuilt after the store's turn: people came in and left.
    const everyone = new Crowd([...staff.map((w) => w.walker), ...this.store.walkers()]);
    for (const worker of staff) {
      // A brisk colleague wears everyone else out a fifth faster.
      const wear = staff.some((w) => w !== worker && w.has("brisk")) ? 1.2 : 1;
      worker.step(this.now, dt, {
        board: this.board,
        route: this.staffRoute,
        planner,
        crowd: everyone,
        msPerTile: this.tuning.msPerTile,
        wear,
        breakSpot: this.layout.breakSpot,
        restMs: this.tuning.restMs,
        random: this.random,
      });
    }
    const happened = this.events;
    this.events = [];
    return happened;
  }

  view(): WorksiteView {
    return {
      workers: this.workers.map(({ worker }) => ({ ...worker.view(), job: worker.job, energy: worker.energy, onBreak: worker.onBreak })),
      customers: this.store.view(this.now),
      displays: this.store.displayView(),
      stockroom: this.store.stockroom,
      reputation: this.store.reputation,
      open: this.store.isOpen(this.now),
      notes: this.board.all(),
    };
  }
}
