/**
 * A grocery market: the stock, the displays, the produce counter, the tills and their queue, and the
 * customers. Staff (work-crew.ts) do the work the store posts on the board.
 *
 * The goods come in by delivery: crates land in the stockroom behind the back doors at opening time and
 * again after lunch. A display at or below its low mark posts "restock me", and the stocker fetches a
 * crate from the stockroom and fills it.
 *
 * The shelves (packaged goods, dairy, bulk bins, bakery) are self-serve: a customer browses from a free
 * square in front and takes what they came for. The produce is not. It sits on tables in the market behind
 * the produce counter, and a customer asks for it at the counter; the produce clerk takes the order, walks
 * to the table, picks it, and hands it across.
 *
 * Customers, after Chef RPG's diners:
 *
 * - Each comes in with a short list (one to three things) and works through it, the shelves first and
 *   the produce counter last.
 * - The tills and the produce counter are stations: a clerk's square behind a counter and the customer's
 *   square in front of it. A station either has its own queue (a checkout lane: people pick the shortest
 *   open one, and move if its cashier goes on a break) or shares one queue with the others (the produce
 *   counter: the front of the queue goes to whichever clerk comes free). Only once a customer is at the
 *   counter does "need serving" go up. Each item takes a moment to ring through, then they hand the money
 *   over.
 * - Patience only runs down while they wait: held up in a crowd, at an empty shelf, in a queue, at the
 *   counter or the till. When it runs out they put everything back, throw up their hands, and walk out.
 *   Except in a checkout lane with a cashier on duty, or once it's their turn at the produce counter with
 *   a clerk on duty: then they see it through, getting crosser (and scoring the visit lower) the longer it
 *   takes. Someone giving up halfway down a lane would have nowhere to go but through the people in it.
 * - Leaving, they score the visit: how long they waited, what they couldn't get. The store's reputation is
 *   a running average of those scores, and a good one brings people in more often. So do the lunch and
 *   dinner rushes, when the site is given a clock, and nobody comes in outside opening hours.
 *
 * A sale here is a picture of a sale and pays nothing. Where Gold comes from and goes to (the takings,
 * payroll) is still open in docs/stackacres-second-map-direction.md, and the server will decide it.
 *
 * Pure, tested without Phaser (worksite.test.ts).
 */

import type { Dir } from "./npc-routine";
import {
  faceToward,
  keyOf,
  sameTile,
  standingAt,
  stepWalk,
  walkAmong,
  type Act,
  type Board,
  type Crowd,
  type Router,
  type Task,
  type Tile,
  type Walker,
  type WalkerView,
} from "./work-board";
import type { Leg, Plan, Worker } from "./work-crew";

export interface Spot extends Tile {
  facing: Dir;
}

/** Something on display: self-serve shelving, or produce the clerk picks from. */
export interface DisplayLayout {
  id: string;
  kind: "shelf" | "produce";
  /** The squares it is browsed, stocked or picked from, each facing it. */
  spots: Spot[];
}

/** A till or a place at the produce counter: where the clerk stands, and where the customer is served. */
export interface Station {
  /** Where the clerk stands, behind the counter. */
  clerk: Spot;
  /** Where the customer stands to be served, across the counter from them. */
  front: Spot;
  /** This station's own queue, the square behind `front` first. Empty where the stations share one. */
  line: Spot[];
}

export type QueueKind = "till" | "produce";

export interface MarketLayout {
  displays: DisplayLayout[];
  /** In front of the stockroom's doors, where the stocker fetches a crate. */
  stockroom: Spot;
  /** The places at the produce counter, and the queue they share, front first (empty if each has its own). */
  counters: Station[];
  produceLine: Spot[];
  /** The tills, and the queue they share, front first (empty where each till has its own lane). */
  tills: Station[];
  tillLine: Spot[];
  /** The doorway's squares people come in on, and the ones they leave by (the nearest). A shop with
   *  separate ways in and out keeps the two streams from walking into each other at the door. */
  entrances: Spot[];
  exits: Spot[];
  /** Squares customers never step on: behind the tills and the counter, the staff corner, the market floor. */
  staffOnly: Tile[];
  /** Where staff sit on their break. */
  breakSpot: Spot | null;
}

