/**
 * The city grocery's floor, as things the owner can move: its shelving, checkout lanes, produce island and
 * bakery counter (fixtures), and its plants, lamps and rugs (decor). The same rules run in the browser (to
 * paint green and red squares while placing) and on the server, which has the final say.
 *
 * The room itself (walls, the stockroom bay, the doorway, the manager's corner and its desk, the Help Wanted
 * board) never moves: it is the exported room (public/stackacres-td/areas/grocery/area.json) with every
 * default fixture lifted out. Each fixture's picture is the pieces of that room that stood on it, so a
 * fixture that moves looks exactly as it did where the floor plan put it. Decor comes from its own sheet
 * (`art/stackacres-td/rich/lpc_rooms.py`'s `grocery_decor()`, exported by `export_grocery_decor.py`).
 *
 * A fixture brings its own squares with it: the ones it stands on, the ones people work or shop from (the
 * zones the store simulation reads, lib/stackacres-td/worksite.ts), and the ones that must stay open floor
 * (the way out of a checkout lane). No square is used twice. Rugs lie under everything and only mind
 * other rugs. And whatever the owner builds, shoppers must still reach every shelf, counter and lane from
 * the door and get back out, and staff must reach every post, shelf and the break chair from the stockroom
 * without cutting down a checkout lane.
 *
 * Gold enters nowhere here. It leaves once per thing bought (lib/server/stackacres-service.ts).
 */

import room from "@/public/stackacres-td/areas/grocery/area.json";
import decorPieces from "@/public/stackacres-td/areas/grocery/decor-pieces.json";

export interface Cell {
  tx: number;
  ty: number;
}

type Rel = readonly [number, number];

export interface RoomProp {
  frame: string;
  frames: string[];
  x: number;
  y: number;
  ax: number;
  ay: number;
  w: number;
  h: number;
  scale: number;
  blocks: [number, number][];
  tag?: string;
  passable?: boolean;
  /** The texture it's drawn from, when not the room's own props sheet. */
  atlas?: string;
  /** Lies on the floor under everything (a rug). */
  flat?: boolean;
}

export interface RoomZone {
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomLight {
  kind: string;
  x: number;
  y: number;
}

/** The part of an area.json this builds on; the rest passes through untouched. */
export interface GroceryRoomSpec {
  width: number;
  height: number;
  tile: number;
  props: RoomProp[];
  blocked: [number, number][];
  zones: RoomZone[];
  lights: RoomLight[];
}

/** A picture of part of a fixture or a piece of decor, placed from its item's top-left corner in map px. */
export interface GroceryPiece {
  atlas: "props" | "decor";
  frame: string;
  x: number;
  y: number;
  ax: number;
  ay: number;
  w: number;
  h: number;
  scale: number;
  flat?: boolean;
}

export const GROCERY_ITEM_KINDS = [
  "lane",
  "gondola",
  "produce",
  "fridge",
  "wallshelf",
  "pantry",
  "bulk",
  "bakery",
  "fern",
  "flowerbox",
  "topiary",
  "fig",
  "floorlamp",
  "clock",
  "bench",
  "barrel",
  "carts",
  "rug-large",
  "rug-small",
  "rug-gold",
] as const;
export type GroceryItemKind = (typeof GROCERY_ITEM_KINDS)[number];

export function isGroceryItemKind(value: string): value is GroceryItemKind {
  return (GROCERY_ITEM_KINDS as readonly string[]).includes(value);
}

interface ZoneDef {
  /** The zone's tag; `{id}` becomes the item's own name in the store, `{n}` the till's number. */
  tag: string;
  cells: readonly Rel[];
}

export interface GroceryItemDef {
  label: string;
  /** One line for the tray. */
  blurb: string;
  group: "fixture" | "decor";
  /** The item's plan in squares; a placed item's (tx, ty) is its top-left square. */
  w: number;
  h: number;
  /** Squares it stands on, from its top-left. */
  solid: readonly Rel[];
  /** Squares people work or shop from. */
  zones: readonly ZoneDef[];
  /** Squares that must stay open floor: the way out of a checkout lane, the cashier's way in. */
  keepOpen: readonly Rel[];
  /** Stands against the back wall, so its top row must be the first row of floor. */
  backWall: boolean;
  /** A rug: blocks nothing, lies under everything, and only minds other rugs. */
  flat: boolean;
  /** Buying another costs this. Moving, picking up and putting down are free. */
  gold: number;
  /** How much it adds to the store's appeal (decor). */
  appeal: number;
  /** Most the store can have, placed or stored. */
  max: number;
  /** A lamp's glow, from the top-left in map px. */
  light?: { x: number; y: number; kind: string };
}

const row = (x0: number, x1: number, y: number): Rel[] => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as const);
const col = (x: number, y0: number, y1: number): Rel[] => Array.from({ length: y1 - y0 + 1 }, (_, i) => [x, y0 + i] as const);
const block = (w: number, h: number): Rel[] => Array.from({ length: h }, (_, y) => row(0, w - 1, y)).flat();
const decorDef = (label: string, blurb: string, w: number, h: number, gold: number, appeal: number, max: number, extra: Partial<GroceryItemDef> = {}): GroceryItemDef => ({
  label,
  blurb,
  group: "decor",
  w,
  h,
  solid: block(w, h),
  zones: [],
  keepOpen: [],
  backWall: false,
  flat: false,
  gold,
  appeal,
  max,
  ...extra,
});

