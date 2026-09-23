/**
 * The tool belt: which tool is in hand, and what using it on a square does.
 *
 * This replaces the old "tap the thing, then drag a token onto it" gesture
 * (stackacres-drag-affordance.tsx) and the seed ring (stackacres-radial-menu.tsx).
 * A tool is held, the farmer walks to the square, and the tool fires when he
 * gets there. The belt is the reason the farmer has to be NEXT to what he
 * works: one square, one action, one body standing on it.
 *
 * Only tools the top-down world can actually draw are on the belt. The scythe
 * and the pipe are deliberately absent until it draws them, because a belt key
 * that silently does nothing is the exact thing this replaced (see
 * components/arcade/stackacres-td/topdown-world.tsx's own header on which
 * contract methods are still no-ops).
 *
 * It decides nothing new about what a unit affords: the hand defers to
 * `tapActionFor` (./tap-action.ts), which defers to `unitRowAction`
 * (./district-panel.ts), which is still the one place that knows. This only
 * says which question the held tool is asking.
 *
 * Pure, so it is tested without React or Phaser (toolbelt.test.ts).
 */

import { STACKACRES_CATALOGUE, type StackAcresCrop } from "./catalogue";
import { tapActionFor } from "./tap-action";
import type { StackAcresUnitSnapshot } from "./units";
import type { StackAcresInventory } from "./inventory";
import { FENCE_NEEDS_WOOD, FENCE_NOT_HERE, FENCE_WOOD_COST } from "./fences";

/** The belt, in the order it is drawn. `hand` is the resting slot every session starts in. */
export const BELT_TOOLS = ["hand", "hoe", "can", "seeds", "fence"] as const;

export type BeltTool = (typeof BELT_TOOLS)[number];

export interface BeltToolDef {
  /** What the slot says, and what a screen reader announces. */
  label: string;
  /** One short line saying what it does, for the slot's title. */
  hint: string;
  /** A painter in components/arcade/stackacres/stackacres-art.ts, kept as a plain
   *  string so this file stays free of a components/ import (same posture ./tools.ts takes). */
  icon: string;
}

export const BELT_TOOL_DEFS: Readonly<Record<BeltTool, BeltToolDef>> = {
  hand: {
    label: "Hand",
    hint: "Pick ready crops, feed hungry animals, clear weather-worn beds.",
    icon: "ico-harvest",
  },
  hoe: {
    label: "Hoe",
    hint: "Break new ground. Tap bare grass to dig a bed.",
    icon: "ico-hoe",
  },
  can: {
    label: "Watering can",
    hint: "Water a thirsty crop. Fill it at the well.",
    icon: "ico-watering-can",
  },
  seeds: {
    // The slot draws the crop actually on the wheel when one is picked; this is
    // the empty-pouch fallback.
    label: "Seed pouch",
    hint: "Sow the seed you picked. Tap the pouch again to change it.",
    icon: "ico-plant",
  },
  fence: {
    label: "Fence",
    hint: `Put up a fence piece for ${FENCE_WOOD_COST} Wood. Use it on a fence to take it down and get the Wood back.`,
    icon: "ico-fence",
  },
};

/**
 * The square a tool is about to be used on: whatever the farmer walked to, or
 * the one he is facing when the Use key is pressed. `tile` is null anywhere a
 * bed cannot go -- off the Homestead's grass paddocks and the Crop Fields --
 * where there is no bed to lay or sow.
 */
export interface BeltTarget {
  unit: StackAcresUnitSnapshot | null;
  tile: { tx: number; ty: number } | null;
  /** That tile already has a bed on it. */
  bedded: boolean;
  /** This exact tile is already armed for lifting, so the next hoe press lifts it. */
  armed?: boolean;
  /** A fence piece stands on this square. */
  fenced: boolean;
}

/** Everything the belt reads off the farm to answer. Display-only, like `tapActionFor`'s own context. */
export interface BeltContext {
  water: number;
  feed: number;
  /** The shelf, which a hungry hen or cattle eats from before the Feed Sack (./feeding.ts). */
  shelfFeed?: StackAcresInventory;
  gold: number;
  nowMs: number;
  /** The crop on the seed wheel, and how many of it are held. Livestock is bought
   *  from a shop, never sown, so the pouch only ever holds a crop. */
  seed: StackAcresCrop | null;
  seedsHeld: number;
  /** Wood on the shelf, which fence pieces are built from. */
  wood: number;
}

/**
 * What using the held tool here sends. `nothing` never reaches the network; it
 * is a line floated where the farmer is standing, and `why` picks the voice the
 * same way `StackAcresTapAction` does (a real no knocks on wood, a crop that is
 * merely still growing stays quiet).
 */
export type BeltAction =
  /** The square affords nothing and the player asked for nothing: he simply walked here. Silent. */
  | { kind: "idle" }
  | { kind: "collect"; unitId: string }
  | { kind: "feed"; unitId: string }
  | { kind: "water"; unitId: string }
  | { kind: "clear"; unitId: string }
  | { kind: "till"; tx: number; ty: number }
  /** The hoe on a bare bed, first press: ask before lifting it. */
  | { kind: "arm-lift"; tx: number; ty: number; reason: string }
  | { kind: "lift"; tx: number; ty: number }
  | { kind: "plant"; tx: number; ty: number; stock: StackAcresCrop }
  | { kind: "fence"; tx: number; ty: number }
  /** The Fence on a piece, first press: ask before taking it down. */
  | { kind: "arm-unfence"; tx: number; ty: number; reason: string }
  | { kind: "unfence"; tx: number; ty: number }
  | { kind: "nothing"; reason: string; why: "blocked" | "waiting" };