export interface StoreTuning {
  /** How much each display square holds; a display holds this times its squares. */
  perSpot: number;
  /** A display at or below this share of full asks to be restocked. */
  restockAt: number;
  /** Most a stocker carries out of the stockroom at once. */
  crate: number;
  fetchMs: number;
  stockMs: number;
  /** Goods in the stockroom at opening, and what each delivery brings. */
  delivery: number;
  /** The hours deliveries land. */
  deliveries: readonly number[];
  takeOrderMs: number;
  pickMs: number;
  handMs: number;
  /** A checkout takes this, plus `scanMs` an item, plus `payMs` for the money. */
  checkoutMs: number;
  scanMs: number;
  payMs: number;
  browseMs: number;
  takeMs: number;
  /** A new customer every [min, max] ms at an average reputation, off-peak. */
  customerEvery: readonly [number, number];
  maxCustomers: number;
  /** How long someone waits at an empty shelf for a restock before giving that item up. */
  shelfWaitMs: number;
  /** Each customer's patience for waiting, in ms, somewhere between these. */
  patience: readonly [number, number];
  customerMsPerTile: number;
  /** Open from and until these hours, when the site has a clock. */
  opens: number;
  closes: number;
  /** How much busier the lunch and dinner rushes are: people come in (1 + this) times as often at the peak. */
  rushLift: number;
}

export type Mood = "calm" | "impatient" | "cross";

export type StoreEvent =
  | { kind: "delivered"; count: number }
  | { kind: "restocked"; display: string; by: string; count: number }
  | { kind: "served"; by: string; customer: string; count: number }
  | { kind: "sold"; till: number; by: string; customer: string; count: number }
  | { kind: "walked-out"; customer: string; reason: "patience" | "empty-shelf" }
  | { kind: "visit"; customer: string; satisfaction: number; bought: number };

type CustomerState =
  | "BROWSE_WALK"
  | "BROWSE"
  | "ORDER_LINE"
  | "TO_COUNTER"
  | "ORDERED"
  | "TILL_LINE"
  | "TO_TILL"
  | "PAY"
  | "DESPAIR"
  | "LEAVE"
  | "GONE";

interface Customer {
  id: string;
  sprite: string;
  walker: Walker;
  state: CustomerState;
  /** What they came for: display ids, in the order they'll go round. */
  list: string[];
  wanted: number;
  /** Where each item in the basket came from, so it can go back. */
  basket: string[];
  missed: number;
  goal: Tile;
  /** Their place in whichever queue they're in (-1 while waiting to join): a station's own queue
   *  (`lineOf`), or the shared one (`lineOf` null). Then the station they're served at. */
  place: number;
  lineOf: number | null;
  station: number | null;
  patience: number;
  patienceLeft: number;
  since: number;
  /** A short action being played (taking an item, paying, giving up), from and until when. */
  act: Act | null;
  actFrom: number;
  actUntil: number;
}

/** A customer as a view draws them: the walker, plus how they feel. */
export interface CustomerView extends WalkerView {
  mood: Mood;
}

export interface DisplayView {
  id: string;
  kind: "shelf" | "produce";
  stock: number;
  cap: number;
}

export class GroceryMarket {
  /** Goods in the stockroom behind the back doors. */
  stockroom: number;
  readonly displays: { layout: DisplayLayout; stock: number; cap: number }[];
  /** A running average of how happy customers left, 0 to 100. Starts middling. */
  reputation = 60;
  private customers: Customer[] = [];
  /** Who stands where in each kind of queue: the shared one, each station's own, and at each station. */
  private readonly queues: Record<QueueKind, { shared: (string | null)[]; own: (string | null)[][]; serving: (string | null)[] }>;
  private nextCustomerAt: number;
  private admitted = 0;
  private readonly staffOnly: ReadonlySet<string>;
  /** Each checkout lane's squares (a till with its own queue): the queue, and the till's square. */
  private readonly lanes: { queue: string[]; pay: string }[];
  private readonly laneAt = new Map<string, number>();
  /** The site's router, and the routes built on it for each way of being placed among the lanes. */
  private siteRoute: Router = () => null;
  private routedBy: Router | null = null;
  private readonly routes = new Map<string, Router>();
  private lastDelivery = -1;
  /** Which stations have a clerk on duty, handed in by the site each step. */
  private open: Record<QueueKind, number[]> = { till: [], produce: [] };

  constructor(
    readonly layout: MarketLayout,
    private readonly tuning: StoreTuning,
    private readonly emit: (event: StoreEvent) => void,
    private readonly random: () => number,
    private readonly customerSprites: readonly string[],
    private readonly hourAt: ((now: number) => number) | null = null,
  ) {
    this.displays = layout.displays.map((d) => {
      const cap = d.spots.length * tuning.perSpot;
      return { layout: d, stock: cap, cap };
    });
    this.stockroom = tuning.delivery;
    const queue = (stations: Station[], shared: Spot[]) => ({
      shared: shared.map(() => null),
      own: stations.map((st) => st.line.map(() => null)),
      serving: stations.map(() => null),
    });
    this.queues = { till: queue(layout.tills, layout.tillLine), produce: queue(layout.counters, layout.produceLine) };
    this.staffOnly = new Set([
      ...layout.staffOnly.map(keyOf),
      ...layout.tills.map((t) => keyOf(t.clerk)),
      ...layout.counters.map((c) => keyOf(c.clerk)),
      keyOf(layout.stockroom),
      ...layout.displays.filter((d) => d.kind === "produce").flatMap((d) => d.spots.map(keyOf)),
      ...(layout.breakSpot ? [keyOf(layout.breakSpot)] : []),
    ]);
    this.lanes = layout.tills.map((t) => (t.line.length > 0 ? { queue: t.line.map(keyOf), pay: keyOf(t.front) } : { queue: [], pay: "" }));
    this.lanes.forEach((lane, i) => {
      for (const k of lane.pay ? [...lane.queue, lane.pay] : []) this.laneAt.set(k, i);
    });
    this.nextCustomerAt = this.customerGap(0);
  }

