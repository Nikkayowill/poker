/**
 * The barnyard and the crew who run it, all working off one bulletin board: the farm's worksite.ts.
 *
 * The yard (work-barn.ts) posts what needs doing: a trough running low, a dirty pen, eggs in the nest, a
 * cow at the milking stand, a horse to turn out or bring in, a ripe plot or a bare one. Each of the crew takes the notes their job covers
 * (work-crew.ts) and goes back to their post in the yard when there's nothing to do. This owns the clock
 * and steps them all in order: the yard and its animals, then the crew.
 *
 * The layout comes off the map: the barnyard's area.json carries a zone on every square someone works
 * from, and every pen, trough and plot, and `barnLayout` reads them. Nothing here reads the wall clock or
 * Math.random: time only moves through `step`, and the randomness is seeded, so the same day plays out the
 * same on any device. It holds no Gold.
 *
 * Pure, tested without Phaser (barnsite.test.ts).
 */

import { mulberry32 } from "@/lib/seeded-random";
import { tileKey, type Grid } from "./movement";
import type { Dir } from "./npc-routine";
import { Board, Crowd, faceToward, gridRouter, keyOf, type FarmJob, type Router, type Task, type Tile, type WalkerView } from "./work-board";
import { DEFAULT_PROFILE, Worker, type Plan, type WorkerProfile } from "./work-crew";
import {
  BarnYard,
  PEN_KIND,
  type AnimalView,
  type BarnEvent,
  type BarnLayout,
  type BarnTuning,
  type PenLayout,
  type HorseSpot,
  type Plot,
  type PlotView,
  type Stand,
  type TroughView,
} from "./work-barn";
import type { Spot } from "./work-store";

export interface BarnsiteTuning extends BarnTuning {
  /** A hand's walking pace, ms a tile. */
  msPerTile: number;
  /** A break, from worn out to rested. */
  restMs: number;
}

export const BARN_TUNING: BarnsiteTuning = {
  msPerTile: 300,
  restMs: 20_000,
  hourMs: 60_000,
  herd: { hen: 10, sheep: 8, cow: 6, pig: 3, horse: 4 },
  litter: 2,
  youngMeal: 0.4,
  animalMsPerTile: { hen: 420, sheep: 560, cow: 700, pig: 620, horse: 520 },
  gallopMsPerTile: 190,
  gallopReach: 6,
  hungerPerHour: { hen: 0.3, sheep: 0.22, cow: 0.27, pig: 0.26, horse: 0.24 },
  thirstPerHour: { hen: 0.4, sheep: 0.32, cow: 0.36, pig: 0.32, horse: 0.3 },
  grazing: 0.6,
  asleep: 0.25,
  eatBelow: 0.55,
  meal: { hen: 0.1, sheep: 0.15, cow: 0.2, pig: 0.2, horse: 0.2 },
  eatMs: 6000,
  drinkMs: 4000,
  refillBelow: 0.5,
  dirtPerHour: { hen: 0.025, sheep: 0.035, cow: 0.045, pig: 0.07, horse: 0.035 },
  muckAt: 0.7,
  feedStart: 18,
  feedCap: 60,
  fetchMs: 1400,
  pourMs: 1600,
  drawMs: 1800,
  muckMs: 5000,
  dumpMs: 1000,
  collectMs: 2000,
  dropMs: 1000,
  milkMs: 20_000,
  harvestMs: 1400,
  sowMs: 1200,
  stackMs: 1200,
  groomMs: 12_000,
  leadMs: 1200,
  ledMsPerTile: 320,
  milking: [
    [5, 8],
    [16, 19],
  ],
  restlessAfterMs: 90_000,
  lay: [6, 11],
  eggsAt: 3,
  eggSweep: 15,
  wallowHours: [11, 16],
  wallowMs: 25_000,
  turnout: 7,
  bringIn: 17.5,
  stageHours: { wheat: 3, corn: 3.75 },
  sheaves: 4,
  sheavesPerSack: 3,
  sowRun: 6,
  shift: [5, 21],
  dusk: 20,
  henWake: 6,
  wake: 5,
  daylight: [6, 20],
};

export type BarnsiteEvent = BarnEvent;

export interface BarnWorkerView extends WalkerView {
  job: FarmJob;
  energy: number;
  onBreak: boolean;
}