// Prices are a first pass for the economy tuning to revisit (docs/stackacres-second-map-direction.md).
export const GROCERY_ITEMS: Readonly<Record<GroceryItemKind, GroceryItemDef>> = {
  lane: {
    label: "Checkout lane",
    blurb: "A till with its own queue. One cashier works each.",
    group: "fixture",
    w: 3,
    h: 3,
    // The belt down the middle, the sweets rack above the cashier.
    solid: [...col(1, 0, 2), ...col(2, 0, 1)],
    zones: [
      { tag: "till:{n}:clerk", cells: [[2, 2]] },
      { tag: "till:{n}:pay", cells: [[0, 2]] },
      { tag: "till:{n}:line", cells: [[0, 1], [0, 0]] },
    ],
    // Shoppers leave out of the bottom of the lane; the cashier comes in from below their square.
    keepOpen: [[0, 3], [2, 3]],
    backWall: false,
    flat: false,
    gold: 2500,
    appeal: 0,
    max: 6,
  },
  gondola: {
    label: "Aisle shelving",
    blurb: "A double-sided run of shelves with an endcap. Browsed from both sides.",
    group: "fixture",
    w: 10,
    h: 3,
    solid: row(0, 8, 1),
    zones: [
      { tag: "shelf:{id}-n", cells: [...row(0, 7, 0), [9, 1]] },
      { tag: "shelf:{id}-s", cells: row(0, 7, 2) },
    ],
    keepOpen: [],
    backWall: false,
    flat: false,
    gold: 1500,
    appeal: 0,
    max: 4,
  },
  produce: {
    label: "Produce island",
    blurb: "Fruit and veg served over a three-place counter, with one queue.",
    group: "fixture",
    w: 10,
    h: 5,
    solid: [...row(1, 6, 0), ...row(1, 6, 3)],
    zones: [
      { tag: "produce:table-0", cells: row(1, 3, 1) },
      { tag: "produce:table-1", cells: row(4, 6, 1) },
      { tag: "produce:table-2", cells: [[1, 2]] },
      { tag: "produce:table-3", cells: row(5, 6, 2) },
      { tag: "produce:2:clerk", cells: [[2, 2]] },
      { tag: "produce:0:clerk", cells: [[3, 2]] },
      { tag: "produce:1:clerk", cells: [[4, 2]] },
      { tag: "produce:2:order", cells: [[2, 4]] },
      { tag: "produce:0:order", cells: [[3, 4]] },
      { tag: "produce:1:order", cells: [[4, 4]] },
      { tag: "produce:line", cells: row(5, 9, 4) },
      // The clerks' floor inside the island, open at both ends.
      { tag: "staff", cells: [...row(0, 7, 1), ...row(0, 7, 2)] },
    ],
    keepOpen: [],
    backWall: false,
    flat: false,
    gold: 4000,
    appeal: 0,
    max: 1,
  },
  fridge: {
    label: "Dairy fridges",
    blurb: "Milk, cheese and eggs, against the back wall.",
    group: "fixture",
    w: 4,
    h: 2,
    solid: row(0, 3, 0),
    zones: [{ tag: "shelf:{id}", cells: row(0, 3, 1) }],
    keepOpen: [],
    backWall: true,
    flat: false,
    gold: 1200,
    appeal: 0,
    max: 3,
  },
  wallshelf: {
    label: "Wall shelving",
    blurb: "Packaged goods, against the back wall.",
    group: "fixture",
    w: 7,
    h: 2,
    solid: row(0, 6, 0),
    zones: [{ tag: "shelf:{id}", cells: row(0, 6, 1) }],
    keepOpen: [],
    backWall: true,
    flat: false,
    gold: 1000,
    appeal: 0,
    max: 3,
  },
  pantry: {
    label: "Pantry bins",
    blurb: "Barrels and grain bins, against the back wall.",
    group: "fixture",
    w: 6,
    h: 2,
    solid: row(0, 5, 0),
    zones: [{ tag: "shelf:{id}", cells: row(0, 5, 1) }],
    keepOpen: [],
    backWall: true,
    flat: false,
    gold: 900,
    appeal: 0,
    max: 2,
  },
  bulk: {
    label: "Bulk bins",
    blurb: "Scoop-your-own grains, browsed from the left.",
    group: "fixture",
    w: 2,
    h: 5,
    solid: col(1, 0, 4),
    zones: [{ tag: "shelf:{id}", cells: col(0, 0, 4) }],
    keepOpen: [],
    backWall: false,
    flat: false,
    gold: 800,
    appeal: 0,
    max: 3,
  },
  bakery: {
    label: "Bakery counter",
    blurb: "Fresh bread, browsed from the front.",
    group: "fixture",
    w: 4,
    h: 2,
    solid: row(0, 3, 1),
    zones: [{ tag: "shelf:{id}", cells: row(0, 3, 0) }],
    keepOpen: [],
    backWall: false,
    flat: false,
    gold: 1200,
    appeal: 0,
    max: 2,
  },
  fern: decorDef("Fern box", "A planter of ferns.", 1, 1, 150, 6, 12),
  flowerbox: decorDef("Flower pot", "Pink flowers in a painted pot.", 1, 1, 200, 8, 12),
  topiary: decorDef("Topiary", "A clipped tree in a blue pot.", 1, 1, 350, 12, 8),
  fig: decorDef("Fig tree", "A little fig tree over a flower box.", 1, 1, 300, 10, 8),
  floorlamp: decorDef("Floor lamp", "A warm lamp that glows at night.", 1, 1, 300, 10, 8, { light: { x: 8, y: -22, kind: "lamp" } }),
  clock: decorDef("Grandfather clock", "Keeps the shop's time.", 1, 1, 800, 20, 2),
  bench: decorDef("Bench", "Somewhere to sit and rest your feet.", 2, 1, 400, 12, 4),
  barrel: decorDef("Apple barrel", "A barrel of apples by the door.", 1, 1, 100, 3, 8),
  carts: decorDef("Shopping carts", "A row of carts for big shops.", 2, 1, 200, 5, 3),
  "rug-large": decorDef("Large green rug", "The store's own green, eight by four.", 8, 4, 600, 18, 3, { solid: [], flat: true }),
  "rug-small": decorDef("Green rug", "A smaller rug in the store's green.", 4, 3, 300, 10, 6, { solid: [], flat: true }),
  "rug-gold": decorDef("Gold rug", "A welcoming gold rug.", 4, 2, 250, 8, 6, { solid: [], flat: true }),
};

