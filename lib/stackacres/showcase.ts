import type { AvatarPreset } from "@/lib/profile/types";
import { STACKACRES_CATALOGUE, type StackAcresStock } from "./catalogue";
import type { FencePiece } from "./fences";
import type { GuardDog } from "./guard-dog";
import type { PlacedEmpireBuilding } from "./empire-buildings";
import type { ForageNodeSnapshot } from "./forage";
import type { GroceryPlacement } from "./grocery-layout";
import type { LandObstacleSnapshot } from "./land-clearing";
import type { SoilTile } from "./soil";
import type { StoneNodeSnapshot } from "./stone-nodes";
import type { StackAcresUnitSnapshot } from "./units";
import type { WoodNodeSnapshot } from "./wood";

/**
 * Visitor Mode: what one player may see of another player's farm.
 *
 * THE SHAPE IS THE SECURITY BOUNDARY. A visitor's read runs the owner's own
 * `view()` server-side and then projects it down to what is on this page --
 * the ground, what is standing on it, and a short header. Everything a
 * farm knows about its owner's money and their private progress (the purse,
 * the inventory, the seed stock, the open contract, land upkeep owed, energy,
 * the secrets ledger, the story flags, NPC friendship, the grocery till) has no field to travel in, so it cannot
 * leak by being forgotten -- there is nowhere to forget it.
 *
 * READ-ONLY IS ALSO STRUCTURAL, not a flag on a button. Every farm mutation
 * goes through POST /api/stackacres/actions, which resolves the farm from the
 * CALLER'S OWN session token and has no parameter for whose farm to act on.
 * A visitor holding this snapshot has no request to send that could reach the
 * farm it came from. See lib/server/stackacres-showcase-service.test.ts.
 *
 * No Gold enters or leaves anywhere in here. Looking at a farm is free, and
 * a reaction pays nobody -- deliberately, until visiting has a reason to be
 * worth Gold that is not farming someone else's friends list.
 */

/* ------------------------------------------------------------------ */
/* Who may look                                                        */
/* ------------------------------------------------------------------ */

/**
 * `friends` is as far as this goes for now, by design: a farm is a layout
 * somebody spent weeks on and the first version of this must not hand it to
 * the open internet before anyone has asked for that. A `public` rung is the
 * next one and it is only a value added here plus the one branch in
 * `mayVisit`; nothing else in the feature is shaped around there being two.
 */
export const FARM_VISIBILITIES = ["private", "friends"] as const;

export type FarmVisibility = (typeof FARM_VISIBILITIES)[number];

export const DEFAULT_FARM_VISIBILITY: FarmVisibility = "private";

export function isFarmVisibility(value: unknown): value is FarmVisibility {
  return typeof value === "string" && (FARM_VISIBILITIES as readonly string[]).includes(value);
}

export const FARM_VISIBILITY_LABELS: Readonly<Record<FarmVisibility, string>> = {
  private: "Only me",
  friends: "My friends",
};

export const FARM_VISIBILITY_BLURBS: Readonly<Record<FarmVisibility, string>> = {
  private: "Nobody else can open your farm.",
  friends: "Your friends can look around. They still can't touch anything.",
};

/** Who the viewer is to this farm, as the server worked it out. */
export interface VisitorStanding {
  /** The viewer is the owner. Always allowed, and never able to react. */
  own: boolean;
  /** The viewer and the owner are friends. */
  friend: boolean;
}

/**
 * Whether this standing gets past this setting. One function so the snapshot
 * read and the reaction write can never disagree about who is allowed in --
 * a reaction that landed on a farm the sender could not open would be a hole
 * in exactly the direction that matters.
 */
export function mayVisit(visibility: FarmVisibility, standing: VisitorStanding): boolean {
  if (standing.own) return true;
  if (visibility === "friends") return standing.friend;
  return false;
}

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

/**
 * The whole vocabulary, and it is a fixed list on purpose: three compliments
 * with no downvote and no free text, so a farm nobody has visited yet and a
 * farm somebody dislikes look the same from inside the game.
 *
 * One of each per visitor, forever, enforced by the table's own unique index
 * rather than by a check here -- see the migration. A second tap on the same
 * reaction is not an error, it just does not count twice.
 */
export const SHOWCASE_REACTIONS = [
  { id: "nice_layout", label: "Nice layout" },
  { id: "great_farm", label: "Great farm" },
  { id: "impressive_production", label: "Impressive production" },
] as const;

export type ShowcaseReactionId = (typeof SHOWCASE_REACTIONS)[number]["id"];

export const SHOWCASE_REACTION_IDS: readonly ShowcaseReactionId[] =
  SHOWCASE_REACTIONS.map((reaction) => reaction.id);

