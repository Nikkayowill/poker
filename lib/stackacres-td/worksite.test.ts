import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tileKey, tilePath, type Grid } from "./movement";
import { Board, Crowd, gridRouter, keyOf, standingAt, stepWalk, walkAmong, type Job, type Tile } from "./work-board";
import { DEFAULT_PROFILE, LOOK_EVERY_MS, Worker, type Plan, type WorkContext, type WorkerProfile } from "./work-crew";
import { STORE_SHOPPERS, STORE_STAFF } from "./store-cast";
import { WORKSITE_TUNING, Worksite, marketGrid, marketLayout, type MarketArea, type Post, type WorksiteEvent } from "./worksite";

const AREA = JSON.parse(readFileSync(join(process.cwd(), "public/stackacres-td/areas/grocery/area.json"), "utf8")) as MarketArea;
const GRID = marketGrid(AREA);
const LAYOUT = marketLayout(AREA);

function grid(rows: string[]): Grid {
  const blocked = new Set<string>();
  rows.forEach((row, ty) => [...row].forEach((c, tx) => c === "#" && blocked.add(tileKey(tx, ty))));
  return { width: rows[0].length, height: rows.length, tile: 16, blocked };
}
const openGrid = (w: number, h: number) => grid(Array.from({ length: h }, () => ".".repeat(w)));
const t = (tx: number, ty: number): Tile => ({ tx, ty });
/** A day starting at 9 AM, an hour a minute. */
const clock = (now: number) => (9 + now / 60_000) % 24;

type Hire = { name: string; job: Job; post: Post; profile?: WorkerProfile };

function market(options: { staff?: readonly Hire[]; seed?: number; tuning?: typeof WORKSITE_TUNING; hourAt?: (now: number) => number } = {}) {
  const site = new Worksite(LAYOUT, GRID, {
    seed: options.seed ?? 7,
    customerSprites: STORE_SHOPPERS,
    tuning: options.tuning,
    hourAt: options.hourAt ?? clock,
  });
  for (const h of options.staff ?? STORE_STAFF) site.hire(h.name, h.job, h.name, h.post, h.profile);
  return site;
}

function run(site: Worksite, ms: number, each?: (events: WorksiteEvent[]) => void): WorksiteEvent[] {
  const all: WorksiteEvent[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    const events = site.step(50);
    each?.(events);
    all.push(...events);
  }
  return all;
}
const count = (events: WorksiteEvent[], kind: WorksiteEvent["kind"]) => events.filter((e) => e.kind === kind).length;

function context(board: Board, planner: WorkContext["planner"], g = openGrid(10, 10)): WorkContext {
  return { board, route: gridRouter(g), planner, crowd: new Crowd([]), msPerTile: 300, wear: 1, breakSpot: null, restMs: 20_000, random: () => 0.5 };
}
const onePlan = (at: Tile): Plan => ({ legs: [{ at, facing: "down", doing: "reach", ms: 100, ready: () => true, finish: () => {} }], giveBack: () => {} });

describe("tilePath", () => {
  it("steps one square at a time and leaves the start out", () => {
    expect(tilePath(openGrid(5, 1), [0, 0], [3, 0])).toEqual([[1, 0], [2, 0], [3, 0]]);
  });
  it("is null when the goal is walled off or blocked", () => {
    expect(tilePath(grid(["..#.."]), [0, 0], [4, 0])).toBeNull();
    expect(tilePath(grid(["..#.."]), [0, 0], [2, 0])).toBeNull();
  });
});

describe("stepWalk", () => {
  it("moves the grid square the moment a step starts, then takes the step's time to cross it", () => {
    const walker = standingAt(t(0, 0));
    walker.path = [t(1, 0), t(2, 0)];
    expect(stepWalk(walker, 0, 300)).toBe(false);
    expect(walker.tile).toEqual(t(1, 0));
    expect(walker.from).toEqual(t(0, 0));
    expect(stepWalk(walker, 450, 300)).toBe(false);
    expect(walker.tile).toEqual(t(2, 0));
    expect(walker.stepLeft).toBe(150);
    expect(stepWalk(walker, 150, 300)).toBe(true);
  });
});

