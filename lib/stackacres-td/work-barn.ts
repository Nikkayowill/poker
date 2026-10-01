/**
 * A mixed farm's barnyard: the pens and their animals, the troughs, the nest boxes, the milking stands, the
 * stable and the crop field. The farm crew (work-crew.ts) do the work it posts on the board, the way the
 * grocery's staff do (work-store.ts).
 *
 * The day runs the way a small farm's does:
 *
 * - Hens, sheep, cows and pigs live in their pens and never leave them. They graze, root or peck about, and
 *   go to the trough when they're hungry or thirsty, if there's anything in it. Eating and drinking empties
 *   the trough; a trough running low posts "fill me" and a stock hand brings a sack from the feed store or a
 *   pail from the well. Sheep, cows and horses graze by day, so they need less from the trough than at night.
 * - The pens get dirty with the animals in them, and a stock hand or a stable hand forks each out to the
 *   nearest muck heap. Pigs dirty theirs fastest.
 * - Hens lay through the morning into the nest boxes, and the dairy hand collects the eggs once there are a
 *   few waiting (and sweeps up what's left in the afternoon), carrying them to the dairy.
 * - Cows are milked twice a day, early and late. In each milking window a cow walks herself to a free
 *   milking stand and waits there; the dairy hand milks her and carries the pail to the dairy. A cow kept
 *   waiting gets restless.
 * - Each sow has her piglets, who keep close to her all day and bed down beside her at night. Through the
 *   heat of the day the sows go and lie in the wallow for a while.
 * - The horses spend the night in their stalls. In the morning a stable hand grooms each in her stall and
 *   leads her out to the paddock on a rope, where she gallops off before she settles to graze. In the evening
 *   the horses come and wait by the paddock gate, and a stable hand leads each back in to her stall. A horse
 *   nobody fetches spends the night out in the paddock.
 * - At dusk the hens go in through their door for the night, the pigs go to their beds by the ark, and the
 *   sheep and cows settle where they are.
 * - The field grows the feed: wheat, and corn, which is a bigger plant and slower to come on. Plots go from
 *   sown to ripe over the daylight hours, a field hand brings in the ripe ones a few at a time and stacks the
 *   sheaves on the feed store, a few sheaves to a sack, and sows the empty ones again. Every trough of feed
 *   takes a sack from that store, so a farm with nobody in the field runs out.
 *
 * The crew only works their shift; notes nobody has taken come down at the end of it.
 *
 * Nothing here reads the wall clock or Math.random: time only moves through `tick`, randomness comes from
 * the site's seed, and it holds no Gold. Pure, tested without Phaser (barnsite.test.ts).
 */

import type { Dir } from "./npc-routine";
import {
  keyOf,
  makeWay,
  sameTile,
  stepWalk,
  walkAmong,
  type Board,
  type Crowd,
  type FarmJob,
  type Router,
  type Task,
  type Tile,
  type Walker,
} from "./work-board";
import type { Leg, Plan, Worker } from "./work-crew";
import type { Spot } from "./work-store";

export type AnimalKind = "hen" | "sheep" | "cow" | "pig" | "horse";

/** Which animals live in a pen, by the pen's id on the map. */
export const PEN_KIND: Readonly<Record<string, AnimalKind>> = { coop: "hen", sheep: "sheep", cattle: "cow", sty: "pig", paddock: "horse" };

export interface PenLayout {
  id: string;
  kind: AnimalKind;
  /** The ground they wander and graze, trough and stand squares left out. */
  ground: Tile[];
  /** Where a hand stands to fill the feed trough, and the water trough. */
  feed: Spot;
  water: Spot;
  /** The squares the animals stand on to eat and to drink, each facing the trough. */
  eat: Spot[];
  drink: Spot[];
  /** Where a hand stands to muck the pen out. */
  muck: Spot[];
  /** Where pigs lie in the mud through the heat of the day, and where they bed down at night. */
  wallow: Spot[];
  bed: Spot[];
}

/** A milking stand: where the cow stands, and where the dairy hand sits beside her. */
export interface Stand {
  cow: Spot;
  hand: Spot;
}

/** A horse's place and the place of whoever sees to her beside it: a stall in the stable, or a square by the
 *  paddock gate where she waits to be brought in. */
export interface HorseSpot {
  horse: Spot;
  hand: Spot;
}

/** A square of the field, what's grown on it, and the square beside it it's worked from. */
export interface Plot {
  id: string;
  crop: string;
  at: Tile;
  work: Spot;
}

export interface BarnLayout {
  /** In front of the feed store (the barn's hay stack, and the stable's feed room), where sacks are
   *  fetched and the harvest is stacked. */
  feedStore: Spot[];
  /** Where milk and eggs are taken in. */
  dairy: Spot[];
  well: Spot[];
  heap: Spot[];
  /** Where each job waits with nothing to do, and spare squares for anyone once those are taken. */
  jobPosts: Readonly<Record<FarmJob, Spot[]>>;
  posts: Spot[];
  breakSpot: Spot | null;
  pens: PenLayout[];
  /** Where the dairy hand stands at the nest boxes, and the hens' door into the coop. */
  nest: Spot | null;
  roost: Tile | null;
  stands: Stand[];
  /** The stable's stalls, a horse to each, and where the horses wait by the paddock gate at evening. */
  stalls: HorseSpot[];
  catches: HorseSpot[];
  plots: Plot[];
}

export interface BarnTuning {
  /** Game ms in a game hour, for the rates below. */
  hourMs: number;
  /** How many animals in a pen of each kind (sows, for the pigs). */
  herd: Readonly<Record<AnimalKind, number>>;
  /** Piglets running with each sow, and the share of her meal one eats. */
  litter: number;
  youngMeal: number;
  animalMsPerTile: Readonly<Record<AnimalKind, number>>;
  /** A horse's pace galloping off when she's turned out, and how far she goes before she settles. */
  gallopMsPerTile: number;
  gallopReach: number;
  /** How far a full stomach or a slaked thirst runs down in an hour awake. */
  hungerPerHour: Readonly<Record<AnimalKind, number>>;
  thirstPerHour: Readonly<Record<AnimalKind, number>>;
  /** Grazing animals by day need this share of what they would from the trough. */
  grazing: number;
  /** Needs and mess run at this share overnight. */
  asleep: number;
  /** Below this they go to the trough. */
  eatBelow: number;
  /** The share of a full trough one animal's meal or drink takes. */
  meal: Readonly<Record<AnimalKind, number>>;
  eatMs: number;
  drinkMs: number;
  /** A trough below this asks to be filled. */
  refillBelow: number;
  /** How dirty one animal makes its pen in an hour (1 is filthy), and when it wants mucking out. */
  dirtPerHour: Readonly<Record<AnimalKind, number>>;
  muckAt: number;
  /** Sacks in the feed store at the start, and the most it holds. */
  feedStart: number;
  feedCap: number;
  fetchMs: number;
  pourMs: number;
  drawMs: number;
  muckMs: number;
  dumpMs: number;
  collectMs: number;
  dropMs: number;
  milkMs: number;
  harvestMs: number;
  sowMs: number;
  stackMs: number;
  /** Brushing a horse down in her stall, and clipping a lead rope on or off. */
  groomMs: number;
  leadMs: number;
  /** A led horse's pace, near enough the hand's, so she keeps a step behind. */
  ledMsPerTile: number;
  /** The milking windows, [from, until) hours. */
  milking: readonly (readonly [number, number])[];
  /** A cow waiting at the stand, or a horse at the gate, longer than this is restless. */
  restlessAfterMs: number;
  /** Hens lay between these hours, one egg each. */
  lay: readonly [number, number];
  /** Eggs waiting that send someone to the nest, and the hour after which any at all do. */
  eggsAt: number;
  eggSweep: number;
  /** Hours the sows go looking for the wallow, [from, until), and how long one lies in it. */
  wallowHours: readonly [number, number];
  wallowMs: number;
  /** The hour from which the horses are groomed and turned out, and the hour from which they come to the
   *  gate to be brought in. */
  turnout: number;
  bringIn: number;
  /** Daylight hours a plot takes over each of sown, sprouted and grown before it's ripe, by crop; wheat's
   *  is the one for anything not listed. */
  stageHours: Readonly<Record<string, number>>;
  /** Most sheaves a field hand carries back at once, and most plots sown in one go. */
  sheaves: number;
  /** Sheaves that make up one sack on the feed store. */
  sheavesPerSack: number;
  sowRun: number;
  /** The crew's working hours, [from, until). */
  shift: readonly [number, number];
  /** Night for the animals, from dusk until the hens come out; the rest are up at `wake` for milking. */
  dusk: number;
  henWake: number;
  wake: number;
  /** Daylight, for the crop, [from, until). */
  daylight: readonly [number, number];
}

