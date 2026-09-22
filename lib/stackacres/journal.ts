/**
 * The Journal: the one place that answers "what now, and why does it matter".
 *
 * StackAcres had five surfaces that each claimed to say what to do next --
 * the chapter chip (./chapters.ts), a locked shop row (./shop-locks.ts), a
 * locked seed (./seed-unlocks.ts), a traveler's bubble (./story/) and the
 * Town Board (./contracts.ts) -- and no way to tell which of them mattered.
 * Worse, only the first of those was ever on screen without walking
 * somewhere, and it names buildings alone, so the whole expansion half of
 * the progression model (Standing, the five milestone flags, who arrives
 * when) was computed on the server, shipped in `StackAcresView.story.level`,
 * and rendered nowhere at all.
 *
 * Three blocks, which is the whole design:
 *
 *   now     one reactive line. Ray notices what the farm is doing rather
 *           than issuing an errand -- the difference Kayo asked for on
 *           2026-09-21. Everything that finished while the player was away
 *           (jars, a vat batch, hungry animals, a fillable order) sorts
 *           above everything that is merely a good idea, so the top line
 *           doubles as the return-loop signal the farm never had.
 *   farm    the production track: the chapters, what each building costs,
 *           where it goes up and what it opens.
 *   reach   the expansion track: Standing, the five flags, and who the next
 *           one brings.
 *
 * PURE, AND DERIVED FROM THE SNAPSHOT THE SERVER ALREADY SENDS. Nothing here
 * is stored, nothing here is authoritative, and nothing here moves Gold. It
 * reads exactly the atoms the optimistic layer already patches
 * (./optimistic-actions.ts), so a journal line reflects a tap at the same
 * instant the world does and there is no second source of truth to drift.
 */

import { CHAPTERS } from "./chapters";
import { buildCost, costLines, costSummary, type BuildCost, type BuildPlace } from "./build-cost";
import { STACKACRES_CATALOGUE, isLivestock } from "./catalogue";
import { canFulfillContract, type StackAcresContractRow } from "./contracts";
import { STACKACRES_TOOL_TIERS, STACKACRES_TOOL_TIER_DEFS } from "./equipment";
import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { machineItemLabel } from "./machine-items";
import type { MachineKind, StackAcresMachineSnapshot } from "./machines";
import { FARM_KITCHEN_BANK, farmKitchenBanked } from "./farm-kitchen";
import { FEED_SILO_DAILY_FEEDS } from "./feed-silo";
import { seedsOpenedLine } from "./seed-unlocks";
import { STACKACRES_SECTORS, type SectorId } from "./sectors";
import {
  STACKACRES_QUEST_FLAGS,
  STACKACRES_QUEST_LABELS,
  nextStackAcresMilestone,
  stackacresMilestone,
  stackacresQuestFlags,
  type StackAcresQuestFlag,
  type StackAcresShopProgress,
} from "./shop-locks";
import { CELLAR_CAPACITY, type VatContainer } from "./aging";
import type { StackAcresUnitSnapshot } from "./units";
import type { StackAcresStoryView } from "./story/state";
import { STORY_MAX_LEVEL, storyLevel } from "./story/unlocks";
import { TRAVELER_CATALOGUE, TRAVELER_IDS, type TravelerId } from "./story/travelers";

/* ------------------------------------------------------------------ */
/* The one line                                                        */
/* ------------------------------------------------------------------ */

/**
 * Why the top line is saying what it is saying, in priority order. The enum
 * IS the ladder: `CUE_ORDER` below is read off it, so adding a cue means
 * deciding where it sits rather than remembering to update a second list.
 */
export type JournalCueKind =
  /** An animal is going hungry. A loss if ignored, so it outranks everything. */
  | "hungry"
  /** Something finished while the player was away and is waiting to be taken. */
  | "collect"
  /** The open town order can be filled right now. */
  | "contract"
  /** Crops are standing ready in the beds. */
  | "harvest"
  /** Beds have gone dry, so nothing in them is growing. */
  | "water"
  /** The next building is affordable. */
  | "build"
  /** The next building is short of something, and we know where it comes from. */
  | "gather"
  /** A traveler is waiting to be met, or has a quest ready to turn in. */
  | "caller"
  /** Nothing is pressing, so point at the next milestone. */
  | "reach"
  /** Nothing at all. A brand new farm, or a finished one. */
  | "idle";