export interface GroceryPlacement {
  id: string;
  kind: GroceryItemKind;
  /** Top-left square, or null while it waits in storage. */
  tx: number | null;
  ty: number | null;
}

export interface PlacedGroceryItem extends GroceryPlacement {
  tx: number;
  ty: number;
}

export function isPlacedItem(item: GroceryPlacement): item is PlacedGroceryItem {
  return item.tx !== null && item.ty !== null;
}

/** The floor plan the store comes with (art/stackacres-td/rich/grocery-v3/plan.py). */
export const DEFAULT_GROCERY_LAYOUT: readonly PlacedGroceryItem[] = [
  { id: "fridge-1", kind: "fridge", tx: 1, ty: 3 },
  { id: "wallshelf-1", kind: "wallshelf", tx: 5, ty: 3 },
  { id: "pantry-1", kind: "pantry", tx: 20, ty: 3 },
  { id: "gondola-1", kind: "gondola", tx: 2, ty: 6 },
  { id: "gondola-2", kind: "gondola", tx: 2, ty: 9 },
  { id: "rug-1", kind: "rug-large", tx: 14, ty: 7 },
  { id: "produce-1", kind: "produce", tx: 14, ty: 7 },
  { id: "bulk-1", kind: "bulk", tx: 25, ty: 6 },
  { id: "fig-1", kind: "fig", tx: 26, ty: 12 },
  { id: "lane-1", kind: "lane", tx: 1, ty: 12 },
  { id: "lane-2", kind: "lane", tx: 4, ty: 12 },
  { id: "lane-3", kind: "lane", tx: 7, ty: 12 },
  { id: "lane-4", kind: "lane", tx: 10, ty: 12 },
  { id: "bakery-1", kind: "bakery", tx: 22, ty: 13 },
  { id: "carts-1", kind: "carts", tx: 17, ty: 16 },
];