export type AnimalAct =
  | "walk"
  | "gallop"
  | "idle"
  | "eat"
  | "drink"
  | "peck"
  | "graze"
  | "root"
  | "wallow"
  | "wait"
  | "milked"
  | "groomed"
  | "led"
  | "stall"
  | "sleep"
  | "inside";
export type AnimalMood = "content" | "hungry" | "thirsty" | "restless";

export interface AnimalView {
  id: string;
  name: string;
  kind: AnimalKind;
  pen: string;
  tile: Tile;
  from: Tile;
  stepMs: number;
  stepLeft: number;
  facing: Dir;
  doing: AnimalAct;
  hunger: number;
  thirst: number;
  mood: AnimalMood;
  /** A piglet, and her mother's id. */
  young?: boolean;
  mother?: string;
  /** A horse's coat, and the name of whoever has her on a lead rope. */
  coat?: string;
  ledBy?: string;
}

export interface TroughView {
  pen: string;
  kind: "feed" | "water";
  level: number;
}

/** 0 bare, 1 sown, 2 sprouted, 3 grown, 4 ripe. */
export type PlotStage = 0 | 1 | 2 | 3 | 4;

export interface PlotView {
  tx: number;
  ty: number;
  crop: string;
  stage: PlotStage;
}

export type BarnEvent =
  | { kind: "fed"; pen: string; by: string }
  | { kind: "watered"; pen: string; by: string }
  | { kind: "mucked"; pen: string; by: string }
  | { kind: "eggs"; by: string; count: number }
  | { kind: "milked"; cow: string; by: string }
  | { kind: "harvested"; by: string; count: number }
  | { kind: "sown"; by: string; plot: string }
  | { kind: "turned-out"; horse: string; by: string }
  | { kind: "brought-in"; horse: string; by: string }
  | { kind: "hungry"; animal: string; pen: string }
  | { kind: "thirsty"; animal: string; pen: string }
  | { kind: "restless"; animal: string }
  | { kind: "feed-out" };

type AnimalState =
  | "PAUSE"
  | "WANDER"
  | "TO_EAT"
  | "EAT"
  | "TO_DRINK"
  | "DRINK"
  | "TO_STAND"
  | "WAIT_MILK"
  | "MILKED"
  | "TO_ROOST"
  | "INSIDE"
  | "TO_BED"
  | "SLEEP"
  | "TO_WALLOW"
  | "WALLOW"
  | "STALLED"
  | "GROOMED"
  | "LED"
  | "TO_STALL"
  | "TO_PADDOCK"
  | "TO_CATCH"
  | "WAIT_CATCH";

interface Pen {
  layout: PenLayout;
  feed: number;
  water: number;
  dirt: number;
  /** How the animals get about: their own pen's squares and nowhere else. */
  route: Router;
  squares: ReadonlySet<string>;
}

interface Animal {
  id: string;
  name: string;
  kind: AnimalKind;
  pen: Pen;
  walker: Walker;
  state: AnimalState;
  goal: Tile | null;
  until: number;
  hunger: number;
  thirst: number;
  /** A cow due at the stand this milking. */
  needsMilk: boolean;
  since: number;
  stand: number | null;
  /** The trough, stand, bed, wallow or catch square they've taken. */
  spot: string | null;
  /** The hour a hen lays today, or null once she has. */
  layAt: number | null;
  /** A piglet's mother. */
  mother: Animal | null;
  /** A horse's coat, her own stall, the catch square she's waiting at, and who has her on a lead rope. */
  coat: string | null;
  stall: number | null;
  catchAt: number | null;
  leader: Worker<FarmJob> | null;
  /** Where her leader stood last, and the square behind them she's heading for. */
  leaderAt: Tile | null;
  follow: Tile | null;
  /** Galloping off after being turned out. */
  galloping: boolean;
  warnedHungry: boolean;
  warnedThirsty: boolean;
  warnedRestless: boolean;
}

interface PlotState {
  layout: Plot;
  stage: PlotStage;
  grown: number;
}

const NAMES: Readonly<Record<AnimalKind, readonly string[]>> = {
  hen: ["Pearl", "Ginger", "Dot", "Maisie", "Hazel", "Pip", "Nutmeg", "Clementine", "Poppy", "Speckles", "Biscuit", "Tansy"],
  sheep: ["Dolly", "Fern", "Bramble", "Willow", "Juniper", "Thistle", "Clover", "Nettle", "Heather", "Moss"],
  cow: ["Daisy", "Bluebell", "Bess", "Buttercup", "Marigold", "Primrose", "Bonnie", "Hollyhock"],
  pig: ["Rosie", "Peony", "Mabel", "Dumpling"],
  horse: ["Duke", "Sable", "Dusty", "Goldie"],
};
const PIGLETS = ["Button", "Sprout", "Pudding", "Bean", "Nibbles", "Pickle", "Waffle", "Tater", "Fig", "Acorn", "Pip", "Muffin"];
/** Each horse's coat, in the order of NAMES.horse (the sheets in public/stackacres-td/animals). */
const COATS = ["bay", "black", "grey", "palomino"];

/** Held up this long wandering, an animal stops where it is; this long on the way to a trough, it gives up for now. */
const WANDER_GIVE_UP_MS = 3000;
const ERRAND_GIVE_UP_MS = 6000;
/** How far an animal wanders in one go, in squares. */
const WANDER_REACH = 4;
/** How near a piglet keeps to her mother, in squares. */
const PIGLET_REACH = 2;
/** How near a field hand looks for the next plot to run on into. */
const FIELD_REACH = 5;
/**
 * How much room, in squares across and up, an animal leaves round another of its pen when it picks
 * somewhere to wander to. A cow or a horse is near three squares long side on, so they spread out; piglets
 * huddle.
 */