const CUE_ORDER: readonly JournalCueKind[] = [
  "hungry",
  "collect",
  "contract",
  "harvest",
  "water",
  "build",
  "gather",
  // Below the farm's own next step on purpose. A traveler's line is optional
  // from the first tap to the last (see ./story/quests.ts's header) and the
  // farm is the game, so a player who never talks to anybody must still be
  // told what their own buildings need.
  "caller",
  "reach",
  "idle",
];

export interface JournalCue {
  readonly kind: JournalCueKind;
  /** Ray's voice, one or two sentences. Never an instruction the farm cannot take. */
  readonly line: string;
  /** The first sentence alone, for the chip. The chip is one line of nowrap
   *  text at phone width, and a line that ellipsises mid-word loses exactly
   *  the half that says what to do. The sheet shows `line` in full. */
  readonly short: string;
  /** A short place chip, or null when the line needs no direction. */
  readonly where: string | null;
}

/** A cue, with its chip form worked out. Every push below goes through this. */
function cue(kind: JournalCueKind, line: string, where: string | null = null): JournalCue {
  const stop = line.indexOf(". ");
  return { kind, line, short: stop === -1 ? line : line.slice(0, stop + 1), where };
}

/* ------------------------------------------------------------------ */
/* The two tracks                                                      */
/* ------------------------------------------------------------------ */

export interface JournalStep extends BuildCost {
  readonly built: boolean;
  /** "Opens Potato, Carrot and Onion seeds", or null. */
  readonly opens: string | null;
}

export interface JournalChapter {
  readonly number: number;
  readonly title: string;
  readonly blurb: string;
  readonly done: boolean;
  readonly current: boolean;
  readonly steps: readonly JournalStep[];
}

export interface JournalReachStep {
  readonly flag: StackAcresQuestFlag;
  /** The imperative label the shop and the traveler bubbles already use. */
  readonly label: string;
  readonly done: boolean;
  /** "45,000 Gold + 30 Wood" for a flag that is a land clear, else null.
   *  The expansion track's two big rungs are purchases, and a rung a player
   *  is told to reach without being told the price is not a goal. */
  readonly cost: string | null;
  /** Travelers who arrive on this flag by name, rather than on a count. */
  readonly brings: readonly string[];
}

export interface JournalCaller {
  readonly traveler: TravelerId;
  readonly name: string;
  /** Waiting to be met, holding a quest, or holding a finished one. */
  readonly state: "waiting" | "working" | "ready";
  /** The quest title while one is open. Null before they have been met. */
  readonly detail: string | null;
}

/**
 * One capacity that fills while the player is away, and how full it is.
 *
 * THE RETURN LOOP, MADE READABLE. The farm already banks kitchen batches,
 * ages jars, regrows trees and lets animals get hungry between sittings, and
 * every one of those was legible only by opening its own panel. A player who
 * cannot see a meter filling has no reason to come back to it.
 */
export interface JournalWaiting {
  readonly key: string;
  readonly label: string;
  /** One short phrase: "9 of 12 jars", "3 of 4 ready to chop". */
  readonly detail: string;
  /** 0..1, for a meter. Null for a row that is a count rather than a fill. */
  readonly fill: number | null;
  /** True when there is something to collect or tend right now. */
  readonly ready: boolean;
}

export interface JournalView {
  readonly now: JournalCue;
  /** Capacities that fill while the player is away. Empty on a farm with
   *  nothing to come back to. */
  readonly waiting: readonly JournalWaiting[];
  /** The production track. */
  readonly chapters: readonly JournalChapter[];
  /** The chapter the chip names, or null once all six are done. */
  readonly currentChapter: JournalChapter | null;
  /** 0..1 on the next building, for the chip's bar. 1 when there is none. */
  readonly readiness: number;
  /** Standing, as the travelers count it: 1 on a fresh farm, 6 at the top. */
  readonly standing: number;
  readonly standingMax: number;
  readonly reach: readonly JournalReachStep[];
  /** What earning any one more flag opens, whichever flag it turns out to be. */
  readonly nextMilestoneOpens: readonly string[];
  readonly callers: readonly JournalCaller[];
}