  /**
   * Someone's way round the shop: never through a checkout lane, except the one they queue in (entered at
   * its back, never up past the till), their own till's square when it's their turn, and whichever lane
   * they're standing in, so they can always get out of it.
   */
  private router(customer: Customer, lane: number | null, withPay = false): Router {
    const site = this.siteRoute;
    if (site !== this.routedBy) {
      this.routes.clear();
      this.routedBy = site;
    }
    const here = this.laneAt.get(keyOf(customer.walker.tile)) ?? -1;
    const key = `${here}|${lane ?? -1}|${withPay}`;
    const known = this.routes.get(key);
    if (known) return known;
    // Every customer's route never goes through or onto a staff-only square, either.
    const allowed = new Set<string>();
    if (here >= 0) for (const k of [...this.lanes[here].queue, this.lanes[here].pay]) allowed.add(k);
    if (lane !== null && this.lanes[lane]?.pay) {
      for (const k of this.lanes[lane].queue) allowed.add(k);
      if (withPay) allowed.add(this.lanes[lane].pay);
    }
    const shut = new Set([...this.staffOnly, ...[...this.laneAt.keys()].filter((k) => !allowed.has(k))]);
    const route: Router = (from, to, avoid) => (shut.has(keyOf(to)) ? null : site(from, to, avoid ? new Set([...avoid, ...shut]) : shut));
    this.routes.set(key, route);
    return route;
  }

  /** Post whatever the store needs, then move everyone shopping along. `open` says which tills and which
   *  places at the produce counter have a clerk on duty. */
  tick(board: Board, now: number, dt: number, siteRoute: Router, crowd: Crowd, open: Record<QueueKind, number[]>): void {
    this.siteRoute = siteRoute;
    this.open = open;
    this.deliver(now);
    for (const d of this.displays) {
      if (d.stock <= d.cap * this.tuning.restockAt && this.stockroom > 0) {
        board.post("restock", `restock:${d.layout.id}`, this.layout.stockroom, now);
      }
    }
    for (const customer of this.customers) this.shop(customer, board, now, dt, crowd);
    this.customers = this.customers.filter((customer) => customer.state !== "GONE");
    // New people come in after everyone has moved, never through someone standing in the doorway.
    if (now >= this.nextCustomerAt) {
      this.nextCustomerAt = now + this.customerGap(now);
      const door = this.layout.entrances.find((d) => !crowd.isTaken(d, standingAt(d)) && !this.customers.some((c) => sameTile(c.walker.tile, d)));
      if (door && this.isOpen(now) && this.customers.length < this.tuning.maxCustomers) this.admit(now, door);
    }
  }

  walkers(): Walker[] {
    return this.customers.map((c) => c.walker);
  }

  isOpen(now: number): boolean {
    if (!this.hourAt) return true;
    const hour = this.hourAt(now);
    return hour >= this.tuning.opens && hour < this.tuning.closes;
  }

  /** A delivery lands at each delivery hour, once a day. */
  private deliver(now: number): void {
    if (!this.hourAt) return;
    const hour = Math.floor(this.hourAt(now));
    const day = Math.floor(now / (24 * 3_600_000));
    const slot = day * 24 + hour;
    if (slot === this.lastDelivery || !this.tuning.deliveries.includes(hour)) return;
    this.lastDelivery = slot;
    this.stockroom += this.tuning.delivery;
    this.emit({ kind: "delivered", count: this.tuning.delivery });
  }

  display(id: string) {
    return this.displays.find((d) => d.layout.id === id);
  }

  plan(task: Task, worker: Worker, route: Router): Plan | null {
    this.siteRoute = route;
    if (task.kind === "restock") return this.restockPlan(task, worker);
    if (task.kind === "serve") return this.servePlan(task, worker);
    if (task.kind === "checkout") return this.checkoutPlan(task, worker);
    return null;
  }