describe("walking among people", () => {
  it("waits rather than step onto someone, then goes round them", () => {
    const route = gridRouter(openGrid(5, 3));
    const walker = standingAt(t(0, 1));
    walker.path = route(t(0, 1), t(4, 1))!;
    const crowd = new Crowd([walker, standingAt(t(1, 1))]);
    walkAmong(walker, t(4, 1), 300, 300, crowd, route);
    expect(walker.tile).toEqual(t(0, 1));
    for (let i = 0; i < 80; i++) walkAmong(walker, t(4, 1), 100, 300, crowd, route);
    expect(walker.tile).toEqual(t(4, 1));
  });

  it("waits its turn for the square it's headed to, without stepping aside", () => {
    const route = gridRouter(openGrid(5, 1));
    const walker = standingAt(t(0, 0));
    walker.path = route(t(0, 0), t(1, 0))!;
    const crowd = new Crowd([walker, standingAt(t(1, 0))]);
    for (let i = 0; i < 60; i++) walkAmong(walker, t(1, 0), 100, 300, crowd, route);
    expect(walker.tile).toEqual(t(0, 0));
  });
});

describe("a member of staff", () => {
  it("face to face in a gap one square wide, two people squeeze past each other", () => {
    const corridor = grid(["#######", ".......", "#######"]);
    const route = gridRouter(corridor);
    const a = standingAt(t(1, 1), "right");
    const b = standingAt(t(5, 1), "left");
    a.path = route(a.tile, t(6, 1)) ?? [];
    b.path = route(b.tile, t(0, 1)) ?? [];
    const crowd = new Crowd([a, b]);
    let aThere = false;
    let bThere = false;
    for (let ms = 0; ms < 20_000 && !(aThere && bThere); ms += 50) {
      aThere = aThere || walkAmong(a, t(6, 1), 50, 300, crowd, route);
      bThere = bThere || walkAmong(b, t(0, 1), 50, 300, crowd, route);
      expect(keyOf(a.tile)).not.toBe(keyOf(b.tile));
    }
    expect(aThere && bThere).toBe(true);
  });

  it("only looks at the board on its 500ms clock", () => {
    const board = new Board();
    const worker = new Worker("ann", "stocker", "dale", t(0, 0), 0);
    const ctx = context(board, () => null);
    worker.step(0, 0, ctx);
    board.post("restock", "restock:x", t(3, 3), 100);
    for (let now = 100; now < LOOK_EVERY_MS; now += 50) worker.step(now, 50, ctx);
    expect(board.get("restock:x")?.claimedBy).toBeNull();
    worker.step(LOOK_EVERY_MS, 50, { ...ctx, planner: () => onePlan(t(3, 3)) });
    expect(board.get("restock:x")?.claimedBy).toBe("ann");
  });

  it("goes back to their post when there's nothing to do", () => {
    const board = new Board();
    const worker = new Worker("bo", "cashier", "june", t(0, 0), 0, DEFAULT_PROFILE, { tx: 6, ty: 4, facing: "up" });
    const ctx = context(board, () => null);
    for (let now = 0; now < 10_000; now += 50) worker.step(now, 50, ctx);
    expect(worker.walker.tile).toEqual(t(6, 4));
    expect(worker.walker.facing).toBe("up");
  });

  it("wears out, sits down on the break chair, and comes back", () => {
    const board = new Board();
    const worker = new Worker("cy", "stocker", "dale", t(0, 0), 0, { ...DEFAULT_PROFILE, endurance: 2000 });
    const ctx = { ...context(board, (task) => onePlan(task.at)), breakSpot: t(5, 5), restMs: 1000 };
    let sat = false;
    let key = 0;
    for (let now = 0; now < 60_000; now += 50) {
      if (!board.all().some((n) => n.claimedBy === null)) board.post("restock", `restock:${key++}`, t(key % 4, 2), now);
      worker.step(now, 50, ctx);
      if (worker.doing() === "sit") sat = true;
    }
    expect(sat).toBe(true);
    expect(key).toBeGreaterThan(5);
  });

  it("an overworker never takes a break", () => {
    const board = new Board();
    const worker = new Worker("di", "stocker", "dale", t(0, 0), 0, { ...DEFAULT_PROFILE, endurance: 2000, traits: ["overworker"] });
    const ctx = { ...context(board, (task) => onePlan(task.at)), breakSpot: t(5, 5) };
    let key = 0;
    for (let now = 0; now < 30_000; now += 50) {
      if (!board.all().some((n) => n.claimedBy === null)) board.post("restock", `restock:${key++}`, t(key % 4, 2), now);
      worker.step(now, 50, ctx);
      expect(worker.onBreak).toBe(false);
    }
  });
});