const ROOM = room as unknown as GroceryRoomSpec;
/** The decor sheet's pieces by kind (art/stackacres-td/rich/export_grocery_decor.py). */
const DECOR_SHEET = decorPieces as unknown as Record<string, Omit<GroceryPiece, "atlas">[] | undefined>;
const TILE = ROOM.tile;
const key = (tx: number, ty: number) => `${tx},${ty}`;
const cellsOf = (rels: readonly Rel[], tx: number, ty: number): Cell[] => rels.map(([dx, dy]) => ({ tx: tx + dx, ty: ty + dy }));

export function itemSolid(kind: GroceryItemKind, tx: number, ty: number): Cell[] {
  return cellsOf(GROCERY_ITEMS[kind].solid, tx, ty);
}

export function itemFootprint(kind: GroceryItemKind, tx: number, ty: number): Cell[] {
  const { w, h } = GROCERY_ITEMS[kind];
  return cellsOf(block(w, h), tx, ty);
}

/** Where a room prop stands: the square under its base point. */
const propCell = (prop: RoomProp): Cell => ({ tx: Math.floor(prop.x / TILE), ty: Math.floor((prop.y - 1) / TILE) });

/**
 * What the room looks like without its fixtures and default decor, and each item's pictures, cut from the
 * room: every prop standing on a default item's squares belongs to it. Every default item of a kind gives
 * that kind a look (the two runs of shelving carry different goods, the lanes alternate their racks), and
 * items bought later take them in turn.
 */
const CUT = (() => {
  const variants = new Map<GroceryItemKind, GroceryPiece[][]>();
  const claimed = new Set<number>();
  const liftedCells = new Set<string>();
  const liftedZones = new Set<string>();
  for (const item of DEFAULT_GROCERY_LAYOUT) {
    const def = GROCERY_ITEMS[item.kind];
    for (const c of itemSolid(item.kind, item.tx, item.ty)) liftedCells.add(key(c.tx, c.ty));
    for (const zone of def.zones) for (const c of cellsOf(zone.cells, item.tx, item.ty)) liftedZones.add(key(c.tx, c.ty));
    if (DECOR_SHEET[item.kind]) continue;
    const solid = new Set(itemSolid(item.kind, item.tx, item.ty).map((c) => key(c.tx, c.ty)));
    const pieces: GroceryPiece[] = [];
    ROOM.props.forEach((prop, index) => {
      const at = propCell(prop);
      if (claimed.has(index) || !solid.has(key(at.tx, at.ty))) return;
      claimed.add(index);
      pieces.push({
        atlas: "props",
        frame: prop.frame,
        x: prop.x - item.tx * TILE,
        y: prop.y - item.ty * TILE,
        ax: prop.ax,
        ay: prop.ay,
        w: prop.w,
        h: prop.h,
        scale: prop.scale,
      });
    });
    variants.set(item.kind, [...(variants.get(item.kind) ?? []), pieces]);
  }
  for (const kind of GROCERY_ITEM_KINDS) {
    const fromDecorSheet = DECOR_SHEET[kind];
    if (fromDecorSheet) variants.set(kind, [fromDecorSheet.map((piece) => ({ ...piece, atlas: "decor" as const }))]);
  }
  const shell: GroceryRoomSpec = {
    ...ROOM,
    props: ROOM.props.filter((_, index) => !claimed.has(index)),
    blocked: ROOM.blocked.filter(([tx, ty]) => !liftedCells.has(key(tx, ty))),
    zones: ROOM.zones.filter((z) => !liftedZones.has(key(Math.floor(z.x / TILE), Math.floor(z.y / TILE)))),
  };
  return { variants, shell };
})();