  /** Fetch a crate from the stockroom, carry it out, and fill the display from the square nearest the doors. */
  private restockPlan(task: Task, worker: Worker): Plan | null {
    const d = this.display(task.key.slice("restock:".length));
    if (!d) return null;
    const stockroom = this.layout.stockroom;
    const spot = nearest(d.layout.spots, stockroom);
    const giveBack = (count: number) => {
      this.stockroom += count;
    };
    return {
      giveBack,
      legs: [
        {
          at: stockroom,
          facing: stockroom.facing,
          doing: "reach",
          around: true,
          ms: this.tuning.fetchMs,
          ready: () => this.stockroom > 0 && d.stock < d.cap,
          finish: () => {
            const take = Math.min(this.stockroom, d.cap - d.stock, this.tuning.crate);
            this.stockroom -= take;
            worker.carrying += take;
          },
        },
        {
          at: spot,
          facing: spot.facing,
          doing: "reach",
          around: true,
          ms: this.tuning.stockMs,
          ready: () => true,
          finish: () => {
            const placed = Math.min(d.cap - d.stock, worker.carrying);
            d.stock += placed;
            giveBack(worker.carrying - placed);
            this.emit({ kind: "restocked", display: d.layout.id, by: worker.name, count: placed });
            worker.carrying = 0;
          },
        },
      ],
    };
  }

  /** Take the order at the counter, pick it off the table, and hand it across. */
  private servePlan(task: Task, worker: Worker): Plan | null {
    const n = Number(task.key.split(":")[1]);
    const station = this.layout.counters[n];
    if (!station) return null;
    const waiting = () => this.customers.find((c) => c.id === this.queues.produce.serving[n] && c.state === "ORDERED");
    const customer = waiting();
    if (!customer) return null;
    const counter = station.clerk;
    const want = this.display(customer.list[0]);
    // The table with what they asked for; failing that, whatever the market still has.
    const table = want && want.stock > 0 ? want : this.displays.find((x) => x.layout.kind === "produce" && x.stock > 0);
    const legs: Leg[] = [
      { at: counter, facing: counter.facing, doing: "idle", ms: this.tuning.takeOrderMs, ready: () => waiting() !== undefined, finish: () => {} },
    ];
    if (table) {
      const pickAt = nearest(table.layout.spots, counter);
      legs.push({
        at: pickAt,
        facing: pickAt.facing,
        doing: "reach",
        around: true,
        ms: this.tuning.pickMs,
        ready: () => table.stock > 0,
        finish: () => {
          const n = Math.min(table.stock, 1 + (hashOf(customer.id) % 2));
          table.stock -= n;
          worker.carrying += n;
        },
      });
    }
    legs.push({
      at: counter,
      facing: counter.facing,
      doing: "give",
      ms: this.tuning.handMs,
      ready: () => true,
      start: (now) => {
        const c = waiting();
        if (c) this.play(c, "reach", now, now + this.tuning.handMs);
      },
      finish: (now) => {
        const c = waiting();
        const n = worker.carrying;
        worker.carrying = 0;
        if (!c) {
          if (table) table.stock += n;
          return;
        }
        if (n > 0) {
          for (let i = 0; i < n; i++) c.basket.push(table?.layout.id ?? c.list[0]);
          this.emit({ kind: "served", by: worker.name, customer: c.id, count: n });
        } else {
          c.missed += 1;
        }
        c.list.shift();
        this.freePlaces(c);
        this.afterItem(c, now);
      },
    });
    return {
      giveBack: (n) => {
        if (table) table.stock += n;
      },
      legs,
    };
  }

  /** Ring each item through, take the money, and see them off. */
  private checkoutPlan(task: Task, worker: Worker): Plan | null {
    const t = Number(task.key.split(":")[1]);
    const till = this.layout.tills[t];
    if (!till) return null;
    const paying = () => this.customers.find((c) => c.id === this.queues.till.serving[t] && c.state === "PAY");
    const first = paying();
    if (!first) return null;
    const scanning = this.tuning.checkoutMs + this.tuning.scanMs * first.basket.length;
    return {
      giveBack: () => {},
      legs: [
        {
          at: till.clerk,
          facing: till.clerk.facing,
          doing: "scan",
          ms: scanning + this.tuning.payMs,
          ready: () => paying() !== undefined,
          start: (now) => {
            // The customer hands the money across once everything is through.
            const c = paying();
            if (c) this.play(c, "give", now + scanning, now + scanning + this.tuning.payMs);
          },
          finish: () => {
            const customer = paying();
            if (!customer) return;
            const count = customer.basket.length;
            customer.basket = [];
            this.emit({ kind: "sold", till: t, by: worker.name, customer: customer.id, count });
            this.score(customer, this.satisfaction(customer), count);
            this.leave(customer, this.router(customer, null));
          },
        },
      ],
    };
  }

