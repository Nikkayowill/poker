/**
 * Farm equipment a player owns outright, and the tractor's row of beds.
 *
 * The tractor is the first big machine: bought once from Ray for Gold and
 * Metal, parked in the yard, and driven. While it is driven the hoe and the
 * seed pouch work a straight row of beds ahead of it instead of one square.
 * Gold leaves once, at Ray's, and never again: driving, hoeing and planting
 * with it cost nothing more than doing the same by hand.
 *
 * Kept in step with the CHECK on `homestead_equipment.kind`. The combine is
 * allowed by the table but not sold yet.
 *
 * Pure, so the server and the client share the row rule (tractor.test.ts).
 */

export const STACKACRES_EQUIPMENT = ["tractor", "combine"] as const;

export type StackAcresEquipment = (typeof STACKACRES_EQUIPMENT)[number];

/** What Ray actually sells today. */
export const STACKACRES_BUYABLE_EQUIPMENT = ["tractor"] as const satisfies readonly StackAcresEquipment[];

export type StackAcresBuyableEquipment = (typeof STACKACRES_BUYABLE_EQUIPMENT)[number];

export interface StackAcresEquipmentDef {
  label: string;
  /** One line saying what owning it does. */
  blurb: string;
  gold: number;
  metal: number;
}

export const STACKACRES_EQUIPMENT_DEFS: Readonly<Record<StackAcresBuyableEquipment, StackAcresEquipmentDef>> = {
  tractor: {
    label: "Tractor",
    blurb: "Parks by the barn. Climb on and the hoe or the seed pouch works six beds in a row.",
    gold: 12_000,
    metal: 8,
  },
};

/** How many beds one press works from the tractor, counting the one in front. */
export const TRACTOR_ROW_LENGTH = 6;

/** The row a `place-soil-tile` request may name: at least two beds, at most twelve. */
export const TRACTOR_ROW_MIN = 2;
export const TRACTOR_ROW_MAX = 12;

export const TRACTOR_NEEDED = "You need a tractor to work a whole row.";
export const TRACTOR_ROW_NOT_STRAIGHT = "A tractor row runs in one straight line.";
export const GET_OFF_TRACTOR_FIRST = "Get off the tractor first.";

export type Facing = "up" | "down" | "left" | "right";

export interface RowTile {
  tx: number;
  ty: number;
}

const STEP: Readonly<Record<Facing, RowTile>> = {
  up: { tx: 0, ty: -1 },
  down: { tx: 0, ty: 1 },
  left: { tx: -1, ty: 0 },
  right: { tx: 1, ty: 0 },
};

export function isStackAcresEquipment(value: unknown): value is StackAcresEquipment {
  return typeof value === "string" && (STACKACRES_EQUIPMENT as readonly string[]).includes(value);
}

export function isStackAcresBuyableEquipment(value: unknown): value is StackAcresBuyableEquipment {
  return typeof value === "string" && (STACKACRES_BUYABLE_EQUIPMENT as readonly string[]).includes(value);
}

/** What a farm owns, in catalogue order, from the stored rows. Unknown or repeated names are dropped. */
export function ownedStackAcresEquipment(rows: readonly unknown[]): StackAcresEquipment[] {
  const have = new Set(rows.filter(isStackAcresEquipment));
  return STACKACRES_EQUIPMENT.filter((kind) => have.has(kind));
}

/** `length` beds in a line, starting with `from` and running the way the tractor faces. */
export function tilesAhead(from: RowTile, facing: Facing, length = TRACTOR_ROW_LENGTH): RowTile[] {
  const step = STEP[facing];
  return Array.from({ length: Math.max(0, length) }, (_, i) => ({ tx: from.tx + step.tx * i, ty: from.ty + step.ty * i }));
}

/** The beds from the front of `row` up to the first one that cannot be worked. */
export function workableRun(row: readonly RowTile[], canWork: (tile: RowTile) => boolean): RowTile[] {
  const run: RowTile[] = [];
  for (const tile of row) {
    if (!canWork(tile)) break;
    run.push(tile);
  }
  return run;
}

/**
 * Whether these beds are one straight, unbroken row: all on one line, none
 * named twice, no gaps. Order does not matter. What the server holds a
 * `tiles` request to, so a forged list cannot work beds scattered over the farm.
 */
export function isStraightRow(tiles: readonly RowTile[]): boolean {
  if (tiles.length < TRACTOR_ROW_MIN || tiles.length > TRACTOR_ROW_MAX) return false;
  const sameRow = tiles.every((tile) => tile.ty === tiles[0].ty);
  const sameColumn = tiles.every((tile) => tile.tx === tiles[0].tx);
  if (sameRow === sameColumn) return false;
  const along = tiles.map((tile) => (sameRow ? tile.tx : tile.ty));
  if (new Set(along).size !== along.length) return false;
  return Math.max(...along) - Math.min(...along) === along.length - 1;
}