/** An item kind's looks. Every kind has at least one. */
export function itemVariants(kind: GroceryItemKind): GroceryPiece[][] {
  return CUT.variants.get(kind) ?? [[]];
}

/** The room with nothing in it but what never moves. */
export const GROCERY_SHELL: GroceryRoomSpec = CUT.shell;

const SHELL_BLOCKED = new Set(GROCERY_SHELL.blocked.map(([tx, ty]) => key(tx, ty)));
for (const prop of GROCERY_SHELL.props) for (const [tx, ty] of prop.blocks) SHELL_BLOCKED.add(key(tx, ty));
const SHELL_ZONES = new Map<string, string[]>();
for (const z of GROCERY_SHELL.zones) {
  const k = key(Math.floor(z.x / TILE), Math.floor(z.y / TILE));
  SHELL_ZONES.set(k, [...(SHELL_ZONES.get(k) ?? []), z.tag]);
}
const shellCells = (tag: string): Cell[] =>
  GROCERY_SHELL.zones.filter((z) => z.tag === tag).map((z) => ({ tx: Math.floor(z.x / TILE), ty: Math.floor(z.y / TILE) }));

/** The room's first row of floor, along the back wall: what stands against it goes here. */
const BACK_ROW = (() => {
  for (let ty = 0; ty < ROOM.height; ty++) if (!SHELL_BLOCKED.has(key(1, ty))) return ty;
  return 0;
})();

/**
 * Squares kept open whatever is built: the floor in front of the doorway, and where the owner stands to use
 * the manager's desk (beside it, on the shop side) and the Help Wanted board (under it, by the mop).
 */
export const OWNER_SQUARES: Readonly<Record<"desk" | "board", readonly Cell[]>> = {
  desk: [{ tx: 21, ty: 15 }, { tx: 21, ty: 16 }],
  board: [{ tx: 13, ty: 5 }],
};
const KEEP_CLEAR = new Set<string>(
  [
    ...[...shellCells("door:in"), ...shellCells("door:out")].map((d) => ({ tx: d.tx, ty: d.ty - 1 })),
    ...OWNER_SQUARES.desk,
    ...OWNER_SQUARES.board,
  ].map((c) => key(c.tx, c.ty)),
);

/** Squares a shopper may never set foot on, from the room itself. */
const SHELL_STAFF_ONLY = new Set(shellCells("staff").map((c) => key(c.tx, c.ty)));

function inFloor(c: Cell): boolean {
  return c.tx > 0 && c.ty > 0 && c.tx < ROOM.width - 1 && c.ty < ROOM.height - 1 && !SHELL_BLOCKED.has(key(c.tx, c.ty));
}

/** Items of a kind in a stable order (top to bottom, left to right), which is how tills are numbered. */
function ordered(items: readonly PlacedGroceryItem[]): PlacedGroceryItem[] {
  return [...items].sort((a, b) => a.ty - b.ty || a.tx - b.tx || (a.id < b.id ? -1 : 1));
}

/** Each placed item's name in the store (the display ids the simulation uses) and, for a lane, its till number. */
function names(placed: readonly PlacedGroceryItem[]): Map<string, { id: string; n: number }> {
  const out = new Map<string, { id: string; n: number }>();
  const count = new Map<GroceryItemKind, number>();
  for (const item of ordered(placed)) {
    const n = count.get(item.kind) ?? 0;
    count.set(item.kind, n + 1);
    out.set(item.id, { id: `${item.kind}${n + 1}`, n });
  }
  return out;
}