export interface BarnsiteView {
  workers: BarnWorkerView[];
  animals: AnimalView[];
  troughs: TroughView[];
  plots: PlotView[];
  pens: { id: string; dirt: number }[];
  /** Sacks of feed in the barn. */
  feedStore: number;
  nestEggs: number;
  /** Pails and eggs brought in to the dairy so far. */
  dairy: { milk: number; eggs: number };
  /** Whether the crew is on shift. */
  working: boolean;
  notes: Task[];
}

/** The part of an area.json this reads. */
export interface BarnArea {
  width: number;
  height: number;
  tile: number;
  blocked: [number, number][];
  props: { blocks: [number, number][] }[];
  zones: { tag: string; x: number; y: number; w: number; h: number }[];
}

/** The map's walk grid: its walls and fences, and what its buildings and props stand on. */
export function barnGrid(area: BarnArea): Grid {
  const blocked = new Set<string>();
  for (const [tx, ty] of area.blocked) blocked.add(tileKey(tx, ty));
  for (const prop of area.props) for (const [tx, ty] of prop.blocks) blocked.add(tileKey(tx, ty));
  return { width: area.width, height: area.height, tile: area.tile, blocked };
}

const STEP: Readonly<Record<Dir, readonly [number, number]>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** Animals too long side on to eat at the end of a trough (work-barn.ts). */
const LONG_KINDS: ReadonlySet<string> = new Set(["cow", "horse"]);

/** Every square a zone's rectangle covers. */
function tilesOf(z: { x: number; y: number; w: number; h: number }, tile: number): Tile[] {
  const out: Tile[] = [];
  const x0 = Math.floor(z.x / tile);
  const y0 = Math.floor(z.y / tile);
  const x1 = Math.floor((z.x + Math.max(1, z.w) - 1) / tile);
  const y1 = Math.floor((z.y + Math.max(1, z.h) - 1) / tile);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ tx, ty });
  return out;
}

/** Every square of `squares` a walker can get to from `from`, the way the path-finder steps: eight ways, never
 *  cutting a corner that isn't in `squares` (movement.ts). */
function reachable(from: readonly Tile[], squares: ReadonlySet<string>): Set<string> {
  const seen = new Set(from.map(keyOf).filter((k) => squares.has(k)));
  const queue = from.filter((t) => squares.has(keyOf(t)));
  while (queue.length > 0) {
    const t = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const k = tileKey(t.tx + dx, t.ty + dy);
      if (!squares.has(k) || seen.has(k)) continue;
      if (dx && dy && (!squares.has(tileKey(t.tx + dx, t.ty)) || !squares.has(tileKey(t.tx, t.ty + dy)))) continue;
      seen.add(k);
      queue.push({ tx: t.tx + dx, ty: t.ty + dy });
    }
  }
  return seen;
}

/**
 * The barnyard's layout off its area's zones. Every work square faces the solid thing beside it (the barn,
 * the well, the trough); a milker faces her cow and a field hand faces the plot.
 */