describe("the grocery's layout, read off the room", () => {
  it("has the displays, four checkout lanes, three places at the produce counter and a way in and out", () => {
    expect(LAYOUT.displays.filter((d) => d.kind === "shelf").map((d) => d.id)).toEqual(["aisle-a", "aisle-b", "aisle-c", "bakery", "bulk", "dairy", "pantry", "wall"]);
    expect(LAYOUT.displays.filter((d) => d.kind === "produce")).toHaveLength(4);
    expect(LAYOUT.tills).toHaveLength(4);
    for (const till of LAYOUT.tills) {
      // The cashier and the customer face each other across the belt; the lane's queue runs back from the till.
      expect(till.clerk.facing).toBe("left");
      expect(till.front.facing).toBe("right");
      expect(till.line).toHaveLength(2);
      expect(till.line[0].ty).toBe(till.front.ty - 1);
    }
    expect(LAYOUT.tillLine).toEqual([]);
    expect(LAYOUT.counters).toHaveLength(3);
    for (const counter of LAYOUT.counters) {
      expect(counter.clerk.facing).toBe("down");
      expect(counter.front.facing).toBe("up");
      expect(counter.line).toEqual([]);
    }
    expect(LAYOUT.produceLine.length).toBeGreaterThanOrEqual(4);
    expect(LAYOUT.entrances).toHaveLength(2);
    expect(LAYOUT.exits).toHaveLength(2);
    expect(LAYOUT.breakSpot).not.toBeNull();
  });

  it("puts every square someone stands on on open floor", () => {
    const spots = [
      ...LAYOUT.displays.flatMap((d) => d.spots),
      ...[...LAYOUT.tills, ...LAYOUT.counters].flatMap((st) => [st.clerk, st.front, ...st.line]),
      ...LAYOUT.produceLine,
      ...LAYOUT.tillLine,
      LAYOUT.stockroom,
      ...LAYOUT.entrances,
      ...LAYOUT.exits,
    ];
    for (const s of spots) expect(GRID.blocked.has(keyOf(s)), keyOf(s)).toBe(false);
  });

  it("faces every display square toward its display", () => {
    for (const d of LAYOUT.displays) {
      for (const s of d.spots) {
        const ahead = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.facing];
        expect(GRID.blocked.has(tileKey(s.tx + ahead[0], s.ty + ahead[1])), `${d.id} ${keyOf(s)}`).toBe(true);
      }
    }
  });
});

// A simulated day with thirty-odd shoppers at the rush takes a couple of seconds on its own and several
// when the whole suite runs at once, so the day-long tests get room past vitest's five-second default.
const DAY = { timeout: 30_000 };