export interface JournalInput {
  readonly gold: number;
  readonly inventory: StackAcresInventory;
  readonly built: ReadonlySet<MachineKind>;
  readonly units: readonly StackAcresUnitSnapshot[];
  readonly contract: StackAcresContractRow | null;
  readonly vat: VatContainer | null;
  readonly cellar: VatContainer | null;
  /** Null until the first snapshot lands. The journal still renders. */
  readonly story: StackAcresStoryView | null;
  readonly progress: StackAcresShopProgress;
  /** Everything that refills on its own, for the "waiting" block. Required
   *  rather than defaulted: a silently-empty list would read as "nothing is
   *  waiting" on a farm that has plenty. */
  readonly machines: readonly StackAcresMachineSnapshot[];
  /** The clock the kitchen's bank is measured against. Passed rather than
   *  read here so the whole module stays a pure function of its input. */
  readonly nowMs: number;
  readonly woodNodes: readonly { readonly ready: boolean }[];
  readonly stoneNodes: readonly { readonly ready: boolean }[];
  readonly forageNodes: readonly { readonly ready: boolean }[];
}

/* ------------------------------------------------------------------ */
/* The production track                                                */
/* ------------------------------------------------------------------ */

function journalChapters(input: JournalInput): JournalChapter[] {
  let currentFound = false;
  return CHAPTERS.map((chapter) => {
    const steps = chapter.steps.map((kind) => ({
      ...buildCost(kind, input.gold, input.inventory),
      built: input.built.has(kind),
      opens: seedsOpenedLine(kind),
    }));
    const done = steps.every((step) => step.built);
    const current = !done && !currentFound;
    if (current) currentFound = true;
    return { number: chapter.number, title: chapter.title, blurb: chapter.blurb, done, current, steps };
  });
}

/** The first building still to build in the current chapter, or null. */
function nextBuilding(chapters: readonly JournalChapter[]): JournalStep | null {
  const current = chapters.find((chapter) => chapter.current);
  return current?.steps.find((step) => !step.built) ?? null;
}

/**
 * How close the next building is, as the worst of its lines. A building with
 * Gold and Wood is only as ready as whichever is furthest behind, which is
 * what the chip's bar has to show or it reads as nearly-done on a farm with
 * the Gold and none of the Wood.
 */
function buildReadiness(step: JournalStep | null): number {
  if (!step) return 1;
  return step.lines.reduce(
    (worst, line) => Math.min(worst, line.need === 0 ? 1 : Math.min(1, line.have / line.need)),
    1,
  );
}

/* ------------------------------------------------------------------ */
/* The expansion track                                                 */
/* ------------------------------------------------------------------ */

/** Travelers whose arrival is pinned to one named flag rather than a count. */
function travelersOnFlag(flag: StackAcresQuestFlag): string[] {
  return TRAVELER_IDS.filter((id) => {
    const unlock = TRAVELER_CATALOGUE[id].unlock;
    return unlock.kind === "flag" && unlock.flag === flag;
  }).map((id) => TRAVELER_CATALOGUE[id].name);
}

/**
 * What one more flag opens, whatever that flag turns out to be.
 *
 * Milestone unlocks count flags in any order (see `stackacresMilestone`'s own
 * header on why the count is not a leading run), so "who arrives next" cannot
 * be pinned to a particular flag -- only to the count going up by one. The
 * flag-specific arrivals live on their own rung instead, in `reach`.
 */
function opensAtMilestone(count: number): string[] {
  const opens: string[] = [];
  for (const id of TRAVELER_IDS) {
    const unlock = TRAVELER_CATALOGUE[id].unlock;
    if (unlock.kind === "milestone" && unlock.count === count) opens.push(TRAVELER_CATALOGUE[id].name);
  }
  for (const tier of STACKACRES_TOOL_TIERS) {
    const def = STACKACRES_TOOL_TIER_DEFS[tier];
    if (def.minimumMilestone === count) opens.push(`${def.label} on Ray's shelf`);
  }
  return opens;
}

/** The two flags that are land clears, so their price can be shown. The
 *  other three are acts, not purchases. */
const FLAG_SECTOR: Partial<Record<StackAcresQuestFlag, SectorId>> = {
  cleared_wallow: "wallow",
  cleared_oxfields: "oxfields",
};

function journalReach(input: JournalInput): JournalReachStep[] {
  const earned = stackacresQuestFlags(input.progress);
  return STACKACRES_QUEST_FLAGS.map((flag) => {
    const sector = FLAG_SECTOR[flag];
    const def = sector ? STACKACRES_SECTORS[sector] : null;
    return {
      flag,
      label: STACKACRES_QUEST_LABELS[flag],
      done: earned.has(flag),
      cost: def
        ? costSummary({ lines: costLines(def.clearCost, def.materials ?? [], input.gold, input.inventory) })
        : null,
      brings: travelersOnFlag(flag),
    };
  });
}