export function barnLayout(area: BarnArea): BarnLayout {
  const grid = barnGrid(area);
  const byTag = new Map<string, Tile[]>();
  for (const z of area.zones) {
    const had = byTag.get(z.tag) ?? [];
    for (const t of tilesOf(z, area.tile)) if (!had.some((h) => h.tx === t.tx && h.ty === t.ty)) had.push(t);
    byTag.set(z.tag, had);
  }
  const solid = (tx: number, ty: number) => grid.blocked.has(tileKey(tx, ty));
  // Every square someone stands on to work, or an animal to eat, drink, be milked or go in, has to be open,
  // and so does every square of the field.
  for (const [tag, tiles] of byTag) {
    if (!/^(barn:|well$|heap$|post(:|$)|break$|nest$|roost$|gate:|aisle:|trough:|eat:|drink:|muck:|stand:|stall:|catch:|bed:|wallow:|plot(:|$))/.test(tag)) continue;
    const shut = tiles.find((t) => solid(t.tx, t.ty));
    if (shut) throw new Error(`The barnyard's ${tag} square at ${shut.tx},${shut.ty} is under something solid`);
  }
  const facingSolid = (t: Tile, fallback: Dir = "up"): Dir => {
    if (solid(t.tx, t.ty - 1)) return "up";
    if (solid(t.tx, t.ty + 1)) return "down";
    if (solid(t.tx - 1, t.ty)) return "left";
    if (solid(t.tx + 1, t.ty)) return "right";
    return fallback;
  };
  const spot = (t: Tile, facing?: Dir): Spot => ({ ...t, facing: facing ?? facingSolid(t) });
  const all = (tag: string): Tile[] => byTag.get(tag) ?? [];
  const some = (tag: string): Spot[] => {
    const tiles = all(tag);
    if (tiles.length === 0) throw new Error(`The barnyard has no ${tag} square`);
    return tiles.map((t) => spot(t));
  };
  const one = (tag: string): Spot => some(tag)[0];
  /** `<kind>:1`, `<kind>:2`, ... in order. */
  const numbered = (kind: string): string[] =>
    [...byTag.keys()]
      .filter((k) => new RegExp(`^${kind}:\\d+$`).test(k))
      .sort((a, b) => Number(a.slice(kind.length + 1)) - Number(b.slice(kind.length + 1)));

  // A cow stands side on to her milking post, with the milker sat at her flank.
  const stands: Stand[] = numbered("stand").map((tag) => {
    const cow = all(tag)[0];
    const hand = all(`${tag}:hand`)[0];
    if (!hand) throw new Error(`Milking ${tag} has nowhere for the milker to sit`);
    return { cow: spot(cow), hand: { ...hand, facing: faceToward(hand, cow, "up") } };
  });
  // A horse faces out of her stall, and the groom beside her faces her; by the gate she faces whoever comes.
  const horseSpots = (kind: string, facing: (horse: Tile, hand: Tile) => Dir): HorseSpot[] =>
    numbered(kind).map((tag) => {
      const horse = all(tag)[0];
      const hand = all(`${tag}:hand`)[0];
      if (!hand) throw new Error(`The ${tag} square has nowhere beside it for a hand`);
      return { horse: { ...horse, facing: facing(horse, hand) }, hand: { ...hand, facing: faceToward(hand, horse, "up") } };
    });
  const stalls = horseSpots("stall", () => "down");
  const catches = horseSpots("catch", (horse, hand) => faceToward(horse, hand, "up"));

  const nest = all("nest")[0];
  const roost = all("roost")[0];
  // Squares only people use: the animals keep off them. An `aisle:` is the way in from a pen's gate to its
  // troughs, kept clear so a hand isn't stood waiting behind a pig with nowhere to go.
  const staffOnly = new Set<string>(
    [...byTag.entries()]
      .filter(([tag]) => /^(gate:|aisle:|trough:|muck:|stand:\d+:hand$|stall:|catch:\d+:hand$|nest$|post(:|$)|break$|well$|heap$|barn:)/.test(tag))
      .flatMap(([, tiles]) => tiles.map(keyOf)),
  );

  const pens: PenLayout[] = [];
  for (const tag of [...byTag.keys()].filter((k) => k.startsWith("pen:")).sort()) {
    const id = tag.slice(4);
    const kind = PEN_KIND[id];
    if (!kind) throw new Error(`The barnyard has a pen nobody lives in: ${id}`);
    const inPen = new Set(all(tag).map(keyOf));
    // The animals come to a trough from the pen side, and from its two ends as well where those are open
    // ground, so a big herd isn't queueing for a square or two.
    const round = (at: Spot[], also: readonly Spot[] = []): Spot[] => {
      const trough = at.map((s) => ({ tx: s.tx + STEP[s.facing][0], ty: s.ty + STEP[s.facing][1] })).filter((t) => solid(t.tx, t.ty));
      if (trough.length === 0 || trough.some((t) => t.ty !== trough[0].ty)) return at;
      const xs = trough.map((t) => t.tx);
      const ends = [
        { tx: Math.min(...xs) - 1, ty: trough[0].ty, facing: "right" as Dir },
        { tx: Math.max(...xs) + 1, ty: trough[0].ty, facing: "left" as Dir },
      ];
      const had = new Set([...at, ...also].map(keyOf));
      return [...at, ...ends.filter((t) => inPen.has(keyOf(t)) && !solid(t.tx, t.ty) && !staffOnly.has(keyOf(t)) && !had.has(keyOf(t)))];
    };
    // A cow or a horse at the end of a trough would lie across the one at its side, so theirs are fed from
    // the pen side only.
    const long = LONG_KINDS.has(kind);
    const eat = long ? some(`eat:${id}`) : round(some(`eat:${id}`));
    const drink = long ? some(`drink:${id}`) : round(some(`drink:${id}`), eat);
    // A hand fills a trough facing it: the solid square the animals at it face.
    const filling = (tag: string, at: Spot[]): Spot => {
      const t = one(tag);
      const trough = at.map((s) => ({ tx: s.tx + STEP[s.facing][0], ty: s.ty + STEP[s.facing][1] })).find((b) => Math.abs(b.tx - t.tx) + Math.abs(b.ty - t.ty) === 1);
      return trough ? { ...t, facing: faceToward(t, trough, t.facing) } : t;
    };
    const set = new Set([...eat, ...drink, ...stands.map((s) => s.cow), ...catches.map((c) => c.horse), ...(roost ? [roost] : [])].map(keyOf));
    const open = all(tag).filter((t) => !solid(t.tx, t.ty) && !staffOnly.has(keyOf(t)) && !set.has(keyOf(t)));
    // Only the ground that joins up with the troughs: a pocket shut in by a pond, a tree and the reeds would
    // strand an animal put there.
    const joined = reachable(eat, new Set([...open.map(keyOf), ...[...set].filter((k) => inPen.has(k))]));
    const ground = open.filter((t) => joined.has(keyOf(t)));
    if (ground.length === 0) throw new Error(`Pen ${id} has no open ground`);
    const onGround = (tag: string): Spot[] => {
      const out = all(tag).map((t) => spot(t, "down"));
      const off = out.find((t) => !ground.some((g) => g.tx === t.tx && g.ty === t.ty));
      if (off) throw new Error(`Pen ${id}'s ${tag.split(":")[0]} square at ${off.tx},${off.ty} isn't open ground in the pen`);
      return out;
    };
    pens.push({
      id,
      kind,
      ground,
      feed: filling(`trough:${id}:feed`, eat),
      water: filling(`trough:${id}:water`, drink),
      eat,
      drink,
      muck: some(`muck:${id}`),
      wallow: onGround(`wallow:${id}`),
      bed: onGround(`bed:${id}`),
    });
  }
  if (pens.length === 0) throw new Error("The barnyard has no pens");
  if (pens.some((p) => p.kind === "hen") && (!nest || !roost)) throw new Error("The coop needs a nest square and a roost");
  if (pens.some((p) => p.kind === "cow") && stands.length === 0) throw new Error("The cattle need a milking stand");
  if (pens.some((p) => p.kind === "horse") && (stalls.length === 0 || catches.length === 0)) {
    throw new Error("The horses need stalls, and somewhere by the paddock gate to be caught");
  }

  // A bare `plot` is wheat; `plot:<crop>` says what's grown there.
  const plotTiles = [...byTag.entries()]
    .filter(([tag]) => tag === "plot" || tag.startsWith("plot:"))
    .flatMap(([tag, tiles]) => tiles.map((at) => ({ at, crop: tag === "plot" ? "wheat" : tag.slice(5) })));
  const isPlot = new Set(plotTiles.map((p) => keyOf(p.at)));
  const open = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < area.width && ty < area.height && !solid(tx, ty) && !isPlot.has(tileKey(tx, ty));
  const plots: Plot[] = plotTiles.map(({ at, crop }) => {
    // From the furrow: below the bed's bottom row, above its top row, looking at the crop the way the farmer
    // works a bed. A plot with neither is worked from the side.
    const from = [[0, 1], [0, -1], [-1, 0], [1, 0]].map(([dx, dy]) => ({ tx: at.tx + dx, ty: at.ty + dy })).find((t) => open(t.tx, t.ty));
    if (!from) throw new Error(`The plot at ${at.tx},${at.ty} can't be worked from anywhere`);
    return { id: keyOf(at), crop, at, work: { ...from, facing: faceToward(from, at, "up") } };
  });
  const waiting = (tag: string): Spot[] => all(tag).map((t) => ({ ...t, facing: "down" as Dir }));
  const jobPosts: Record<FarmJob, Spot[]> = {
    hand: waiting("post:hand"),
    dairy: waiting("post:dairy"),
    field: waiting("post:field"),
    stable: waiting("post:stable"),
  };
  if (waiting("post").length + Object.values(jobPosts).reduce((n, p) => n + p.length, 0) === 0) throw new Error("The barnyard has no post square");

  const breakTile = all("break")[0];
  return {
    feedStore: some("barn:feed"),
    dairy: some("barn:dairy"),
    well: some("well"),
    heap: some("heap"),
    jobPosts,
    posts: waiting("post"),
    breakSpot: breakTile ? spot(breakTile, "down") : null,
    pens,
    nest: nest ? spot(nest) : null,
    roost: roost ?? null,
    stands,
    stalls,
    catches,
    plots,
  };
}