export function isShowcaseReaction(value: unknown): value is ShowcaseReactionId {
  return typeof value === "string" && (SHOWCASE_REACTION_IDS as readonly string[]).includes(value);
}

export function showcaseReactionLabel(id: ShowcaseReactionId): string {
  return SHOWCASE_REACTIONS.find((reaction) => reaction.id === id)?.label ?? id;
}

export type ShowcaseReactionCounts = Readonly<Record<ShowcaseReactionId, number>>;

export function emptyReactionCounts(): ShowcaseReactionCounts {
  return { nice_layout: 0, great_farm: 0, impressive_production: 0 };
}

/* ------------------------------------------------------------------ */
/* The snapshot                                                        */
/* ------------------------------------------------------------------ */

/** The owner, from the same narrow projection the friends list and the
 *  leaderboard already show people by (`PublicProfileSummary`). No purse. */
export interface ShowcaseOwner {
  profileId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  accent: string;
}

/** The lines over the farm. Every one of them is already public about
 *  this player somewhere else, or is derived from the layout below it. */
export interface ShowcaseStats {
  /** Ray's own milestone ladder plus one, the same number the shop locks read
   *  (lib/stackacres/shop-locks.ts). A fresh farm is 1. */
  farmLevel: number;
  /** The chapter they are working on, or null once all six are done. */
  chapter: { number: number; title: string } | null;
  chaptersDone: number;
  /** What this farm raises more of than anything else. Null on a bare farm. */
  favoriteProduction: FavoriteProduction | null;
}

export interface FavoriteProduction {
  stock: StackAcresStock;
  label: string;
  count: number;
}

/**
 * Everything the map draws, and nothing else. The field names match
 * `StackAcresWorldProps` so the visitor screen hands them straight to the
 * same world component the owner's farm uses -- one renderer, so a visitor
 * can never be shown a farm that looks different from the real one.
 */
export interface ShowcaseWorld {
  units: StackAcresUnitSnapshot[];
  soilTiles: SoilTile[];
  fences: FencePiece[];
  guardDogs: GuardDog[];
  empireBuildings: PlacedEmpireBuilding[];
  woodNodes: WoodNodeSnapshot[];
  stoneNodes: StoneNodeSnapshot[];
  forageNodes: ForageNodeSnapshot[];
  landObstacles: LandObstacleSnapshot[];
  /** The owner's grocery floor and crew, or null when they don't own one.
   *  The till and what it has collected are money and stay behind. */
  grocery: { layout: GroceryPlacement[]; staff: string[] } | null;
  /** Their farm clock, so the visitor sees the farm in its own light rather
   *  than in the visitor's. Same two numbers the owner's own view carries. */
  clock: { offsetMs: number; serverNowMs: number };
}

export interface StackAcresShowcase {
  owner: ShowcaseOwner;
  stats: ShowcaseStats;
  world: ShowcaseWorld;
  reactions: ShowcaseReactionCounts;
  /** What this viewer has already sent, so the buttons can show as spent. */
  sent: ShowcaseReactionId[];
  /** The viewer is the owner: no reactions, and the copy says so. */
  own: boolean;
}

/* ------------------------------------------------------------------ */
/* Derived lines                                                       */
/* ------------------------------------------------------------------ */

/** The shop milestone as a farm level. A farm past no milestone is level 1. */
export function farmLevelFromMilestone(milestone: number): number {
  return Math.max(1, Math.floor(milestone) + 1);
}

/**
 * What the farm raises most of, by how many are in the ground or in the pens
 * right now.
 *
 * Counted off the live layout rather than from a lifetime tally, because
 * there is no per-item lifetime tally to read and inventing one would mean a
 * new counter on every harvest path. What this actually says is "this is what
 * their farm is currently given over to", which is the honest reading of a
 * layout you are looking at, and it is labelled that way on screen.
 *
 * Ties break on the catalogue's own order, so the line is stable between two
 * reads of an unchanged farm rather than flipping on map iteration order.
 */
export function favoriteProduction(units: readonly StackAcresUnitSnapshot[]): FavoriteProduction | null {
  const counts = new Map<StackAcresStock, number>();
  for (const unit of units) {
    if (unit.state === "mucked") continue;
    counts.set(unit.stock, (counts.get(unit.stock) ?? 0) + 1);
  }

  let best: FavoriteProduction | null = null;
  for (const stock of Object.keys(STACKACRES_CATALOGUE) as StackAcresStock[]) {
    const count = counts.get(stock) ?? 0;
    if (count === 0 || (best && count <= best.count)) continue;
    best = { stock, label: STACKACRES_CATALOGUE[stock].label, count };
  }
  return best;
}