  view(now: number): CustomerView[] {
    return this.customers.map((c) => ({
      id: c.id,
      sprite: c.sprite,
      tile: c.walker.tile,
      from: c.walker.from,
      stepMs: c.walker.stepMs,
      stepLeft: c.walker.stepLeft,
      facing: c.walker.facing,
      doing: this.doingOf(c, now),
      carrying: c.basket.length,
      mood: this.moodOf(c),
    }));
  }

  displayView(): DisplayView[] {
    return this.displays.map((d) => ({ id: d.layout.id, kind: d.layout.kind, stock: d.stock, cap: d.cap }));
  }

  private play(customer: Customer, act: Act, from: number, until: number): void {
    customer.act = act;
    customer.actFrom = from;
    customer.actUntil = until;
  }

  private moodOf(customer: Customer): Mood {
    const left = customer.patienceLeft / customer.patience;
    return left > 0.5 ? "calm" : left > 0.2 ? "impatient" : "cross";
  }

  private doingOf(customer: Customer, now: number): Act {
    if (customer.act && now >= customer.actFrom && now < customer.actUntil) return customer.act;
    const walking = customer.walker.stepLeft > 0 || customer.walker.path.length > 0;
    return walking ? "walk" : "idle";
  }

  /** The wait before the next customer: shorter with a good reputation and at the lunch and dinner rush. */
  private customerGap(now: number): number {
    const [min, max] = this.tuning.customerEvery;
    const base = min + this.random() * (max - min);
    const standing = 1.4 - (this.reputation / 100) * 0.8;
    return (base * standing) / this.rush(now);
  }

  /** How many times busier than usual it is: 1 off-peak, 1 + rushLift at the height of lunch and dinner. */
  rush(now: number): number {
    if (!this.hourAt) return 1;
    const hour = this.hourAt(now);
    const bump = (peak: number) => Math.exp(-(((hour - peak) / 1.2) ** 2));
    return 1 + this.tuning.rushLift * Math.max(bump(12.5), bump(18));
  }

  /** In through the door with a short list. It's a produce market: fresh produce is what most come for. */
  private admit(now: number, door: Spot): void {
    // A face nobody in the shop has on right now, so the same person isn't in two places at once.
    const inStore = new Set(this.customers.map((c) => c.sprite));
    const free = this.customerSprites.filter((name) => !inStore.has(name));
    const pool = free.length > 0 ? free : this.customerSprites;
    const sprite = pool[Math.floor(this.random() * pool.length)] ?? pool[0];
    if (!sprite) return;
    const shelves = this.displays.filter((d) => d.layout.kind === "shelf").map((d) => d.layout.id);
    const produce = this.displays.filter((d) => d.layout.kind === "produce").map((d) => d.layout.id);
    const list: string[] = [];
    const extra = Math.floor(this.random() * 3);
    for (let i = 0; i < extra && shelves.length > 0; i++) {
      const pick = shelves[Math.floor(this.random() * shelves.length)];
      if (!list.includes(pick)) list.push(pick);
    }
    // Shelves first, on the way round; the produce counter last, nearest the tills.
    if (produce.length > 0 && (this.random() < 0.65 || list.length === 0)) list.push(produce[Math.floor(this.random() * produce.length)]);
    if (list.length === 0) return;
    const [lo, hi] = this.tuning.patience;
    const patience = lo + this.random() * (hi - lo);
    this.admitted += 1;
    const customer: Customer = {
      id: `customer:${this.admitted}`,
      sprite,
      walker: standingAt(door, "up"),
      state: "BROWSE_WALK",
      list,
      wanted: list.length,
      basket: [],
      missed: 0,
      goal: door,
      place: -1,
      lineOf: null,
      station: null,
      patience,
      patienceLeft: patience,
      since: now,
      act: null,
      actFrom: 0,
      actUntil: 0,
    };
    this.customers.push(customer);
    this.afterItem(customer, now);
  }

  /** On to the next thing on their list, or to the tills when it's done. */
  private afterItem(customer: Customer, now: number): void {
    const next = customer.list[0];
    if (next === undefined) {
      if (customer.basket.length === 0) {
        this.walkOut(customer, "empty-shelf", now);
        return;
      }
      customer.state = "TILL_LINE";
      customer.place = -1;
      this.joinQueue(customer, "till");
      return;
    }
    if (this.display(next)?.layout.kind === "produce") {
      customer.state = "ORDER_LINE";
      customer.place = -1;
      this.joinQueue(customer, "produce");
      return;
    }
    if (!this.headForShelf(customer, this.router(customer, null))) {
      customer.missed += 1;
      customer.list.shift();
      this.afterItem(customer, now);
    }
  }