/**
 * Walls round everything but the given squares: how an animal sees the map. `Set.has` is all routing asks.
 */
class Outside extends Set<string> {
  constructor(private readonly inside: ReadonlySet<string>) {
    super();
  }

  override has(key: string): boolean {
    return !this.inside.has(key);
  }
}

export class Barnsite {
  readonly board = new Board();
  readonly yard: BarnYard;
  private readonly workers: Worker<FarmJob>[] = [];
  /** How the crew gets about: round the crop, never across it. */
  private readonly route: Router;
  private readonly tuning: BarnsiteTuning;
  private readonly random: () => number;
  private readonly hourAt: (now: number) => number;
  private events: BarnEvent[] = [];
  private now = 0;

  constructor(
    readonly layout: BarnLayout,
    grid: Grid,
    options: {
      seed: number;
      tuning?: BarnsiteTuning;
      /** The hour of the day (0 to 24) at a given site time; by default a day from 6 AM, an hour a minute. */
      hourAt?: (now: number) => number;
    },
  ) {
    const tuning = (this.tuning = options.tuning ?? BARN_TUNING);
    const crops = new Set(layout.plots.map((p) => keyOf(p.at)));
    this.route = gridRouter({ ...grid, blocked: new Set([...grid.blocked, ...crops]) });
    this.random = mulberry32(options.seed);
    this.hourAt = options.hourAt ?? ((now) => (6 + now / tuning.hourMs) % 24);
    this.yard = new BarnYard(
      layout,
      tuning,
      (event) => {
        this.events.push(event);
      },
      this.random,
      (squares) => gridRouter({ ...grid, blocked: new Outside(new Set([...squares].filter((k) => !grid.blocked.has(k)))) }),
      this.hourAt,
      this.route,
    );
  }