describe("a day at the market", () => {
  it("runs the whole day: deliveries, restocking, produce served over the counter, sales, visits", DAY, () => {
    const events = run(market(), 14 * 60_000);
    for (const kind of ["delivered", "restocked", "served", "sold", "visit"] as const) {
      expect(count(events, kind), kind).toBeGreaterThan(0);
    }
  });

  it("never makes or loses anything", DAY, () => {
    const site = market();
    const stocked = () => {
      const v = site.view();
      return v.stockroom + v.displays.reduce((n, d) => n + d.stock, 0) + [...v.workers, ...v.customers].reduce((n, w) => n + w.carrying, 0);
    };
    let total = stocked();
    let sold = 0;
    run(site, 12 * 60_000, (events) => {
      for (const e of events) {
        if (e.kind === "delivered") total += e.count;
        if (e.kind === "sold") sold += e.count;
      }
      expect(stocked() + sold).toBe(total);
    });
    expect(sold).toBeGreaterThan(0);
  });

  it("never has two people on one square, and shoppers never go behind a counter or into the market", { timeout: 60_000 }, () => {
    const busy = { ...WORKSITE_TUNING, customerEvery: [1500, 3000] as const, maxCustomers: 12 };
    const staffOnly = new Set([
      ...LAYOUT.staffOnly.map(keyOf),
      ...[...LAYOUT.tills, ...LAYOUT.counters].map((st) => keyOf(st.clerk)),
      ...LAYOUT.displays.filter((d) => d.kind === "produce").flatMap((d) => d.spots.map(keyOf)),
    ]);
    for (const seed of [1, 2]) {
      const site = market({ seed, tuning: busy });
      run(site, 8 * 60_000, () => {
        const v = site.view();
        const squares = [...v.workers, ...v.customers].map((w) => keyOf(w.tile));
        expect(new Set(squares).size).toBe(squares.length);
        for (const c of v.customers) expect(staffOnly.has(keyOf(c.tile)), keyOf(c.tile)).toBe(false);
      });
    }
  });

  it("nobody joins a queue ahead of someone already in it", DAY, () => {
    const busy = { ...WORKSITE_TUNING, customerEvery: [1500, 3000] as const, maxCustomers: 12, scanMs: 1500 };
    const site = market({ seed: 4, tuning: busy });
    const lines = () => {
      const s = site.store as unknown as { queues: Record<string, { shared: (string | null)[]; own: (string | null)[][] }> };
      return Object.values(s.queues).flatMap((q) => [[...q.shared], ...q.own.map((line) => [...line])]);
    };
    let before = lines();
    let joins = 0;
    run(site, 8 * 60_000, () => {
      const after = lines();
      after.forEach((line, q) =>
        line.forEach((id, place) => {
          if (id === null || before[q].includes(id)) return;
          joins += 1;
          const passed = before[q].slice(place + 1).filter((other) => other !== null && line.includes(other));
          expect(passed, `${id} cut in at ${place}`).toEqual([]);
        }),
      );
      before = after;
    });
    expect(joins).toBeGreaterThan(10);
  });

  it("nobody on the staff is ever stuck for long", DAY, () => {
    const site = market({ seed: 5 });
    const staff = (site as unknown as { workers: { worker: Worker }[] }).workers.map((w) => w.worker);
    let longest = 0;
    run(site, 12 * 60_000, () => {
      for (const w of staff) longest = Math.max(longest, w.walker.blockedMs);
    });
    expect(longest).toBeLessThan(5000);
  });

  it("with no cashier on, customers run out of patience and the store's name suffers", () => {
    const site = market({ staff: STORE_STAFF.filter((s) => s.job !== "cashier") });
    const events = run(site, 6 * 60_000);
    expect(count(events, "sold")).toBe(0);
    expect(events.some((e) => e.kind === "walked-out" && e.reason === "patience")).toBe(true);
    expect(site.view().reputation).toBeLessThan(60);
  });

  it("with no produce clerk, nobody gets produce", () => {
    const site = market({ staff: STORE_STAFF.filter((s) => s.job !== "produce") });
    expect(count(run(site, 6 * 60_000), "served")).toBe(0);
  });

  it("a well-staffed store scores its visits well", DAY, () => {
    const scores = run(market(), 12 * 60_000).flatMap((e) => (e.kind === "visit" ? [e.satisfaction] : []));
    expect(scores.length).toBeGreaterThan(10);
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeGreaterThan(60);
  });

  it("lets nobody in outside opening hours", () => {
    const site = market({ hourAt: () => 22 });
    expect(count(run(site, 2 * 60_000), "visit")).toBe(0);
    expect(site.view().customers).toHaveLength(0);
  });

  it("plays out the same from the same seed", DAY, () => {
    expect(run(market({ seed: 3 }), 4 * 60_000)).toEqual(run(market({ seed: 3 }), 4 * 60_000));
  });

  it("fills up at the lunch rush and stays moving", { timeout: 60_000 }, () => {
    const site = market({ seed: 2, hourAt: (now) => 11.5 + now / 60_000 });
    let most = 0;
    const events = run(site, 2 * 60_000, () => {
      most = Math.max(most, site.view().customers.length);
    });
    expect(most).toBeGreaterThanOrEqual(25);
    expect(count(events, "sold")).toBeGreaterThan(30);
    expect(count(events, "walked-out")).toBeLessThan(count(events, "visit") / 5);
  });

  it("nobody cuts through a checkout lane: only people checking out stand in one", { timeout: 60_000 }, () => {
    const lanes = new Set(LAYOUT.tills.flatMap((till) => [...till.line, till.front].map(keyOf)));
    const site = market({ seed: 3, hourAt: (now) => 12 + now / 60_000 });
    const store = site.store as unknown as { customers: { walker: { tile: Tile }; state: string }[] };
    run(site, 2 * 60_000, () => {
      for (const c of store.customers) {
        if (!lanes.has(keyOf(c.walker.tile))) continue;
        expect(["TILL_LINE", "TO_TILL", "PAY", "LEAVE", "DESPAIR"], `${c.state} at ${keyOf(c.walker.tile)}`).toContain(c.state);
      }
    });
  });

  it("comes in by the way in and leaves by the way out", () => {
    const entrances = new Set(LAYOUT.entrances.map(keyOf));
    const exits = new Set(LAYOUT.exits.map(keyOf));
    const site = market({ seed: 6 });
    const seen = new Map<string, string>();
    let left = 0;
    run(site, 4 * 60_000, () => {
      const now = new Map(site.view().customers.map((c) => [c.id, keyOf(c.tile)]));
      for (const [id, at] of now) if (!seen.has(id)) expect(entrances.has(at), `${id} came in at ${at}`).toBe(true);
      for (const [id, at] of seen) {
        if (now.has(id)) continue;
        left += 1;
        expect(exits.has(at), `${id} left from ${at}`).toBe(true);
      }
      seen.clear();
      for (const [id, at] of now) seen.set(id, at);
    });
    expect(left).toBeGreaterThan(5);
  });

  it("won't hire the same person twice", () => {
    const site = market({ staff: [] });
    site.hire("june", "cashier", "june", { at: "till", till: 0 });
    expect(() => site.hire("june", "cashier", "june", { at: "till", till: 1 })).toThrow();
  });
});