export interface ItemZone extends Cell {
  tag: string;
}

/** The zones a placed item brings, tags filled in. */
function zonesOf(item: PlacedGroceryItem, name: { id: string; n: number }): ItemZone[] {
  return GROCERY_ITEMS[item.kind].zones.flatMap((zone) =>
    cellsOf(zone.cells, item.tx, item.ty).map((c) => ({ ...c, tag: zone.tag.replace("{id}", name.id).replace("{n}", String(name.n)) })),
  );
}

/**
 * The room with these items in it, as an area.json the scene draws and the store simulation reads. Items in
 * storage are left out.
 */
export function composeGroceryRoom<T extends GroceryRoomSpec>(base: T, layout: readonly GroceryPlacement[]): T {
  const placed = layout.filter(isPlacedItem);
  const named = names(placed);
  const props: RoomProp[] = [...base.props];
  const blocked = new Set(base.blocked.map(([tx, ty]) => key(tx, ty)));
  const zones: RoomZone[] = [...base.zones];
  const lights: RoomLight[] = [...base.lights];
  const seen = new Map<GroceryItemKind, number>();
  // Rugs first, so they're under everything even before depth sorting.
  const drawOrder = [...placed].sort((a, b) => Number(GROCERY_ITEMS[b.kind].flat) - Number(GROCERY_ITEMS[a.kind].flat));
  for (const item of drawOrder) {
    const def = GROCERY_ITEMS[item.kind];
    const looks = itemVariants(item.kind);
    const look = seen.get(item.kind) ?? 0;
    seen.set(item.kind, look + 1);
    for (const piece of looks[look % looks.length]) {
      props.push({
        frame: piece.frame,
        frames: [piece.frame],
        x: item.tx * TILE + piece.x,
        y: item.ty * TILE + piece.y,
        ax: piece.ax,
        ay: piece.ay,
        w: piece.w,
        h: piece.h,
        scale: piece.scale,
        blocks: [],
        ...(piece.atlas === "decor" ? { atlas: "decor:grocery" } : {}),
        ...(def.flat ? { flat: true, passable: true } : {}),
      });
    }
    for (const c of itemSolid(item.kind, item.tx, item.ty)) blocked.add(key(c.tx, c.ty));
    for (const z of zonesOf(item, named.get(item.id)!)) zones.push({ tag: z.tag, x: z.tx * TILE, y: z.ty * TILE, w: TILE, h: TILE });
    if (def.light) lights.push({ kind: def.light.kind, x: item.tx * TILE + def.light.x, y: item.ty * TILE + TILE + def.light.y });
  }
  return {
    ...base,
    props,
    blocked: [...blocked].map((k) => k.split(",").map(Number) as [number, number]),
    zones,
    lights,
  };
}

export type ArrangeProblem = "edge" | "wall" | "taken" | "door" | "path" | "lane" | "max" | "last-till" | "last-display";

export const ARRANGE_MESSAGES: Readonly<Record<ArrangeProblem, string>> = {
  edge: "It doesn't fit there.",
  wall: "That goes against the back wall.",
  taken: "Something's already there.",
  door: "Keep the doorway and the desk clear.",
  path: "Shoppers or staff couldn't get round.",
  lane: "Leave room below the lane to walk out.",
  max: "The shop has room for no more of those.",
  "last-till": "The shop needs at least one till.",
  "last-display": "The shop needs something to sell.",
};

/** Every square an item claims for itself, once each: what it stands on and where people stand to use it. */
function claims(item: PlacedGroceryItem): Cell[] {
  const def = GROCERY_ITEMS[item.kind];
  const all = [...itemSolid(item.kind, item.tx, item.ty), ...def.zones.flatMap((zone) => cellsOf(zone.cells, item.tx, item.ty))];
  return [...new Map(all.map((c) => [key(c.tx, c.ty), c])).values()];
}