  /** Off to browse the next shelf, from whichever of its squares nobody else is making for, nearest first. */
  private headForShelf(customer: Customer, route: Router): boolean {
    const d = this.display(customer.list[0]);
    if (!d) return false;
    const claimed = new Set(this.customers.filter((c) => c !== customer && c.state !== "LEAVE").map((c) => keyOf(c.goal)));
    const here = customer.walker.tile;
    const options = [...d.layout.spots].sort(
      (a, b) =>
        Number(claimed.has(keyOf(a))) - Number(claimed.has(keyOf(b))) ||
        Math.abs(a.tx - here.tx) + Math.abs(a.ty - here.ty) - (Math.abs(b.tx - here.tx) + Math.abs(b.ty - here.ty)),
    );
    for (const at of options) {
      const path = route(here, at);
      if (!path) continue;
      customer.walker.path = path;
      customer.goal = at;
      customer.state = "BROWSE_WALK";
      return true;
    }
    return false;
  }

  private stations(kind: QueueKind): Station[] {
    return kind === "till" ? this.layout.tills : this.layout.counters;
  }

  /** The queue a customer is standing in, and its squares. */
  private lineOf(customer: Customer, kind: QueueKind): { line: (string | null)[]; spots: Spot[] } {
    const q = this.queues[kind];
    if (customer.lineOf === null) return { line: q.shared, spots: kind === "till" ? this.layout.tillLine : this.layout.produceLine };
    return { line: q.own[customer.lineOf], spots: this.stations(kind)[customer.lineOf].line };
  }

  /** Into the shared queue, or where each station has its own, the shortest one with a clerk on duty. */
  private joinQueue(customer: Customer, kind: QueueKind): boolean {
    const q = this.queues[kind];
    const stations = this.stations(kind);
    const shared = kind === "till" ? this.layout.tillLine : this.layout.produceLine;
    if (shared.length > 0) return this.joinLine(customer, q.shared, shared, null, this.router(customer, null));
    const open = this.open[kind].length > 0 ? this.open[kind] : stations.map((_, i) => i);
    const here = customer.walker.tile;
    const load = (i: number) => q.own[i].filter((id) => id !== null).length + (q.serving[i] === null ? 0 : 1);
    const order = [...open].sort((a, b) => load(a) - load(b) || distance(stations[a].front, here) - distance(stations[b].front, here));
    return order.some((i) => this.joinLine(customer, q.own[i], stations[i].line, i, this.router(customer, kind === "till" ? i : null)));
  }

  /** Into a queue behind the last person in it. False when it is full (they wait where they are). */
  private joinLine(customer: Customer, line: (string | null)[], spots: Spot[], station: number | null, route: Router): boolean {
    let last = -1;
    for (let i = line.length - 1; i >= 0; i--) {
      if (line[i] !== null) {
        last = i;
        break;
      }
    }
    const place = last + 1;
    if (place >= line.length) return false;
    const path = route(customer.walker.tile, spots[place]);
    if (!path) return false;
    line[place] = customer.id;
    customer.place = place;
    customer.lineOf = station;
    customer.goal = spots[place];
    customer.walker.path = path;
    return true;
  }

  /**
   * Held up on the way to their place by someone further back in the same queue who got there first and
   * stands in the way: they swap places, the way people in a real queue wave each other on.
   */
  private letThrough(customer: Customer, line: (string | null)[], spots: Spot[], route: Router): void {
    const inTheWay = customer.walker.path[0];
    if (!inTheWay || customer.walker.blockedMs < 300) return;
    const other = this.customers.find(
      (c) => c !== customer && sameTile(c.walker.tile, inTheWay) && c.lineOf === customer.lineOf && line[c.place] === c.id,
    );
    if (!other || other.place <= customer.place) return;
    const [mine, theirs] = [customer.place, other.place];
    const toTheirs = route(customer.walker.tile, spots[theirs]);
    const toMine = route(other.walker.tile, spots[mine]);
    if (!toTheirs || !toMine) return;
    line[mine] = other.id;
    line[theirs] = customer.id;
    customer.place = theirs;
    other.place = mine;
    customer.goal = spots[theirs];
    other.goal = spots[mine];
    customer.walker.path = toTheirs;
    other.walker.path = toMine;
    customer.walker.blockedMs = 0;
  }

  /** Step up into the place ahead when it comes free. */
  private stepUp(customer: Customer, line: (string | null)[], spots: Spot[], route: Router): void {
    if (customer.place <= 0 || line[customer.place - 1] !== null) return;
    const ahead = customer.place - 1;
    const path = route(customer.walker.tile, spots[ahead]);
    if (!path) return;
    line[customer.place] = null;
    line[ahead] = customer.id;
    customer.place = ahead;
    customer.goal = spots[ahead];
    customer.walker.path = path;
  }