const blocked = (reason: string): BeltAction => ({ kind: "nothing", reason, why: "blocked" });
const waiting = (reason: string): BeltAction => ({ kind: "nothing", reason, why: "waiting" });

/** Which farmer animation acts a belt action out, or null when nothing is sent. */
export function beltAnimation(action: BeltAction): "water" | "harvest" | "hoe" | "plant" | null {
  switch (action.kind) {
    case "fence":
    case "unfence":
      return "plant";
    case "water":
      return "water";
    case "collect":
    case "clear":
      return "harvest";
    case "till":
    case "lift":
      return "hoe";
    case "plant":
      return "plant";
    default:
      return null;
  }
}

export function resolveBeltAction(tool: BeltTool, target: BeltTarget, ctx: BeltContext): BeltAction {
  switch (tool) {
    case "hand":
      return handAction(target, ctx);
    case "can":
      return canAction(target, ctx);
    case "hoe":
      return hoeAction(target, ctx);
    case "seeds":
      return seedAction(target, ctx);
    case "fence":
      return fenceAction(target, ctx);
  }
}

/**
 * The Fence puts a piece up on open grass and takes one down. Taking one down
 * is two presses, the same confirm lifting a bed has, even though the Wood all
 * comes back: a walk along a fence with Use held should never unbuild it.
 */
function fenceAction(target: BeltTarget, ctx: BeltContext): BeltAction {
  if (!target.tile) return blocked(FENCE_NOT_HERE);
  const { tx, ty } = target.tile;
  if (target.fenced) {
    if (target.armed) return { kind: "unfence", tx, ty };
    return { kind: "arm-unfence", tx, ty, reason: "Press again to take this piece down." };
  }
  if (target.bedded) return blocked("There's a bed here.");
  if (ctx.wood < FENCE_WOOD_COST) return blocked(FENCE_NEEDS_WOOD);
  return { kind: "fence", tx, ty };
}

/**
 * The hand is the catch-all: it picks, it feeds, it clears. Watering is
 * deliberately NOT here even though `tapActionFor` offers it, because the can
 * is its own slot and a hand that also waters would make the can pointless.
 */
function handAction(target: BeltTarget, ctx: BeltContext): BeltAction {
  const unit = target.unit;
  // An empty hand on empty ground is a walk, not a refusal. Floating "nothing
  // here" every time a finger picks a spot to stand is how a farm turns naggy.
  if (!unit) return { kind: "idle" };
  const action = tapActionFor(unit, { feed: ctx.feed, gold: ctx.gold, nowMs: ctx.nowMs, shelfFeed: ctx.shelfFeed });
  if (action.kind === "refused") return { kind: "nothing", reason: action.reason, why: action.why };
  if (action.kind === "water") return blocked("This one is thirsty. Use the watering can.");
  return action;
}

function canAction(target: BeltTarget, ctx: BeltContext): BeltAction {
  const unit = target.unit;
  if (!unit) return blocked("Nothing here to water.");
  if (unit.state !== "dry") return waiting("This one does not need water yet.");
  if (ctx.water < 1) return blocked("Your watering can is empty. Fill it at the well.");
  return { kind: "water", unitId: unit.id };
}

/**
 * The hoe breaks new ground, and on ground already broken it lifts the bed back
 * up. Lifting takes two presses: the first arms this one tile and says so, the
 * second does it. That confirm came from the gel dock's own `armedRemoveBed` and
 * moved here with the job -- a bed is bought, and one mis-aimed press should
 * never throw one away.
 */
function hoeAction(target: BeltTarget, ctx: BeltContext): BeltAction {
  if (!target.tile) return blocked("Beds go on the grass by the house, or in the Crop Fields.");
  if (target.fenced) return blocked("There's a fence there.");
  const { tx, ty } = target.tile;
  if (target.bedded) {
    if (target.unit) return blocked("Something is growing here. Pick it first.");
    if (target.armed) return { kind: "lift", tx, ty };
    return { kind: "arm-lift", tx, ty, reason: "Press again to lift this bed." };
  }
  return { kind: "till", tx, ty };
}

function seedAction(target: BeltTarget, ctx: BeltContext): BeltAction {
  if (!target.tile) return blocked("Seeds go in a soil bed.");
  if (target.unit) return blocked("Something is already growing here.");
  if (!target.bedded) return blocked("Break the ground with the hoe first.");
  if (!ctx.seed) return blocked("Tap the seed pouch to pick what to sow.");
  if (ctx.seedsHeld < 1) return blocked(`No ${STACKACRES_CATALOGUE[ctx.seed].label} seeds left.`);
  return { kind: "plant", tx: target.tile.tx, ty: target.tile.ty, stock: ctx.seed };
}
