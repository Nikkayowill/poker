/**
 * Land by the acre.
 *
 * The yard round the house is free. The wild land round the yard (the Crop
 * Fields' overgrowth, `HOMESTEAD_WILD_ROWS`) is cut into rectangular acres, and
 * a bed or a fence piece may only go down on an acre the farm owns. Chopping and
 * mining out there stays free: that is how the Wood and Stone for the deed gets
 * gathered.
 *
 * AN ACRE IS A RECTANGLE OF HOMESTEAD MAP TILES (16 units), the same squares
 * fences and animals use. The list below is written out by hand and checked
 * against the map by `acres.test.ts`: every wild tile is in exactly one acre,
 * and no two acres overlap. An acre may reach over tiles that are not wild; only
 * wild tiles are gated.
 *
 * ONE WILD TILE sits alone in the north (`LOOSE_WILD_TILES`) and belongs to no
 * acre. Nothing new can be built on it.
 *
 * EXISTING FARMS KEEP WHAT THEY USE. The migration that adds `homestead_acres`
 * writes a grandfathered row for every acre that already holds one of the farm's
 * beds or fences. Those acres are free of the daily fee, because the Crop Fields
 * were already billed through `CROP_FIELDS_UPKEEP_PLOTS`.
 *
 * GOLD: in, none. Out, the price of each acre, and a flat daily fee per bought
 * acre that is netted off payouts like the rest of land upkeep (./upkeep.ts).
 * Wood and Stone leave with the Gold. Nothing is refunded for giving ground back,
 * because ground cannot be given back.
 *
 * Pure: the server, the optimistic layer and the scene all import this.
 */

import { isWildMapTile } from "./hoeable";

export interface Acre {
  readonly id: string;
  /** Top-left map tile. */
  readonly tx: number;
  readonly ty: number;
  /** Size in map tiles. */
  readonly width: number;
  readonly height: number;
}

const acre = (id: string, tx: number, ty: number, width: number, height: number): Acre => ({ id, tx, ty, width, height });

/** The wild land's acres: five in the west, six in the east, twenty along the south. */
export const ACRES: readonly Acre[] = [
  acre("W1", 3, 2, 6, 9),
  acre("W2", 9, 2, 6, 16),
  acre("W3", 3, 11, 6, 7),
  acre("W4", 3, 18, 6, 7),
  acre("W5", 9, 18, 6, 12),
  acre("E1", 48, 5, 7, 12),
  acre("E2", 55, 11, 6, 6),
  acre("E3", 49, 17, 6, 6),
  acre("E4", 55, 17, 6, 6),
  acre("E5", 49, 23, 6, 7),
  acre("E6", 55, 23, 6, 5),
  acre("S01", 3, 37, 6, 6),
  acre("S02", 9, 37, 6, 6),
  acre("S03", 15, 37, 6, 6),
  acre("S04", 21, 37, 6, 6),
  acre("S05", 27, 37, 6, 6),
  acre("S06", 33, 37, 6, 6),
  acre("S07", 39, 37, 6, 6),
  acre("S08", 45, 37, 6, 6),
  acre("S09", 51, 37, 6, 6),
  acre("S10", 57, 37, 4, 6),
  acre("S11", 3, 43, 6, 6),
  acre("S12", 9, 43, 6, 6),
  acre("S13", 15, 43, 6, 6),
  acre("S14", 21, 43, 6, 6),
  acre("S15", 27, 43, 6, 6),
  acre("S16", 33, 43, 6, 6),
  acre("S17", 39, 43, 6, 6),
  acre("S18", 45, 43, 6, 6),
  acre("S19", 51, 43, 6, 6),
  acre("S20", 57, 43, 4, 6),
];

/** Wild tiles that belong to no acre. */
export const LOOSE_WILD_TILES: readonly { readonly tx: number; readonly ty: number }[] = [{ tx: 36, ty: 8 }];

export type AcreId = string;

const BY_ID = new Map<string, Acre>(ACRES.map((entry) => [entry.id, entry]));

const BY_TILE = new Map<string, Acre>();
for (const entry of ACRES) {
  for (let ty = entry.ty; ty < entry.ty + entry.height; ty += 1) {
    for (let tx = entry.tx; tx < entry.tx + entry.width; tx += 1) BY_TILE.set(`${tx},${ty}`, entry);
  }
}

export function acreById(id: string): Acre | null {
  return BY_ID.get(id) ?? null;
}