const BERTH: Readonly<Record<AnimalKind, readonly [number, number]>> = {
  hen: [1, 1],
  sheep: [2, 1],
  cow: [3, 2],
  pig: [2, 1],
  horse: [3, 2],
};
/** The kinds that graze by day, needing less from the trough. */
const GRAZERS: ReadonlySet<AnimalKind> = new Set(["sheep", "cow", "horse"]);

export class BarnYard {
  feedStore: number;
  /** Sheaves on the stack not yet making up a sack. */
  private loose = 0;
  nestEggs = 0;
  readonly dairy = { milk: 0, eggs: 0 };
  private readonly pens: Pen[];
  private readonly animals: Animal[] = [];
  private readonly plots: PlotState[];
  private readonly plotById: Map<string, PlotState>;
  /** Trough, stand, bed, wallow and catch squares, and which animal has each. */
  private readonly taken = new Map<string, string>();
  private lastWindow = -1;
  private laying = false;
  private onShift = false;
  private warnedFeedOut = false;
  /** The board it last posted to, for claiming the next plot a field hand runs on into. */
  private board: Board | null = null;

  constructor(
    readonly layout: BarnLayout,
    private readonly tuning: BarnTuning,
    private readonly emit: (event: BarnEvent) => void,
    private readonly random: () => number,
    /** How the animals of a pen get about, given the squares they may stand on. */
    penRoute: (squares: ReadonlySet<string>) => Router,
    private readonly hourAt: (now: number) => number,
    /** How a horse gets about off her paddock: led on a rope, or walking into her stall. */
    private readonly route: Router,
  ) {
    this.feedStore = tuning.feedStart;
    this.pens = layout.pens.map((p) => {
      const squares = new Set([...p.ground, ...p.eat, ...p.drink].map(keyOf));
      if (p.kind === "cow") for (const s of layout.stands) squares.add(keyOf(s.cow));
      if (p.kind === "horse") for (const c of layout.catches) squares.add(keyOf(c.horse));
      if (p.kind === "hen" && layout.roost) squares.add(keyOf(layout.roost));
      return { layout: p, feed: 0.6 + random() * 0.4, water: 0.6 + random() * 0.4, dirt: random() * 0.4, route: penRoute(squares), squares };
    });
    for (const pen of this.pens) {
      const free = [...pen.layout.ground];
      const kind = pen.layout.kind;
      const names = NAMES[kind];
      for (let i = 0; i < tuning.herd[kind] && free.length > 0; i++) {
        const name = names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : "");
        const stall = kind === "horse" && i < layout.stalls.length ? i : null;
        const at = stall !== null ? layout.stalls[stall].horse : free.splice(Math.floor(random() * free.length), 1)[0];
        const a = this.newAnimal(`${kind}:${slug(name)}`, name, kind, pen, at);
        if (kind === "horse") {
          a.coat = COATS[i % COATS.length];
          a.stall = stall;
          // The day starts with the horses in, and a turned-out horse spends the night in her stall.
          if (stall !== null) {
            a.state = "STALLED";
            a.walker.facing = layout.stalls[stall].horse.facing;
          }
        }
        this.animals.push(a);
        if (kind !== "pig") continue;
        for (let j = 0; j < tuning.litter && free.length > 0; j++) {
          const k = i * tuning.litter + j;
          const young = PIGLETS[k % PIGLETS.length] + (k >= PIGLETS.length ? ` ${Math.floor(k / PIGLETS.length) + 1}` : "");
          const near = free.filter((t) => Math.max(Math.abs(t.tx - at.tx), Math.abs(t.ty - at.ty)) <= PIGLET_REACH);
          const spot = (near.length > 0 ? near : free)[Math.floor(random() * (near.length > 0 ? near.length : free.length))];
          free.splice(free.indexOf(spot), 1);
          const piglet = this.newAnimal(`piglet:${slug(young)}`, young, kind, pen, spot);
          piglet.mother = a;
          this.animals.push(piglet);
        }
      }
    }
    // A field part way through its season, so there's something to bring in and something to sow.
    this.plots = layout.plots.map((p) => ({ layout: p, stage: Math.floor(random() * 5) as PlotStage, grown: 0 }));
    this.plotById = new Map(this.plots.map((p) => [p.layout.id, p]));
  }

  private newAnimal(id: string, name: string, kind: AnimalKind, pen: Pen, at: Tile): Animal {
    return {
      id,
      name,
      kind,
      pen,
      walker: { tile: at, from: at, path: [], stepMs: 0, stepLeft: 0, facing: this.random() < 0.5 ? "left" : "right", blockedMs: 0, rerouted: false },
      state: "PAUSE",
      goal: null,
      until: this.random() * 4000,
      hunger: 0.6 + this.random() * 0.4,
      thirst: 0.6 + this.random() * 0.4,
      needsMilk: false,
      since: 0,
      stand: null,
      spot: null,
      layAt: null,
      mother: null,
      coat: null,
      stall: null,
      catchAt: null,
      leader: null,
      leaderAt: null,
      follow: null,
      galloping: false,
      warnedHungry: false,
      warnedThirsty: false,
      warnedRestless: false,
    };
  }

  private hours(ms: number): number {
    return ms / this.tuning.hourMs;
  }

  /** Night for everyone but the hens: from dusk until they're up for the morning milking. */
  private night(hour: number): boolean {
    return hour >= this.tuning.dusk || hour < this.tuning.wake;
  }

  private henNight(hour: number): boolean {
    return hour >= this.tuning.dusk || hour < this.tuning.henWake;
  }

  private window(hour: number): number {
    return this.tuning.milking.findIndex(([from, until]) => hour >= from && hour < until);
  }

  tick(board: Board, now: number, dt: number, crowd: Crowd): void {
    this.board = board;
    const hour = this.hourAt(now);
    const t = this.tuning;

    // Each milking, every cow is due at the stand once.
    const w = this.window(hour);
    if (w !== -1 && w !== this.lastWindow) for (const a of this.animals) if (a.kind === "cow") a.needsMilk = true;
    this.lastWindow = w;

    // Each morning every hen lays one egg, at her own time through the laying hours.
    const laying = hour >= t.lay[0] && hour < t.lay[1];
    if (laying && !this.laying) {
      for (const a of this.animals) if (a.kind === "hen") a.layAt = hour + this.random() * (t.lay[1] - hour);
    }
    this.laying = laying;
    for (const a of this.animals) {
      if (a.layAt !== null && hour >= a.layAt && a.state !== "INSIDE") {
        a.layAt = null;
        this.nestEggs += 1;
      }
    }

    // The crop grows by day.
    if (hour >= t.daylight[0] && hour < t.daylight[1]) {
      for (const p of this.plots) {
        if (p.stage === 0 || p.stage === 4) continue;
        p.grown += dt;
        if (p.grown >= (t.stageHours[p.layout.crop] ?? t.stageHours.wheat) * t.hourMs) {
          p.grown = 0;
          p.stage = (p.stage + 1) as PlotStage;
        }
      }
    }

    for (const a of this.animals) this.live(a, now, dt, hour, crowd);

    const onShift = hour >= t.shift[0] && hour < t.shift[1];
    if (!onShift) {
      if (this.onShift) for (const task of board.all()) if (task.claimedBy === null && this.isMine(task)) board.tear(task.key);
      this.onShift = false;
      return;
    }
    this.onShift = true;
    this.post(board, now, hour);
  }

  private isMine(task: Task): boolean {
    return ["feed", "water", "muck", "eggs", "milk", "harvest", "sow", "turnout", "bringin"].includes(task.kind);
  }

  private post(board: Board, now: number, hour: number): void {
    const t = this.tuning;
    for (const pen of this.pens) {
      const id = pen.layout.id;
      if (pen.feed < t.refillBelow) {
        if (this.feedStore > 0) board.post("feed", `feed:${id}`, nearest(this.layout.feedStore, pen.layout.feed), now);
        else if (!this.warnedFeedOut) {
          this.warnedFeedOut = true;
          this.emit({ kind: "feed-out" });
        }
      }
      if (pen.water < t.refillBelow) board.post("water", `water:${id}`, nearest(this.layout.well, pen.layout.water), now);
      if (pen.dirt >= t.muckAt) board.post("muck", `muck:${id}`, pen.layout.muck[0], now);
    }
    if (this.feedStore > 0) this.warnedFeedOut = false;
    if (this.layout.nest && (this.nestEggs >= t.eggsAt || (hour >= t.eggSweep && this.nestEggs > 0))) {
      board.post("eggs", "eggs", this.layout.nest, now);
    }
    const turningOut = hour >= t.turnout && hour < t.bringIn;
    for (const a of this.animals) {
      if (a.state === "WAIT_MILK" && a.stand !== null) board.post("milk", `milk:${a.stand}`, this.layout.stands[a.stand].hand, now);
      if (turningOut && a.state === "STALLED" && a.stall !== null) board.post("turnout", `turnout:${a.stall}`, this.layout.stalls[a.stall].hand, now);
      if (a.state === "WAIT_CATCH" && a.catchAt !== null) board.post("bringin", `bringin:${a.catchAt}`, this.layout.catches[a.catchAt].hand, now);
    }
    for (const p of this.plots) {
      if (p.stage === 4) board.post("harvest", `harvest:${p.layout.id}`, p.layout.work, now);
      if (p.stage === 0) board.post("sow", `sow:${p.layout.id}`, p.layout.work, now);
    }
  }

  walkers(): Walker[] {
    return this.animals.filter((a) => a.state !== "INSIDE").map((a) => a.walker);
  }

  // ---- the animals

  private live(a: Animal, now: number, dt: number, hour: number, crowd: Crowd): void {
    const t = this.tuning;
    const sleeping = a.state === "SLEEP" || a.state === "INSIDE";
    // A horse in her stall has her hay net and bucket.
    const fedInStall = a.state === "STALLED" || a.state === "GROOMED";
    const grazing = GRAZERS.has(a.kind) && !this.night(hour) ? t.grazing : 1;
    const pace = sleeping || fedInStall ? t.asleep : 1;
    if (!fedInStall) {
      a.hunger = Math.max(0, a.hunger - this.hours(dt) * t.hungerPerHour[a.kind] * grazing * pace);
      a.thirst = Math.max(0, a.thirst - this.hours(dt) * t.thirstPerHour[a.kind] * pace);
    }
    a.pen.dirt = Math.min(1, a.pen.dirt + this.hours(dt) * t.dirtPerHour[a.kind] * (a.mother ? 0.5 : 1) * pace);
    this.warn(a);

    const ms = a.galloping ? t.gallopMsPerTile : a.mother ? t.animalMsPerTile.pig * 0.8 : t.animalMsPerTile[a.kind];
    const walk = (giveUp: number, route: Router = a.pen.route): boolean => {
      if (!a.goal) return true;
      if (walkAmong(a.walker, a.goal, dt, ms, crowd, route)) return true;
      if (a.walker.stepLeft === 0 && a.walker.blockedMs >= giveUp) {
        a.walker.path = [];
        a.walker.blockedMs = 0;
        this.letGo(a);
        this.pause(a, now, 1000);
      }
      return false;
    };
    const stepAside = () => {
      if (makeWay(a.walker, crowd, a.pen.route) || a.walker.path.length > 0 || a.walker.stepLeft > 0) {
        walkAmong(a.walker, a.walker.path[a.walker.path.length - 1] ?? a.walker.tile, dt, ms, crowd, a.pen.route);
        return true;
      }
      return false;
    };

    switch (a.state) {
      case "INSIDE": {
        if (this.henNight(hour) || !this.layout.roost) return;
        // Out one at a time, never onto someone standing in the doorway.
        if (crowd.isTaken(this.layout.roost, a.walker) || this.walkers().some((w) => sameTile(w.tile, this.layout.roost!))) return;
        a.walker.tile = { ...this.layout.roost };
        a.walker.from = a.walker.tile;
        this.pause(a, now, 500);
        return;
      }
      case "SLEEP":
        // Bedded down on a square of their own, they don't get up for anyone: the rest go round.
        if (!a.spot) stepAside();
        if (!this.night(hour)) {
          this.letGo(a);
          this.pause(a, now, 500);
        }
        return;
      case "PAUSE":
        if (stepAside()) return;
        if (now >= a.until) this.decide(a, now, hour);
        return;
      case "WANDER":
        if (walk(WANDER_GIVE_UP_MS)) this.pause(a, now, 2500 + this.random() * 6000);
        return;
      case "TO_EAT":
      case "TO_DRINK": {
        if (!walk(ERRAND_GIVE_UP_MS)) return;
        const eating = a.state === "TO_EAT";
        if ((eating ? a.pen.feed : a.pen.water) <= 0) {
          this.letGo(a);
          this.pause(a, now, 1500);
          return;
        }
        a.walker.facing = (a.goal as Spot).facing;
        a.state = eating ? "EAT" : "DRINK";
        a.until = now + (eating ? t.eatMs : t.drinkMs);
        return;
      }
      case "EAT":
      case "DRINK": {
        if (now < a.until) return;
        const eating = a.state === "EAT";
        const share = t.meal[a.kind] * (a.mother ? t.youngMeal : 1);
        const had = Math.min(share, eating ? a.pen.feed : a.pen.water);
        if (eating) {
          a.pen.feed = Math.max(0, a.pen.feed - had);
          a.hunger = Math.min(1, a.hunger + (had / share) * (1 - a.hunger));
        } else {
          a.pen.water = Math.max(0, a.pen.water - had);
          a.thirst = Math.min(1, a.thirst + (had / share) * (1 - a.thirst));
        }
        this.letGo(a);
        this.pause(a, now, 800 + this.random() * 1500);
        return;
      }
      case "TO_STAND":
        if (!walk(ERRAND_GIVE_UP_MS)) return;
        a.walker.facing = (a.goal as Spot).facing;
        a.state = "WAIT_MILK";
        a.since = now;
        return;
      case "WAIT_MILK":
        this.restless(a, now);
        return;
      case "MILKED":
        return;
      case "TO_ROOST":
        if (!walk(ERRAND_GIVE_UP_MS)) return;
        a.state = "INSIDE";
        a.walker.path = [];
        return;
      case "TO_BED":
        if (!walk(ERRAND_GIVE_UP_MS)) {
          // Can't get to the bed: lie down where she is.
          if ((a.state as AnimalState) === "PAUSE" && this.night(hour)) a.state = "SLEEP";
          return;
        }
        if (a.goal && "facing" in a.goal) a.walker.facing = (a.goal as Spot).facing;
        a.state = "SLEEP";
        return;
      case "TO_WALLOW":
        if (!walk(ERRAND_GIVE_UP_MS)) return;
        a.walker.facing = this.random() < 0.5 ? "left" : "right";
        a.state = "WALLOW";
        a.until = now + t.wallowMs * (0.7 + this.random() * 0.6);
        return;
      case "WALLOW":
        if (now < a.until && !this.night(hour)) return;
        this.letGo(a);
        this.pause(a, now, 1000);
        return;

      // ---- the horses' day off the paddock
      case "STALLED":
      case "GROOMED":
        return;
      case "LED": {
        const leader = a.leader;
        if (!leader || leader.holding !== "lead") {
          this.release(a, now, "paddock");
          return;
        }
        // A step behind her leader: whenever they move on, she heads for the square they left.
        if (!a.leaderAt || !sameTile(leader.walker.tile, a.leaderAt)) {
          if (a.leaderAt && !sameTile(a.leaderAt, a.walker.tile)) a.follow = a.leaderAt;
          a.leaderAt = { ...leader.walker.tile };
        }
        if (a.walker.stepLeft === 0 && a.follow && !sameTile(a.follow, a.walker.tile) && a.walker.path.length === 0) {
          a.walker.path = this.route(a.walker.tile, a.follow) ?? [];
        }
        stepWalk(a.walker, dt, t.ledMsPerTile, (next) => !crowd.isTaken(next, a.walker));
        return;
      }
      case "TO_STALL":
      case "TO_PADDOCK": {
        const goal = a.goal;
        if (!goal) {
          this.pause(a, now, 500);
          return;
        }
        if (!walkAmong(a.walker, goal, dt, ms, crowd, this.route)) {
          // Held up a long while (someone in the stall door, a hand in the gateway): find the way afresh.
          if (a.walker.stepLeft === 0 && a.walker.blockedMs >= ERRAND_GIVE_UP_MS) {
            a.walker.blockedMs = 0;
            a.walker.path = this.route(a.walker.tile, goal, crowd.taken(a.walker)) ?? this.route(a.walker.tile, goal) ?? [];
          }
          return;
        }
        if (!sameTile(a.walker.tile, goal)) {
          a.walker.path = this.route(a.walker.tile, goal) ?? [];
          if (a.walker.path.length > 0) return;
        }
        a.galloping = false;
        if (a.state === "TO_STALL" && a.stall !== null && sameTile(a.walker.tile, goal)) {
          a.state = "STALLED";
          a.goal = null;
          a.walker.facing = this.layout.stalls[a.stall].horse.facing;
          return;
        }
        this.pause(a, now, 1500 + this.random() * 2000);
        return;
      }
      case "TO_CATCH":
        if (!walk(ERRAND_GIVE_UP_MS)) return;
        a.walker.facing = (a.goal as Spot).facing;
        a.state = "WAIT_CATCH";
        a.since = now;
        return;
      case "WAIT_CATCH":
        this.restless(a, now);
        // Nobody came for her by the end of the crew's day: she stays out tonight.
        if (hour >= t.shift[1] || hour < t.shift[0]) {
          this.letGo(a);
          a.catchAt = null;
          this.pause(a, now, 1000);
        }
        return;
    }
  }

  private restless(a: Animal, now: number): void {
    if (!a.warnedRestless && now - a.since >= this.tuning.restlessAfterMs) {
      a.warnedRestless = true;
      this.emit({ kind: "restless", animal: a.name });
    }
  }

  private warn(a: Animal): void {
    if (a.hunger < 0.2 && !a.warnedHungry) {
      a.warnedHungry = true;
      this.emit({ kind: "hungry", animal: a.name, pen: a.pen.layout.id });
    }
    if (a.hunger > 0.5) a.warnedHungry = false;
    if (a.thirst < 0.2 && !a.warnedThirsty) {
      a.warnedThirsty = true;
      this.emit({ kind: "thirsty", animal: a.name, pen: a.pen.layout.id });
    }
    if (a.thirst > 0.5) a.warnedThirsty = false;
  }

  private pause(a: Animal, now: number, ms: number): void {
    a.state = "PAUSE";
    a.goal = null;
    a.until = now + ms;
  }

  /** Give back the trough, stand, bed, wallow or catch square they had. */
  private letGo(a: Animal): void {
    if (a.spot && this.taken.get(a.spot) === a.id) this.taken.delete(a.spot);
    a.spot = null;
    a.stand = null;
  }

  private headFor(a: Animal, state: AnimalState, goal: Tile, spot: string | null, route: Router = a.pen.route): boolean {
    const path = sameTile(a.walker.tile, goal) ? [] : route(a.walker.tile, goal);
    if (!path) return false;
    if (spot) {
      this.taken.set(spot, a.id);
      a.spot = spot;
    }
    a.walker.path = path;
    a.goal = goal;
    a.state = state;
    return true;
  }

  private freeSquare(spots: readonly Spot[], a: Animal): Spot | null {
    const free = spots.filter((s) => !this.taken.has(keyOf(s)));
    if (free.length === 0) return null;
    return nearest(free, a.walker.tile);
  }

  /** Off the lead: into her stall, or off into the paddock, galloping after a morning in. */
  private release(a: Animal, now: number, to: "stall" | "paddock"): void {
    a.leader = null;
    a.leaderAt = null;
    a.follow = null;
    a.walker.path = [];
    if (to === "stall" && a.stall !== null) {
      a.goal = this.layout.stalls[a.stall].horse;
      a.state = "TO_STALL";
      a.walker.path = sameTile(a.walker.tile, a.goal) ? [] : (this.route(a.walker.tile, a.goal) ?? []);
      return;
    }
    const gate = this.layout.catches[0]?.hand ?? a.walker.tile;
    const far = a.pen.layout.ground.filter((g) => Math.max(Math.abs(g.tx - gate.tx), Math.abs(g.ty - gate.ty)) >= this.tuning.gallopReach);
    const choices = far.length > 0 ? far : a.pen.layout.ground;
    const spot = choices[Math.floor(this.random() * choices.length)];
    a.galloping = far.length > 0;
    if (!spot || !this.headFor(a, "TO_PADDOCK", spot, null, this.route)) this.pause(a, now, 1000);
  }

  /** Standing about with nothing on: what next. */
  private decide(a: Animal, now: number, hour: number): void {
    const t = this.tuning;
    // A horse that's somehow off her paddock (let go at the gate) walks back into it.
    if (a.kind === "horse" && !a.pen.squares.has(keyOf(a.walker.tile))) {
      const back = nearest(a.pen.layout.ground, a.walker.tile);
      if (this.headFor(a, "TO_PADDOCK", back, null, this.route)) return;
    }
    if (a.kind === "hen" && this.henNight(hour) && this.layout.roost) {
      if (this.headFor(a, "TO_ROOST", this.layout.roost, null)) return;
    }
    // Horses with a stall wait by the gate at evening to be brought in, until the crew's day is done.
    if (a.kind === "horse" && a.stall !== null && hour >= t.bringIn && hour < t.shift[1] - 1) {
      const n = this.layout.catches.findIndex((c) => !this.taken.has(keyOf(c.horse)));
      if (n !== -1 && this.headFor(a, "TO_CATCH", this.layout.catches[n].horse, keyOf(this.layout.catches[n].horse))) {
        a.catchAt = n;
        a.warnedRestless = false;
        return;
      }
    }
    if (a.kind !== "hen" && this.night(hour)) {
      // The piglets wait up until the sows have all lain down, then lie down beside their mothers.
      if (a.mother && this.animals.some((o) => o.pen === a.pen && !o.mother && o.state !== "SLEEP")) {
        this.pause(a, now, 600);
        return;
      }
      if (a.kind === "pig" && this.toBed(a)) return;
      a.state = "SLEEP";
      return;
    }
    // A thirsty cow has a drink on her way to be milked: the wait at the post can be a long one.
    if (a.kind === "cow" && a.needsMilk && a.thirst < t.eatBelow && a.pen.water > 0) {
      const s = this.freeSquare(a.pen.layout.drink, a);
      if (s && this.headFor(a, "TO_DRINK", s, keyOf(s))) return;
    }
    if (a.kind === "cow" && a.needsMilk) {
      const n = this.layout.stands.findIndex((s) => !this.taken.has(keyOf(s.cow)));
      if (n !== -1 && this.headFor(a, "TO_STAND", this.layout.stands[n].cow, keyOf(this.layout.stands[n].cow))) {
        a.stand = n;
        a.warnedRestless = false;
        return;
      }
    }
    const thirsty = a.thirst < t.eatBelow && a.pen.water > 0;
    const hungry = a.hunger < t.eatBelow && a.pen.feed > 0;
    // The worse of the two first.
    const order: ("drink" | "eat")[] = a.thirst <= a.hunger ? ["drink", "eat"] : ["eat", "drink"];
    for (const need of order) {
      if (need === "drink" && thirsty) {
        const s = this.freeSquare(a.pen.layout.drink, a);
        if (s && this.headFor(a, "TO_DRINK", s, keyOf(s))) return;
      }
      if (need === "eat" && hungry) {
        const s = this.freeSquare(a.pen.layout.eat, a);
        if (s && this.headFor(a, "TO_EAT", s, keyOf(s))) return;
      }
    }
    // A sow with nothing wanting lies in the wallow a while through the heat of the day.
    const content = a.hunger >= t.eatBelow && a.thirst >= t.eatBelow;
    if (a.kind === "pig" && !a.mother && content && hour >= t.wallowHours[0] && hour < t.wallowHours[1] && this.random() < 0.4) {
      const s = this.freeSquare(a.pen.layout.wallow, a);
      if (s && this.headFor(a, "TO_WALLOW", s, keyOf(s))) return;
    }
    // Graze where they stand a while, or wander a few squares.
    if (this.random() < 0.35) {
      this.pause(a, now, 2000 + this.random() * 4000);
      return;
    }
    // A piglet never strays far from her mother.
    const centre = a.mother ? (a.mother.goal ?? a.mother.walker.tile) : a.walker.tile;
    const reach = a.mother ? PIGLET_REACH : WANDER_REACH;
    const near = a.pen.layout.ground.filter(
      (g) => Math.abs(g.tx - centre.tx) <= reach && Math.abs(g.ty - centre.ty) <= reach && !sameTile(g, a.walker.tile),
    );
    const roomy = near.filter((g) => this.roomFor(a, g));
    const pick = roomy.length > 0 ? roomy : near;
    const to = pick[Math.floor(this.random() * pick.length)];
    if (!to || !this.headFor(a, "WANDER", to, null)) this.pause(a, now, 1500);
  }

  /** Whether `g` leaves the animal its berth from everyone else in its pen (piglets don't mind each other). */
  private roomFor(a: Animal, g: Tile): boolean {
    const [across, up] = a.mother ? [1, 1] : BERTH[a.kind];
    for (const o of this.animals) {
      if (o === a || o.pen !== a.pen || (a.mother && o.mother)) continue;
      for (const at of [o.walker.tile, o.goal]) {
        if (at && Math.abs(at.tx - g.tx) < across && Math.abs(at.ty - g.ty) < up) return false;
      }
    }
    return true;
  }

  /** A sow to a bed by the ark, a piglet to a square beside her mother's. */
  private toBed(a: Animal): boolean {
    if (!a.mother) {
      const s = this.freeSquare(a.pen.layout.bed, a);
      return s !== null && this.headFor(a, "TO_BED", s, keyOf(s));
    }
    // Right beside her if there's room, or as near as there is when her brothers and sisters have the rest.
    // Never in a sow's bed.
    const by = a.mother.goal ?? a.mother.walker.tile;
    const beds = new Set(a.pen.layout.bed.map(keyOf));
    for (const reach of [1, 2]) {
      const beside = a.pen.layout.ground.filter((g) => {
        const d = Math.max(Math.abs(g.tx - by.tx), Math.abs(g.ty - by.ty));
        return d > 0 && d <= reach && !this.taken.has(keyOf(g)) && !beds.has(keyOf(g));
      });
      if (beside.length === 0) continue;
      const s = nearest(beside, by);
      return this.headFor(a, "TO_BED", s, keyOf(s));
    }
    return false;
  }

  private doingOf(a: Animal, hour: number): AnimalAct {
    const moving = a.walker.stepLeft > 0 || a.walker.path.length > 0;
    switch (a.state) {
      case "INSIDE":
        return "inside";
      case "SLEEP":
        return "sleep";
      case "EAT":
        return "eat";
      case "DRINK":
        return "drink";
      case "WAIT_MILK":
      case "WAIT_CATCH":
        return "wait";
      case "MILKED":
        return "milked";
      case "WALLOW":
        return "wallow";
      case "STALLED":
        return this.night(hour) ? "sleep" : "stall";
      case "GROOMED":
        return "groomed";
      case "LED":
        return moving ? "walk" : "led";
      default: {
        if (moving) return a.galloping ? "gallop" : "walk";
        if (a.kind === "hen") return "peck";
        if (a.kind === "pig") return "root";
        return this.night(hour) ? "idle" : "graze";
      }
    }
  }

  private moodOf(a: Animal, now: number): AnimalMood {
    if ((a.state === "WAIT_MILK" || a.state === "WAIT_CATCH") && now - a.since >= this.tuning.restlessAfterMs) return "restless";
    if (a.thirst < 0.25) return "thirsty";
    if (a.hunger < 0.25) return "hungry";
    return "content";
  }

  // ---- the crew's jobs

  plan(task: Task, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    const [kind, id] = [task.kind, task.key.slice(task.key.indexOf(":") + 1)];
    if (kind === "feed") return this.feedPlan(this.pen(id), worker);
    if (kind === "water") return this.waterPlan(this.pen(id), worker);
    if (kind === "muck") return this.muckPlan(this.pen(id), worker);
    if (kind === "eggs") return this.eggsPlan(worker);
    if (kind === "milk") return this.milkPlan(Number(id), worker);
    if (kind === "harvest") return this.harvestPlan(this.plot(id), worker);
    if (kind === "sow") return this.sowPlan(this.plot(id), worker);
    if (kind === "turnout") return this.turnoutPlan(Number(id), worker);
    if (kind === "bringin") return this.bringInPlan(Number(id), worker);
    return null;
  }

  private pen(id: string): Pen | undefined {
    return this.pens.find((p) => p.layout.id === id);
  }

  private plot(id: string): PlotState | undefined {
    return this.plotById.get(id);
  }

  private feedPlan(pen: Pen | undefined, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    if (!pen) return null;
    const store = nearest(this.layout.feedStore, pen.layout.feed);
    const trough = pen.layout.feed;
    return {
      giveBack: (count) => {
        this.feedStore += count;
      },
      legs: [
        {
          at: store,
          facing: store.facing,
          doing: "reach",
          around: true,
          ms: this.tuning.fetchMs,
          ready: () => this.feedStore > 0 && pen.feed < 1,
          // The sack is theirs the moment they reach for it, so two hands at the stack can't both take the last.
          start: () => {
            this.feedStore -= 1;
          },
          finish: () => {
            worker.carrying = 1;
            worker.holding = "feed";
          },
        },
        {
          at: trough,
          facing: trough.facing,
          doing: "pour",
          around: true,
          ms: this.tuning.pourMs,
          ready: () => true,
          finish: () => {
            pen.feed = 1;
            drop(worker);
            this.emit({ kind: "fed", pen: pen.layout.id, by: worker.name });
          },
        },
      ],
    };
  }

  private waterPlan(pen: Pen | undefined, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    if (!pen) return null;
    const well = nearest(this.layout.well, pen.layout.water);
    const trough = pen.layout.water;
    return {
      giveBack: () => {},
      legs: [
        {
          at: well,
          facing: well.facing,
          doing: "reach",
          around: true,
          ms: this.tuning.drawMs,
          ready: () => pen.water < 1,
          finish: () => {
            worker.carrying = 1;
            worker.holding = "water";
          },
        },
        {
          at: trough,
          facing: trough.facing,
          doing: "pour",
          around: true,
          ms: this.tuning.pourMs,
          ready: () => true,
          finish: () => {
            pen.water = 1;
            drop(worker);
            this.emit({ kind: "watered", pen: pen.layout.id, by: worker.name });
          },
        },
      ],
    };
  }

  private muckPlan(pen: Pen | undefined, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    if (!pen) return null;
    const spot = nearest(pen.layout.muck, worker.walker.tile);
    const heap = nearest(this.layout.heap, spot);
    return {
      giveBack: () => {},
      legs: [
        {
          at: spot,
          facing: spot.facing,
          doing: "muck",
          around: true,
          ms: this.tuning.muckMs,
          ready: () => pen.dirt > 0.2,
          finish: () => {
            pen.dirt = 0;
            worker.carrying = 1;
            worker.holding = "muck";
            this.emit({ kind: "mucked", pen: pen.layout.id, by: worker.name });
          },
        },
        {
          at: heap,
          facing: heap.facing,
          doing: "give",
          around: true,
          ms: this.tuning.dumpMs,
          ready: () => true,
          finish: () => drop(worker),
        },
      ],
    };
  }

  private eggsPlan(worker: Worker<FarmJob>): Plan<FarmJob> | null {
    const nest = this.layout.nest;
    if (!nest) return null;
    const dairy = nearest(this.layout.dairy, nest);
    return {
      giveBack: (count) => {
        this.nestEggs += count;
      },
      legs: [
        {
          at: nest,
          facing: nest.facing,
          doing: "harvest",
          around: true,
          ms: this.tuning.collectMs,
          ready: () => this.nestEggs > 0,
          finish: () => {
            worker.carrying = this.nestEggs;
            worker.holding = "eggs";
            this.nestEggs = 0;
          },
        },
        {
          at: dairy,
          facing: dairy.facing,
          doing: "give",
          around: true,
          ms: this.tuning.dropMs,
          ready: () => true,
          finish: () => {
            this.dairy.eggs += worker.carrying;
            this.emit({ kind: "eggs", by: worker.name, count: worker.carrying });
            drop(worker);
          },
        },
      ],
    };
  }

  private milkPlan(n: number, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    const stand = this.layout.stands[n];
    if (!stand) return null;
    const cowAt = () => this.animals.find((a) => a.stand === n && (a.state === "WAIT_MILK" || a.state === "MILKED"));
    const dairy = nearest(this.layout.dairy, stand.hand);
    let cow: Animal | undefined;
    return {
      giveBack: (count) => {
        this.dairy.milk += count;
      },
      legs: [
        {
          at: stand.hand,
          facing: stand.hand.facing,
          doing: "milk",
          ms: this.tuning.milkMs,
          ready: () => {
            cow = cowAt();
            return cow !== undefined && cow.state === "WAIT_MILK";
          },
          start: () => {
            if (cow) cow.state = "MILKED";
          },
          finish: (now) => {
            worker.carrying = 1;
            worker.holding = "milk";
            if (!cow) return;
            cow.needsMilk = false;
            cow.warnedRestless = false;
            this.letGo(cow);
            this.pause(cow, now, 600);
          },
        },
        {
          at: dairy,
          facing: dairy.facing,
          doing: "give",
          around: true,
          ms: this.tuning.dropMs,
          ready: () => true,
          finish: () => {
            this.dairy.milk += 1;
            this.emit({ kind: "milked", cow: cow?.name ?? "a cow", by: worker.name });
            drop(worker);
          },
        },
      ],
    };
  }

  /** Clip the lead rope on: the horse walks a step behind `worker` from here. */
  private lead(horse: Animal, worker: Worker<FarmJob>): void {
    horse.state = "LED";
    horse.leader = worker;
    horse.leaderAt = { ...worker.walker.tile };
    horse.follow = null;
    horse.walker.path = [];
    worker.carrying = 1;
    worker.holding = "lead";
  }

  /** Groom a horse in her stall, lead her out to the paddock gate and let her go. */
  private turnoutPlan(n: number, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    const stall = this.layout.stalls[n];
    if (!stall) return null;
    const horse = this.animals.find((a) => a.stall === n);
    if (!horse) return null;
    const gate = nearest(
      this.layout.catches.map((c) => c.hand),
      stall.hand,
    );
    return {
      giveBack: () => {
        if (horse.leader === worker) this.release(horse, 0, "paddock");
      },
      legs: [
        {
          at: stall.hand,
          facing: stall.hand.facing,
          doing: "groom",
          ms: this.tuning.groomMs,
          ready: () => horse.state === "STALLED",
          start: () => {
            horse.state = "GROOMED";
          },
          finish: () => this.lead(horse, worker),
        },
        {
          at: gate,
          facing: gate.facing,
          doing: "give",
          ms: this.tuning.leadMs,
          ready: () => true,
          finish: (now) => {
            this.release(horse, now, "paddock");
            drop(worker);
            this.emit({ kind: "turned-out", horse: horse.name, by: worker.name });
          },
        },
      ],
    };
  }

  /** Catch a horse waiting by the gate, lead her in to her stall and let her go in. */
  private bringInPlan(n: number, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    const spot = this.layout.catches[n];
    if (!spot) return null;
    const waiting = () => this.animals.find((a) => a.catchAt === n && a.state === "WAIT_CATCH");
    const horse = waiting();
    if (!horse || horse.stall === null) return null;
    const stall = this.layout.stalls[horse.stall];
    return {
      giveBack: () => {
        if (horse.leader === worker) this.release(horse, 0, "stall");
      },
      legs: [
        {
          at: spot.hand,
          facing: spot.hand.facing,
          doing: "reach",
          ms: this.tuning.leadMs,
          ready: () => waiting() === horse,
          finish: () => {
            this.letGo(horse);
            horse.catchAt = null;
            horse.warnedRestless = false;
            this.lead(horse, worker);
          },
        },
        {
          at: stall.hand,
          facing: stall.hand.facing,
          doing: "give",
          ms: this.tuning.leadMs,
          ready: () => true,
          finish: (now) => {
            this.release(horse, now, "stall");
            drop(worker);
            this.emit({ kind: "brought-in", horse: horse.name, by: worker.name });
          },
        },
      ],
    };
  }

  private harvestLeg(p: PlotState, worker: Worker<FarmJob>): Leg {
    return {
      at: p.layout.work,
      facing: p.layout.work.facing,
      doing: "harvest",
      ms: this.tuning.harvestMs,
      chains: true,
      ready: () => p.stage === 4,
      finish: () => {
        p.stage = 0;
        p.grown = 0;
        worker.carrying += 1;
        worker.holding = "sheaf";
      },
    };
  }

  private harvestPlan(p: PlotState | undefined, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    if (!p) return null;
    return {
      giveBack: (count) => this.stack(count),
      chain: (w) => {
        if (w.carrying >= this.tuning.sheaves) return null;
        const next = this.nextPlot(w, "harvest", 4);
        return next ? { task: next.task, legs: [this.harvestLeg(next.plot, worker)] } : null;
      },
      legs: [
        this.harvestLeg(p, worker),
        {
          // The sheaves go up to the store from whichever of its squares is nearest the field.
          at: nearest(this.layout.feedStore, p.layout.work),
          facing: nearest(this.layout.feedStore, p.layout.work).facing,
          doing: "give",
          around: true,
          ms: this.tuning.stackMs,
          ready: () => true,
          finish: () => {
            const count = worker.carrying;
            this.stack(count);
            this.emit({ kind: "harvested", by: worker.name, count });
            drop(worker);
          },
        },
      ],
    };
  }

  private sowLeg(p: PlotState, worker: Worker<FarmJob>): Leg {
    return {
      at: p.layout.work,
      facing: p.layout.work.facing,
      doing: "harvest",
      ms: this.tuning.sowMs,
      chains: true,
      ready: () => p.stage === 0,
      finish: () => {
        p.stage = 1;
        p.grown = 0;
        this.emit({ kind: "sown", by: worker.name, plot: p.layout.id });
      },
    };
  }

  private sowPlan(p: PlotState | undefined, worker: Worker<FarmJob>): Plan<FarmJob> | null {
    if (!p) return null;
    let sown = 1;
    return {
      giveBack: () => {},
      chain: (w) => {
        if (sown >= this.tuning.sowRun) return null;
        const next = this.nextPlot(w, "sow", 0);
        if (!next) return null;
        sown += 1;
        return { task: next.task, legs: [this.sowLeg(next.plot, worker)] };
      },
      legs: [this.sowLeg(p, worker)],
    };
  }

  /** Sheaves onto the feed store, a sack for every few. */
  private stack(sheaves: number): void {
    this.loose += sheaves;
    const sacks = Math.floor(this.loose / this.tuning.sheavesPerSack);
    this.loose -= sacks * this.tuning.sheavesPerSack;
    this.feedStore = Math.min(this.tuning.feedCap, this.feedStore + sacks);
  }

  /** Whether a job is the stable hands': seeing to a horse, or the troughs and muck of the horses' pen. */
  forTheHorses(task: Task): boolean {
    if (task.kind === "turnout" || task.kind === "bringin") return true;
    return this.pen(task.key.slice(task.key.indexOf(":") + 1))?.layout.kind === "horse";
  }

  /**
   * Whether a field job is in a furrow nobody else on the crew is working. Furrows are one square wide, so
   * two hands in one would stand waiting on each other; each takes a row of their own, the way a field is
   * worked.
   */
  furrowFree(task: Task, worker: string): boolean {
    if ((task.kind !== "harvest" && task.kind !== "sow") || !this.board) return true;
    const row = this.plot(task.key.slice(task.key.indexOf(":") + 1))?.layout.work.ty;
    if (row === undefined) return true;
    for (const other of this.board.all()) {
      if (other.claimedBy === null || other.claimedBy === worker || (other.kind !== "harvest" && other.kind !== "sow")) continue;
      if (this.plot(other.key.slice(other.key.indexOf(":") + 1))?.layout.work.ty === row) return false;
    }
    return true;
  }

  /** The nearest plot along the same furrow with a note up for this kind of job, claimed for the worker to run on into. */
  private nextPlot(worker: Worker<FarmJob>, kind: "harvest" | "sow", stage: PlotStage): { task: Task; plot: PlotState } | null {
    const board = this.board;
    if (!board) return null;
    const from = worker.walker.tile;
    const near = this.plots
      .filter((p) => p.stage === stage && p.layout.work.ty === from.ty && Math.abs(p.layout.work.tx - from.tx) <= FIELD_REACH)
      .sort((a, b) => distance(a.layout.work, from) - distance(b.layout.work, from));
    for (const plot of near) {
      const task = board.claimKey(`${kind}:${plot.layout.id}`, worker.name);
      if (task) return { task, plot };
    }
    return null;
  }

  // ---- what a view draws

  view(now: number): AnimalView[] {
    const hour = this.hourAt(now);
    return this.animals.map((a) => {
      const view: AnimalView = {
        id: a.id,
        name: a.name,
        kind: a.kind,
        pen: a.pen.layout.id,
        tile: a.walker.tile,
        from: a.walker.from,
        stepMs: a.walker.stepMs,
        stepLeft: a.walker.stepLeft,
        facing: a.walker.facing,
        doing: this.doingOf(a, hour),
        hunger: a.hunger,
        thirst: a.thirst,
        mood: this.moodOf(a, now),
      };
      if (a.mother) {
        view.young = true;
        view.mother = a.mother.id;
      }
      if (a.coat) view.coat = a.coat;
      if (a.leader) view.ledBy = a.leader.name;
      return view;
    });
  }

  troughView(): TroughView[] {
    return this.pens.flatMap((p) => [
      { pen: p.layout.id, kind: "feed" as const, level: p.feed },
      { pen: p.layout.id, kind: "water" as const, level: p.water },
    ]);
  }

  plotView(): PlotView[] {
    return this.plots.map((p) => ({ tx: p.layout.at.tx, ty: p.layout.at.ty, crop: p.layout.crop, stage: p.stage }));
  }

  penView(): { id: string; dirt: number }[] {
    return this.pens.map((p) => ({ id: p.layout.id, dirt: p.dirt }));
  }
}

/** Put down what they were carrying. */
function drop(worker: Worker<FarmJob>): void {
  worker.carrying = 0;
  worker.holding = null;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/ /g, "-");
}

function distance(a: Tile, b: Tile): number {
  return Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
}

function nearest<T extends Tile>(spots: readonly T[], to: Tile): T {
  return [...spots].sort((a, b) => distance(a, to) - distance(b, to))[0];
}