function journalCallers(story: StackAcresStoryView | null): JournalCaller[] {
  if (!story) return [];
  const callers: JournalCaller[] = [];
  for (const id of TRAVELER_IDS) {
    const traveler = story.travelers[id];
    if (!traveler.unlocked || traveler.done) continue;
    const name = TRAVELER_CATALOGUE[id].name;
    if (!traveler.met) {
      callers.push({ traveler: id, name, state: "waiting", detail: null });
      continue;
    }
    if (traveler.quest === null) continue;
    callers.push({
      traveler: id,
      name,
      state: traveler.ready ? "ready" : "working",
      detail: traveler.quest.title,
    });
  }
  return callers;
}

/* ------------------------------------------------------------------ */
/* What filled up while you were away                                  */
/* ------------------------------------------------------------------ */

const readyCount = (nodes: readonly { readonly ready: boolean }[]) =>
  nodes.filter((node) => node.ready).length;

function journalWaiting(input: JournalInput): JournalWaiting[] {
  const rows: JournalWaiting[] = [];

  if (input.cellar) {
    const jars = input.cellar.manifest?.quantity ?? 0;
    rows.push({
      key: "cellar",
      label: "The cellar",
      detail:
        input.cellar.status === "collectible"
          ? `${jars} jars, ready to open`
          : jars > 0
            ? `${jars} of ${CELLAR_CAPACITY} jars aging`
            : "Empty",
      fill: jars / CELLAR_CAPACITY,
      ready: input.cellar.status === "collectible",
    });
  }

  if (input.vat) {
    rows.push({
      key: "vat",
      label: "The vat",
      detail:
        input.vat.status === "collectible"
          ? `Ready at ${input.vat.currentTier?.label ?? "full strength"}`
          : input.vat.status === "aging"
            ? `Aging${input.vat.nextTier ? ` toward ${input.vat.nextTier.label}` : ""}`
            : "Empty",
      fill: null,
      ready: input.vat.status === "collectible",
    });
  }

  const kitchen = input.machines.find((machine) => machine.kind === "farm_kitchen");
  if (kitchen) {
    const banked = farmKitchenBanked(kitchen.kitchenSince, new Date(input.nowMs));
    rows.push({
      key: "farm_kitchen",
      label: "The Farm Kitchen",
      detail: kitchen.standingRecipe
        ? `${banked} of ${FARM_KITCHEN_BANK} batches banked`
        : "No standing order set",
      fill: banked / FARM_KITCHEN_BANK,
      ready: banked > 0,
    });
  }

  const silo = input.machines.find((machine) => machine.kind === "feed_silo");
  if (silo && silo.autoFeedsLeft !== null) {
    rows.push({
      key: "feed_silo",
      label: "The Feed Silo",
      detail: `${silo.autoFeedsLeft} of ${FEED_SILO_DAILY_FEEDS} feeds left today`,
      fill: silo.autoFeedsLeft / FEED_SILO_DAILY_FEEDS,
      ready: false,
    });
  }

  const gatherables: [string, string, readonly { readonly ready: boolean }[]][] = [
    ["trees", "The trees", input.woodNodes],
    ["bushes", "The bushes", input.forageNodes],
    ["boulders", "The Mine", input.stoneNodes],
  ];
  for (const [key, label, nodes] of gatherables) {
    if (nodes.length === 0) continue;
    const ready = readyCount(nodes);
    rows.push({
      key,
      label,
      detail: `${ready} of ${nodes.length} ready`,
      fill: ready / nodes.length,
      ready: ready > 0,
    });
  }

  const animals = input.units.filter((unit) => isLivestock(unit.stock));
  if (animals.length > 0) {
    const hungry = animals.filter((unit) => unit.state === "hungry").length;
    const ready = animals.filter((unit) => unit.state === "ready").length;
    rows.push({
      key: "animals",
      label: "The pens",
      detail:
        hungry > 0
          ? `${hungry} hungry`
          : ready > 0
            ? `${ready} ready to collect`
            : `${animals.length} coming along`,
      fill: null,
      ready: hungry > 0 || ready > 0,
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* The one line, worked out                                            */
/* ------------------------------------------------------------------ */

/** Every cue the farm could truthfully show right now, unsorted. */
function candidateCues(input: JournalInput, chapters: readonly JournalChapter[]): JournalCue[] {
  const cues: JournalCue[] = [];

  const hungry = input.units.filter((unit) => unit.state === "hungry" && isLivestock(unit.stock));
  if (hungry.length > 0) {
    const kinds = [...new Set(hungry.map((unit) => STACKACRES_CATALOGUE[unit.stock].label))];
    cues.push(cue("hungry", `${kinds.join(" and ")} need feeding before they go off their cycle.`, "The pens"));
  }

  if (input.cellar?.status === "collectible") {
    cues.push(cue("collect", "The jars in the cellar have finished aging.", "House"));
  }
  if (input.vat?.status === "collectible") {
    cues.push(cue("collect", "There's a batch sitting ready in the vat.", "Workshop"));
  }

  const contract = input.contract;
  if (contract && canFulfillContract(inventoryQuantity(input.inventory, contract.item), contract)) {
    cues.push(
      cue("contract", `You've got the ${machineItemLabel(contract.item, contract.quantity)} the town asked for.`, "Town Board"),
    );
  }

  const ready = input.units.filter((unit) => unit.state === "ready").length;
  if (ready > 0) {
    cues.push(
      cue("harvest", ready === 1 ? "Something out there is ready to bring in." : `${ready} things are ready to bring in.`),
    );
  }

  const dry = input.units.filter((unit) => unit.state === "dry").length;
  if (dry > 0) {
    cues.push(
      cue("water", dry === 1 ? "A bed has gone dry, and nothing grows dry." : `${dry} beds have gone dry, and nothing grows dry.`),
    );
  }

  const callers = journalCallers(input.story);
  const waiting = callers.find((caller) => caller.state === "ready") ?? callers.find((caller) => caller.state === "waiting");
  if (waiting) {
    cues.push(
      cue(
        "caller",
        waiting.state === "ready"
          ? `${waiting.name} is waiting on what you've already done.`
          : `${waiting.name} is about, and you've not spoken yet.`,
      ),
    );
  }

  const step = nextBuilding(chapters);
  if (step) {
    if (step.affordable) {
      cues.push(cue("build", `You can put up the ${step.name} now.`, step.place));
    } else {
      const short = step.lines.find((line) => !line.met && line.source !== null);
      cues.push(
        short
          ? cue("gather", `The ${step.name} still wants ${short.need - short.have} more ${short.label}. ${short.source}.`)
          : cue(
              "gather",
              `The ${step.name} is ${(step.lines[0].need - step.lines[0].have).toLocaleString()} Gold away.`,
              step.place,
            ),
      );
    }
  }

  const next = nextStackAcresMilestone(input.progress);
  if (next) {
    cues.push(cue("reach", `${STACKACRES_QUEST_LABELS[next]}, and the farm reaches further.`));
  }

  cues.push(cue("idle", "Nothing's waiting on you. Sow something and see who turns up."));
  return cues;
}

/** The highest-priority cue the farm can truthfully show. */
export function journalCue(input: JournalInput, chapters: readonly JournalChapter[]): JournalCue {
  const cues = candidateCues(input, chapters);
  for (const kind of CUE_ORDER) {
    const cue = cues.find((candidate) => candidate.kind === kind);
    if (cue) return cue;
  }
  // CUE_ORDER covers the union and `candidateCues` always pushes "idle", so
  // this is unreachable; it is a throw rather than a default line so a cue
  // kind added without a rung fails loudly in a test instead of silently
  // sorting last.
  throw new Error("no journal cue matched the priority ladder");
}

/* ------------------------------------------------------------------ */
/* The whole sheet                                                     */
/* ------------------------------------------------------------------ */

export function journalView(input: JournalInput): JournalView {
  const chapters = journalChapters(input);
  const step = nextBuilding(chapters);
  const milestone = stackacresMilestone(input.progress);
  return {
    now: journalCue(input, chapters),
    waiting: journalWaiting(input),
    chapters,
    currentChapter: chapters.find((chapter) => chapter.current) ?? null,
    readiness: buildReadiness(step),
    standing: storyLevel(input.progress),
    standingMax: STORY_MAX_LEVEL,
    reach: journalReach(input),
    nextMilestoneOpens: milestone >= STACKACRES_QUEST_FLAGS.length ? [] : opensAtMilestone(milestone + 1),
    callers: journalCallers(input.story),
  };
}

/** What the chip shows above its bar. Null once every chapter is done. */
export function journalChapterLabel(view: JournalView): string | null {
  const chapter = view.currentChapter;
  return chapter ? `Chapter ${chapter.number} · ${chapter.title}` : null;
}

export type { BuildPlace };