export function isAcreId(value: unknown): value is AcreId {
  return typeof value === "string" && BY_ID.has(value);
}

/** The acre a map tile is in, or null when it is in none. Wild or not. */
export function acreAtMapTile(tx: number, ty: number): Acre | null {
  return BY_TILE.get(`${tx},${ty}`) ?? null;
}

/** What the client and the server say when ground is not the player's to build on. */
export const ACRE_NOT_YOURS = "This ground isn't yours yet.";
export const ACRE_TREELINE = "That's the treeline. Nothing can be built there.";

export type AcreGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_owned"; readonly acre: Acre }
  | { readonly ok: false; readonly reason: "treeline" };

/**
 * Whether a bed or a fence piece may go on this map tile, as far as ownership goes.
 *
 * The yard is always fine. A wild tile needs its acre in `owned`. A wild tile in
 * no acre is the treeline. Everything else about the tile (grass, beds, fences,
 * obstacles) is checked elsewhere.
 */
export function acreGate(tx: number, ty: number, owned: ReadonlySet<string>): AcreGate {
  if (!isWildMapTile(tx, ty)) return { ok: true };
  const found = acreAtMapTile(tx, ty);
  if (!found) return { ok: false, reason: "treeline" };
  if (!owned.has(found.id)) return { ok: false, reason: "not_owned", acre: found };
  return { ok: true };
}

/** The refusal line for a gate that is not ok. */
export function acreGateMessage(gate: Exclude<AcreGate, { ok: true }>): string {
  return gate.reason === "treeline" ? ACRE_TREELINE : ACRE_NOT_YOURS;
}

/** How a farm came to own an acre. Grandfathered ground is free of the daily fee. */
export type AcreSource = "bought" | "grandfathered";

export interface OwnedAcre {
  readonly id: AcreId;
  readonly source: AcreSource;
}

/* ------------------------------------------------------------------ */
/* Price and upkeep                                                    */
/* ------------------------------------------------------------------ */

export interface AcrePrice {
  readonly gold: number;
  readonly wood: number;
  readonly stone: number;
}

/** The first acre's Gold, and what each one after it multiplies by. */
export const ACRE_BASE_GOLD = 300;
export const ACRE_GOLD_GROWTH = 1.2;
/** Wood rises by a fixed step per acre already owned. */
export const ACRE_BASE_WOOD = 15;
export const ACRE_WOOD_STEP = 3;
/**
 * Stone rises by one for every few acres owned. The wild land only holds so much boulder (384 Stone
 * per farm), so the whole ladder has to fit in that with room left for the Silo, Cellar and Smelter.
 */
export const ACRE_BASE_STONE = 5;
export const ACRE_STONE_EVERY = 4;

/** Gold a bought acre costs the farm each UTC day, netted off payouts. Flat per acre. */
export const ACRE_UPKEEP_GOLD = 40;

/**
 * What the next acre costs when the farm already owns `owned` acres, counting
 * grandfathered ones, so an old farm does not start the ladder over. Gold is
 * rounded to the nearest 50.
 */
export function acrePrice(owned: number): AcrePrice {
  const count = Math.max(0, Math.floor(Number.isFinite(owned) ? owned : 0));
  return {
    gold: Math.round((ACRE_BASE_GOLD * ACRE_GOLD_GROWTH ** count) / 50) * 50,
    wood: ACRE_BASE_WOOD + ACRE_WOOD_STEP * count,
    stone: ACRE_BASE_STONE + Math.floor(count / ACRE_STONE_EVERY),
  };
}

/** What the client needs to render the deed: what is owned, and what the next acre costs. */
export interface StackAcresAcresView {
  /** Every acre the farm may build on. */
  owned: AcreId[];
  /** The next acre's price, or null when the farm owns them all. */
  price: AcrePrice | null;
  /** The daily fee for one bought acre, so the deed can say what holding it costs. */
  upkeepEach: number;
}

export function acresView(owned: readonly OwnedAcre[]): StackAcresAcresView {
  const ids = [...new Set(owned.map((entry) => entry.id))].sort();
  return {
    owned: ids,
    price: ids.length >= ACRES.length ? null : acrePrice(ids.length),
    upkeepEach: ACRE_UPKEEP_GOLD,
  };
}

/** How many of these acres were bought. The daily fee is charged on this count. */
export function boughtAcreCount(acres: readonly OwnedAcre[]): number {
  return acres.filter((entry) => entry.source === "bought").length;
}