/** Why this layout doesn't work, or null when it does. Checked whole, so a move is its layout after the move. */
export function layoutProblem(layout: readonly GroceryPlacement[], alsoReach: readonly Cell[] = []): ArrangeProblem | null {
  const placed = layout.filter(isPlacedItem);
  for (const kind of GROCERY_ITEM_KINDS) {
    if (layout.filter((item) => item.kind === kind).length > GROCERY_ITEMS[kind].max) return "max";
  }
  if (!placed.some((item) => item.kind === "lane")) return "last-till";
  if (!placed.some((item) => GROCERY_ITEMS[item.kind].zones.some((zone) => zone.tag.startsWith("shelf:") || zone.tag.startsWith("produce:table")))) {
    return "last-display";
  }

  // Everything in the room, on the floor, against the wall where it must be; no square used twice.
  const used = new Set<string>();
  const open = new Set<string>();
  const rugs = new Set<string>();
  for (const item of placed) {
    const def = GROCERY_ITEMS[item.kind];
    const footprint = def.flat ? itemFootprint(item.kind, item.tx, item.ty) : claims(item);
    if (footprint.some((c) => !inFloor(c))) return "edge";
    if (def.backWall && item.ty !== BACK_ROW) return "wall";
    if (def.flat) {
      for (const c of footprint) {
        if (rugs.has(key(c.tx, c.ty))) return "taken";
        rugs.add(key(c.tx, c.ty));
      }
      continue;
    }
    for (const c of footprint) {
      const k = key(c.tx, c.ty);
      if (SHELL_ZONES.has(k) || used.has(k)) return "taken";
      if (open.has(k)) return "lane";
      if (KEEP_CLEAR.has(k)) return "door";
      used.add(k);
    }
    for (const c of cellsOf(def.keepOpen, item.tx, item.ty)) {
      const k = key(c.tx, c.ty);
      if (!inFloor(c) || used.has(k) || open.has(k)) return "lane";
      open.add(k);
    }
  }
  for (const k of open) if (used.has(k)) return "lane";

  return reachProblem(placed, alsoReach);
}

/** Shoppers reach everything they shop from and get out; staff reach everything they work from. */
function reachProblem(placed: readonly PlacedGroceryItem[], alsoReach: readonly Cell[]): ArrangeProblem | null {
  const named = names(placed);
  const solid = new Set<string>(SHELL_BLOCKED);
  for (const item of placed) for (const c of itemSolid(item.kind, item.tx, item.ty)) solid.add(key(c.tx, c.ty));
  const zones = placed.flatMap((item) => zonesOf(item, named.get(item.id)!));
  const tagged = (test: (tag: string) => boolean) => zones.filter((z) => test(z.tag));
  const lanes = new Set(tagged((tag) => /^till:\d+:(line|pay)$/.test(tag)).map((z) => key(z.tx, z.ty)));
  const staffOnly = new Set<string>([
    ...SHELL_STAFF_ONLY,
    ...tagged((tag) => tag === "staff" || tag.endsWith(":clerk") || tag.startsWith("produce:table")).map((z) => key(z.tx, z.ty)),
  ]);

  const walk = (from: readonly Cell[], barred: (k: string) => boolean): Set<string> => {
    const reached = new Set<string>();
    const queue: Cell[] = [];
    for (const c of from) {
      const k = key(c.tx, c.ty);
      if (solid.has(k) || reached.has(k)) continue;
      reached.add(k);
      queue.push(c);
    }
    for (let head = 0; head < queue.length; head++) {
      const { tx, ty } = queue[head];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = { tx: tx + dx, ty: ty + dy };
        const k = key(next.tx, next.ty);
        if (reached.has(k) || solid.has(k) || !inFloor(next) || barred(k)) continue;
        reached.add(k);
        queue.push(next);
      }
    }
    return reached;
  };
  const has = (set: Set<string>, c: Cell) => set.has(key(c.tx, c.ty));
  const beside = (set: Set<string>, c: Cell) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => set.has(key(c.tx + dx, c.ty + dy)));

  // Shoppers: in at the door, never behind a counter, and never down a lane they aren't queueing in.
  const shoppers = walk(shellCells("door:in"), (k) => staffOnly.has(k) || lanes.has(k));
  for (const z of tagged((tag) => tag.startsWith("shelf:") || tag.endsWith(":order") || tag === "produce:line")) {
    if (!has(shoppers, z)) return "path";
  }
  // Each lane is joined at the back of its queue and left out of the bottom.
  for (const item of placed.filter((i) => i.kind === "lane")) {
    const back = { tx: item.tx, ty: item.ty };
    if (!beside(shoppers, back)) return "path";
    const out = walk([{ tx: item.tx, ty: item.ty + 3 }], (k) => staffOnly.has(k) || lanes.has(k));
    if (!shellCells("door:out").some((d) => has(out, d))) return "path";
  }
  // Staff: out of the stockroom to every post, shelf, produce table and the break chair, never down a lane.
  const staff = walk(shellCells("stockroom"), (k) => lanes.has(k));
  for (const z of tagged((tag) => tag.startsWith("shelf:") || tag.endsWith(":clerk") || tag.startsWith("produce:table"))) {
    if (!has(staff, z)) return "path";
  }
  for (const c of shellCells("break")) if (!has(staff, c)) return "path";
  // The owner, from the door: the desk, the board, and wherever the browser says (where they stand).
  const owner = walk(shellCells("door:in"), () => false);
  for (const k of KEEP_CLEAR) {
    const [tx, ty] = k.split(",").map(Number);
    if (!owner.has(k) && inFloor({ tx, ty })) return "path";
  }
  for (const c of alsoReach) if (!has(owner, c)) return "path";
  return null;
}