  private shop(customer: Customer, board: Board, now: number, dt: number, crowd: Crowd): void {
    const msPerTile = this.tuning.customerMsPerTile;
    const inLane = customer.state === "TILL_LINE" && customer.place >= 0 ? customer.lineOf : null;
    const atTill = customer.state === "TO_TILL" || customer.state === "PAY" ? customer.station : null;
    const route = this.router(customer, inLane ?? atTill, atTill !== null);
    const arrive = () => walkAmong(customer.walker, customer.goal, dt, msPerTile, crowd, route);
    // In a checkout lane with a cashier on duty, or at its till, they see it through.
    const committed = this.committed(customer);
    // Held up by other people counts as waiting.
    const heldUp = () => customer.walker.blockedMs > 0 && this.wait(customer, dt, now, committed);
    switch (customer.state) {
      case "BROWSE_WALK": {
        if (!arrive()) {
          heldUp();
          return;
        }
        customer.walker.facing = (customer.goal as Spot).facing ?? customer.walker.facing;
        customer.state = "BROWSE";
        customer.since = now;
        return;
      }

      case "BROWSE": {
        if (now - customer.since < this.tuning.browseMs) return;
        const d = this.display(customer.list[0]);
        if (d && d.stock > 0) {
          d.stock -= 1;
          customer.basket.push(d.layout.id);
          this.play(customer, "reach", now, now + this.tuning.takeMs);
        } else {
          // Empty: hang on a little for a restock, then give that one up.
          if (this.wait(customer, dt, now)) return;
          if (now - customer.since < this.tuning.browseMs + this.tuning.shelfWaitMs) return;
          customer.missed += 1;
        }
        customer.list.shift();
        this.afterItem(customer, now);
        return;
      }

      case "ORDER_LINE":
      case "TILL_LINE": {
        const kind: QueueKind = customer.state === "ORDER_LINE" ? "produce" : "till";
        if (customer.place < 0) {
          // Off one queue and not yet in another: finish the step they're on rather than stand on two squares.
          if (customer.walker.stepLeft > 0) {
            customer.walker.path = [];
            stepWalk(customer.walker, dt, msPerTile);
            return;
          }
          if (!this.joinQueue(customer, kind)) this.wait(customer, dt, now);
          return;
        }
        const { line, spots } = this.lineOf(customer, kind);
        // Their lane's clerk has gone on a break: off to another lane.
        if (customer.lineOf !== null && !this.open[kind].includes(customer.lineOf) && this.open[kind].length > 0) {
          line[customer.place] = null;
          customer.place = -1;
          customer.lineOf = null;
          return;
        }
        this.stepUp(customer, line, spots, route);
        if (!arrive()) {
          this.letThrough(customer, line, spots, route);
          heldUp();
          return;
        }
        customer.walker.facing = spots[customer.place].facing;
        if (customer.place === 0 && this.toStation(customer, kind, line, kind === "till" ? this.router(customer, customer.lineOf, true) : route)) return;
        this.wait(customer, dt, now, committed);
        return;
      }

      case "TO_COUNTER": {
        if (this.otherCounter(customer, board, route)) return;
        if (!arrive()) {
          heldUp();
          return;
        }
        const n = customer.station ?? 0;
        customer.walker.facing = this.layout.counters[n].front.facing;
        customer.state = "ORDERED";
        board.post("serve", `serve:${n}`, this.layout.counters[n].clerk, now);
        return;
      }

      case "ORDERED": {
        if (this.otherCounter(customer, board, route)) return;
        const n = customer.station ?? 0;
        const note = board.get(`serve:${n}`);
        if (note?.claimedBy) return;
        if (!note) board.post("serve", `serve:${n}`, this.layout.counters[n].clerk, now);
        if (this.wait(customer, dt, now, committed)) board.tear(`serve:${n}`);
        return;
      }

      case "TO_TILL": {
        if (!arrive()) {
          heldUp();
          return;
        }
        const t = customer.station ?? 0;
        customer.walker.facing = this.layout.tills[t].front.facing;
        customer.state = "PAY";
        board.post("checkout", `checkout:${t}`, this.layout.tills[t].clerk, now);
        return;
      }

      case "PAY": {
        const t = customer.station ?? 0;
        const note = board.get(`checkout:${t}`);
        if (note?.claimedBy) return;
        if (!note) board.post("checkout", `checkout:${t}`, this.layout.tills[t].clerk, now);
        if (this.wait(customer, dt, now, committed)) board.tear(`checkout:${t}`);
        return;
      }

      case "DESPAIR":
        if (now < customer.actUntil) return;
        this.leave(customer, route);
        return;

      case "LEAVE":
        if (walkAmong(customer.walker, customer.goal, dt, msPerTile, crowd, route) || (customer.walker.stepLeft === 0 && this.layout.exits.some((d) => sameTile(d, customer.walker.tile)))) {
          customer.state = "GONE";
        }
        return;

      case "GONE":
        return;
    }
  }