  /**
   * Take someone on. They wait at the next free post for their own job (`post:hand` by the hay stack,
   * `post:dairy` by the barn doors, `post:field` at the tool shed, `post:stable` in the stable yard), or a
   * spare `post` once those are all taken, and start there. Their first look at the board is staggered from the last hire's.
   */
  hire(name: string, job: FarmJob, sprite: string, profile: WorkerProfile = DEFAULT_PROFILE): void {
    if (this.workers.some((w) => w.name === name)) throw new Error(`${name} is already on the crew`);
    const taken = new Set(this.workers.flatMap((w) => (w.home ? [keyOf(w.home)] : [])));
    const post = [...this.layout.jobPosts[job], ...this.layout.posts].find((p) => !taken.has(keyOf(p)));
    if (!post) throw new Error(`There's no post left for another ${job} hand`);
    // A field hand keeps to a furrow no one else is in (work-barn.ts `furrowFree`), and a stable hand to the
    // horses and their paddock.
    const mine =
      job === "field" ? (task: Task) => this.yard.furrowFree(task, name) : job === "stable" ? (task: Task) => this.yard.forTheHorses(task) : undefined;
    this.workers.push(new Worker<FarmJob>(name, job, sprite, post, this.now + (this.workers.length % 4) * 125, profile, post, mine));
  }

  /** Move the site on by `dt` ms. Returns what happened, oldest first. */
  step(dt: number): BarnsiteEvent[] {
    this.now += dt;
    const walkers = () => new Crowd([...this.workers.map((w) => w.walker), ...this.yard.walkers()]);
    this.yard.tick(this.board, this.now, dt, walkers());
    const planner = (task: Task, worker: Worker<FarmJob>): Plan<FarmJob> | null => this.yard.plan(task, worker);
    // Rebuilt after the yard's turn: hens went in or came out.
    const everyone = walkers();
    for (const worker of this.workers) {
      const wear = this.workers.some((w) => w !== worker && w.has("brisk")) ? 1.2 : 1;
      worker.step(this.now, dt, {
        board: this.board,
        route: this.route,
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

  hour(): number {
    return this.hourAt(this.now);
  }

  view(): BarnsiteView {
    const hour = this.hour();
    return {
      workers: this.workers.map((w) => ({ ...w.view(), job: w.job, energy: w.energy, onBreak: w.onBreak })),
      animals: this.yard.view(this.now),
      troughs: this.yard.troughView(),
      plots: this.yard.plotView(),
      pens: this.yard.penView(),
      feedStore: this.yard.feedStore,
      nestEggs: this.yard.nestEggs,
      dairy: { ...this.yard.dairy },
      working: hour >= this.tuning.shift[0] && hour < this.tuning.shift[1],
      notes: this.board.all(),
    };
  }
}