/** The layout with one item moved, put down or picked up (null squares), by id; a new id is added. */
export function withItem(layout: readonly GroceryPlacement[], item: GroceryPlacement): GroceryPlacement[] {
  return layout.some((i) => i.id === item.id) ? layout.map((i) => (i.id === item.id ? item : i)) : [...layout, item];
}

/** Which squares, if any, a placed item's picture covers, for a tap on the map in arrange mode. */
export function itemAt(layout: readonly GroceryPlacement[], cell: Cell): PlacedGroceryItem | null {
  const placed = layout.filter(isPlacedItem);
  // Solid things before rugs, and the last put down first.
  const hits = placed.filter((item) => {
    const def = GROCERY_ITEMS[item.kind];
    const cells = def.flat ? itemFootprint(item.kind, item.tx, item.ty) : itemSolid(item.kind, item.tx, item.ty);
    return cells.some((c) => c.tx === cell.tx && c.ty === cell.ty);
  });
  hits.sort((a, b) => Number(GROCERY_ITEMS[a.kind].flat) - Number(GROCERY_ITEMS[b.kind].flat));
  return hits[0] ?? null;
}

/** What the layout gives the store to work with, for its takings (./grocery-economy.ts). */
export interface GroceryCapacity {
  tills: number;
  counters: number;
  /** Squares shoppers browse shelves from. */
  shelfSpots: number;
  /** Squares of produce on the market tables. */
  produceSpots: number;
  appeal: number;
}

export function layoutCapacity(layout: readonly GroceryPlacement[]): GroceryCapacity {
  const placed = layout.filter(isPlacedItem);
  let shelfSpots = 0;
  let produceSpots = 0;
  let counters = 0;
  let appeal = 0;
  for (const item of placed) {
    const def = GROCERY_ITEMS[item.kind];
    appeal += def.appeal;
    for (const zone of def.zones) {
      if (zone.tag.startsWith("shelf:")) shelfSpots += zone.cells.length;
      if (zone.tag.startsWith("produce:table")) produceSpots += zone.cells.length;
      if (/^produce:\d+:clerk$/.test(zone.tag)) counters += 1;
    }
  }
  return { tills: placed.filter((item) => item.kind === "lane").length, counters, shelfSpots, produceSpots, appeal };
}

/**
 * The layout as one string, placed items by id as `id:kind:tx:ty`, sorted. The server checks the rules against
 * the layout it read and writes only if the layout is still that one.
 */
export function layoutFingerprint(layout: readonly GroceryPlacement[]): string {
  return layout
    .map((item) => `${item.id}:${item.kind}:${item.tx ?? "-"}:${item.ty ?? "-"}`)
    .sort()
    .join(",");
}

export const GROCERY_ROOM_SIZE = { width: ROOM.width, height: ROOM.height, tile: TILE };