  /** From the front of the queue to the counter: their own lane's, or whichever open one is free. */
  private toStation(customer: Customer, kind: QueueKind, line: (string | null)[], route: Router): boolean {
    const q = this.queues[kind];
    const open = this.open[kind];
    const candidates = customer.lineOf === null ? open : open.filter((i) => i === customer.lineOf);
    const s = candidates.find((i) => q.serving[i] === null);
    if (s === undefined) return false;
    const front = this.stations(kind)[s].front;
    const path = route(customer.walker.tile, front);
    if (!path) return false;
    line[customer.place] = null;
    q.serving[s] = customer.id;
    customer.place = -1;
    customer.lineOf = null;
    customer.station = s;
    customer.goal = front;
    customer.walker.path = path;
    customer.state = kind === "till" ? "TO_TILL" : "TO_COUNTER";
    return true;
  }

  /** Their place at the produce counter has lost its clerk to a break: over to a free place that has one. */
  private otherCounter(customer: Customer, board: Board, route: Router): boolean {
    const n = customer.station;
    if (n === null || this.open.produce.includes(n)) return false;
    const q = this.queues.produce;
    const to = this.open.produce.find((i) => q.serving[i] === null);
    if (to === undefined) return false;
    const front = this.layout.counters[to].front;
    const path = route(customer.walker.tile, front);
    if (!path) return false;
    const note = board.get(`serve:${n}`);
    if (note && !note.claimedBy) board.tear(`serve:${n}`);
    q.serving[n] = null;
    q.serving[to] = customer.id;
    customer.station = to;
    customer.goal = front;
    customer.walker.path = path;
    customer.state = "TO_COUNTER";
    return true;
  }

  /** In a checkout lane (or at its till) whose cashier is on duty, or at the produce counter with its clerk on. */
  private committed(customer: Customer): boolean {
    if (customer.state === "TO_COUNTER" || customer.state === "ORDERED") return customer.station !== null && this.open.produce.includes(customer.station);
    const lane = customer.state === "TILL_LINE" ? customer.lineOf : customer.state === "TO_TILL" || customer.state === "PAY" ? customer.station : null;
    return lane !== null && this.layout.tills[lane].line.length > 0 && this.open.till.includes(lane);
  }

  /** Time spent waiting wears patience down. True when it has run out and they have walked out, which
   *  someone `committed` to a checkout lane never does. */
  private wait(customer: Customer, dt: number, now: number, committed = false): boolean {
    customer.patienceLeft -= dt;
    if (customer.patienceLeft > 0 || committed) return false;
    this.walkOut(customer, "patience", now);
    return true;
  }

  /** What a visit scored: 100, less for time spent waiting and for things they couldn't get. */
  private satisfaction(customer: Customer): number {
    const waited = 1 - Math.max(0, customer.patienceLeft) / customer.patience;
    const missing = customer.missed / Math.max(1, customer.wanted);
    return Math.round(Math.max(0, Math.min(100, 100 - 45 * waited - 35 * missing)));
  }

  /** Out of patience or out of luck: everything goes back, they throw up their hands, then they leave. */
  private walkOut(customer: Customer, reason: "patience" | "empty-shelf", now: number): void {
    for (const id of customer.basket) {
      const d = this.display(id);
      if (d && d.stock < d.cap) d.stock += 1;
      else this.stockroom += 1;
    }
    customer.basket = [];
    this.emit({ kind: "walked-out", customer: customer.id, reason });
    this.score(customer, 0, 0);
    this.freePlaces(customer);
    customer.walker.path = [];
    customer.state = "DESPAIR";
    this.play(customer, "despair", now, now + 900);
  }

  private score(customer: Customer, satisfaction: number, bought: number): void {
    this.reputation = this.reputation * 0.85 + satisfaction * 0.15;
    this.emit({ kind: "visit", customer: customer.id, satisfaction, bought });
  }

  /** Their place in any queue or at any counter comes free. */
  private freePlaces(customer: Customer): void {
    for (const q of Object.values(this.queues)) {
      for (const line of [q.shared, q.serving, ...q.own]) {
        const at = line.indexOf(customer.id);
        if (at >= 0) line[at] = null;
      }
    }
    customer.station = null;
    customer.lineOf = null;
    customer.place = -1;
  }

  /** They make for the nearest door. */
  private leave(customer: Customer, route: Router): void {
    this.freePlaces(customer);
    const door = nearest(this.layout.exits, customer.walker.tile);
    customer.goal = door;
    customer.walker.facing = faceToward(customer.walker.tile, door, customer.walker.facing);
    customer.state = "LEAVE";
    const path = route(customer.walker.tile, door);
    if (path) customer.walker.path = path;
    else customer.state = "GONE";
  }
}

function distance(a: Tile, b: Tile): number {
  return Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
}

function nearest(spots: Spot[], to: Tile): Spot {
  return [...spots].sort((a, b) => distance(a, to) - distance(b, to))[0];
}

function hashOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h;
}
