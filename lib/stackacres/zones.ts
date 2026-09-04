/**
 * The map as a set of PLACES rather than one lawn with a farm on it.
 *
 * The farm itself was finished before this: a plot ladder, a barn yard, a
 * pond, three dirt paths and procedurally-grown woodland running to the
 * horizon in every direction. The woodland is what made the world feel
 * empty. It is deterministic and endless, so panning any distance found
 * more of exactly what was already on screen -- there was nowhere to GO.
 * A map needs destinations, and a destination is somewhere that looks
 * different when you arrive, has its own things standing in it, and can be
 * reached by a road that was already pointing at it.
 *
 * So: four districts. The farmstead is the one that already existed and is
 * NOT redefined here -- its rect is restated so `zoneAt` can name it, and
 * nothing about the plots, the economy, the barn or the pond moves. The
 * other three hang off the three roads that already left the yard and
 * previously ended in trees:
 *
 *   the lane  runs south past the mailbox  ->  the Long Meadow
 *   the road  runs east past the windmill  ->  the Ox Fields
 *   the track runs north-west into the woods -> the Fold
 *
 * That is the whole trick, and it is why no road had to be invented: the
 * map already promised three journeys and delivered none of them.
 *
 * Everything here is pure and in world units -- ./world.ts's true Cartesian
 * plane, NOT the sheared screen space the scene draws into. The camera's
 * isometric tilt lives entirely in ./iso.ts and nothing in this file knows
 * about it, exactly as ./paths.ts and ./water.ts do not.
 *
 * Types only from ./world, and literals everywhere else. This module is
 * imported BY world.ts (`chunkScenery` has to know not to grow a forest in
 * the middle of a meadow), so a runtime import back of any of its constants
 * would be read before world.ts finished evaluating and throw -- the same
 * arrangement ./paths.ts and ./water.ts already have with it. The numbers
 * this file is measured against, restated once here: the Farmstead's Hen
 * Coop block is x 170..330, y 200..360; `FARM_ZONE` is x 28..440, y -60..410;
 * the lane ends at the mailbox (50, 402); the road's east leg runs along
 * y ~46 and turns north-east at x 430; the track leaves (60, 46) and ends at
 * (-140, -260); the pond spans x -84..20, y 80..160. `PEN_BLOCKS` below
 * restates the other three kinds' own 2x2 blocks (their real definition is
 * `PEN_GROUP_ORIGIN` in ./world.ts) for the same reason.
 */

import type { WorldPoint, WorldRect } from "./world";
// Type-only, and deliberately so: ./tools.ts imports `zoneToolPolicy` from
// here as a value, so a value import in this direction would be a cycle.
import type { StackAcresTool } from "./tools";
// A value import, and safe: world.ts imports THIS module, this module imports
// paths.ts, and paths.ts imports only types back from world.ts -- so nothing
// in the chain reads a constant from a module still evaluating.
import { nearPath } from "./paths";

export const ZONE_IDS = ["farmstead", "meadow", "oxfields", "wallow"] as const;

export type ZoneId = (typeof ZONE_IDS)[number];

/** The ground a district is made of. Drawn as projected diamond tiles over
 *  the lawn (see `zoneGroundTiles`), never as one baked rectangle: a big
 *  axis-aligned texture laid on a diamond grid reads as a bug, which is the
 *  known open gap the path and pond bakes still carry. */
export interface ZoneGround {
  /** The district's own colour, over the lawn. */
  base: number;
  /**
   * A second colour dealt to about a third of the tiles, so the ground is
   * never one flat wash.
   *
   * It has to sit CLOSE to `base`. The first cut of this used a strongly
   * contrasting second brown, and at a tile's size on screen that does not
   * read as mottling -- it reads as a chessboard, which was the single most
   * obviously wrong thing on the map. Mottling is a shade, not a colour.
   */
  alt: number;
  /** How strongly the ground covers the lawn at the district's heart, 0..1.
   *  Worked ground is opaque; a meadow is a tint over grass that is still
   *  grass. */
  cover: number;
}

export interface ZoneDef {
  id: ZoneId;
  /** What the player calls it. */
  label: string;
  /** One line, for the destination strip and the arrival banner. */
  blurb: string;
  /** The district's extent in world units. This is a soft edge, not a fence:
   *  `zoneGroundTiles` feathers the outer `ZONE_FEATHER` units and jitters
   *  the border so the rectangle never reads as a rectangle. Nothing stops
   *  the camera crossing it. */
  bounds: WorldRect;
  ground: ZoneGround;
  /**
   * Where the road arrives, in world units -- the point the camera aims at
   * when the player picks this destination, and the end of the path that
   * leads here. Deliberately NOT the rect's centre: arriving at the gate and
   * seeing the district laid out beyond it reads as a place, where landing
   * in the dead middle of one reads as a teleport.
   */
  approach: WorldPoint;
}

/**
 * How far in from a district's edge its ground fades out completely.
 *
 * Every district's short side has to be more than twice this, or the fade
 * from both edges meets in the middle and the district never reaches full
 * cover anywhere -- the Fold at 200 units is the one that binds, and
 * zones.test.ts holds the relationship rather than leaving it to be
 * rediscovered the next time a district is resized.
 */
export const ZONE_FEATHER = 88;

/** The districts.
 *
 * Sizes are all comparable to the plot ladder's own 320x320 footprint -- one
 * farm-sized place each. Bigger than that and the walk across is longer than
 * the interest in it; smaller and it reads as a prop, not a destination.
 *
 * The gaps between districts are deliberate and never closed: woodland still
 * grows in them, so a district is arrived AT rather than blended into, and
 * the road is what carries you across. */
export const STACKACRES_ZONES: Readonly<Record<ZoneId, ZoneDef>> = {
  // The farm as it already is. Its rect matches `FARM_ZONE` in ./world.ts
  // exactly, because that is the rectangle wild scenery is already kept out
  // of and two different answers to "where is the farm" would drift apart.
  farmstead: {
    id: "farmstead",
    label: "The Farmstead",
    blurb: "Home base -- your Hen Coops, the barn and the pond.",
    bounds: { x: 28, y: -60, width: 412, height: 470 },
    // Cover 0: the farmstead paints no ground of its own. The lawn, the plot
    // diamonds, the paths and the pond are already the whole picture there,
    // and a wash over the top of them would only mute art that works.
    ground: { base: 0x86c96e, alt: 0x86c96e, cover: 0 },
    approach: { x: 224, y: 174 },
  },

  // South, down the lane past the mailbox. Open hay meadow, and now the real
  // Crop Fields standing in it -- the one district that was nothing but
  // grass before a pen block ever moved in.
  meadow: {
    id: "meadow",
    label: "The Long Meadow",
    blurb: "Waist-high grass, clover, buttercups, and your Crop Fields.",
    bounds: { x: 24, y: 448, width: 380, height: 320 },
    ground: { base: 0x8fce66, alt: 0x9ed473, cover: 0.42 },
    // The lane's own end, carried a little into the field.
    approach: { x: 150, y: 520 },
  },

  // East, along the road past the windmill. Heavy, rustic, worked: mud
  // furrows, hitching posts, and now the real Cattle Pens standing in them.
  oxfields: {
    id: "oxfields",
    label: "The Ox Fields",
    blurb: "Ploughed furrows, hitching posts, and the cattle you keep here.",
    bounds: { x: 500, y: 20, width: 360, height: 280 },
    ground: { base: 0x7a5a34, alt: 0x6f5230, cover: 0.86 },
    // Framed on the Cattle Pen block itself (world.ts's PEN_GROUP_ORIGIN.cattle,
    // x 680..840, y 70..230) rather than on the road's own end -- the arrival
    // shot exists to show what you came here to do, and a gate framed on the
    // road alone left the pens crowded into the corner of the window.
    approach: { x: 720, y: 150 },
  },

  // North-west, at the end of the track. Wet, low and shaded: the mud
  // wallow, a shade canopy, and now the real Sheep Pens standing in it.
  // The district keeps its internal id "wallow" (a data migration to fix a
  // caption is not worth doing), but the label players see is "The Fold" --
  // a real term for a sheep enclosure, and a better fit for what actually
  // stands here than the mud it was originally named for.
  wallow: {
    id: "wallow",
    label: "The Fold",
    blurb: "A shaded mud hollow, and the Sheep Pens that live in it.",
    // The smallest district, and its short side is what sets the floor on
    // `ZONE_FEATHER`: a district narrower than two feather-widths has no
    // full-strength ground left in the middle of it at all.
    bounds: { x: -340, y: -410, width: 240, height: 200 },
    ground: { base: 0x54402c, alt: 0x4c3927, cover: 0.9 },
    // The track's own last vertex is (-140, -260), just inside the eastern
    // corner: the camera lands at the gate looking in.
    approach: { x: -160, y: -275 },
  },
};

export const ZONE_LIST: readonly ZoneDef[] = ZONE_IDS.map((id) => STACKACRES_ZONES[id]);

/** Districts other than the farmstead: the three this pass adds, the ones
 *  that paint their own ground and grow their own scenery. */
export const OUTER_ZONE_IDS: readonly ZoneId[] = ZONE_IDS.filter((id) => id !== "farmstead");

function within(rect: WorldRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * Which district a world point is in, or null out in the woods between them.
 *
 * The farmstead is checked LAST. Nothing overlaps it today and a test holds
 * that true, but if a future district ever does creep over the farm's edge,
 * the farm's own rules have to be the ones that lose -- the farmstead rect is
 * a generous box around a place whose real content (plots, paths, buildings)
 * has its own exact geometry, so treating it as the fallback rather than the
 * first match is the safer way for that collision to break.
 */
export function zoneAt(x: number, y: number): ZoneId | null {
  for (const id of OUTER_ZONE_IDS) {
    if (within(STACKACRES_ZONES[id].bounds, x, y)) return id;
  }
  return within(STACKACRES_ZONES.farmstead.bounds, x, y) ? "farmstead" : null;
}

/** True anywhere inside a district that paints its own ground. What
 *  `chunkScenery` asks so a forest never grows in the middle of a meadow --
 *  the districts grow their own scenery instead (`zoneScenery`). */
export function inOuterZone(x: number, y: number): boolean {
  for (const id of OUTER_ZONE_IDS) {
    if (within(STACKACRES_ZONES[id].bounds, x, y)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* What a tool may do, and where                                       */
/* ------------------------------------------------------------------ */

/**
 * Which districts each tool is allowed to act in. Down to two tools now
 * (./tools.ts) -- `inspect` is the resting state and has no target to gate;
 * the scythe alone is district-specific, because its target is the GROUND,
 * not a unit, and mowing has no reason to exist anywhere but the Long Meadow.
 */
export const zoneToolPolicy: Readonly<Record<StackAcresTool, readonly ZoneId[]>> = {
  inspect: ZONE_IDS,
  scythe: ["meadow"],
};

export type ZoneActionCheck =
  | { ok: true; zone: ZoneId }
  | { ok: false; zone: ZoneId | null; reason: string };

/**
 * Whether the held tool may act at this world point, and if not, why.
 *
 * The user-facing half of `zoneToolPolicy`. `reason` is written to be shown
 * verbatim -- it names the place the tool DOES work, because a refusal that
 * only says no leaves the player to go and find out where by trial.
 */
export function isActionValidInZone(x: number, y: number, tool: StackAcresTool): ZoneActionCheck {
  const zone = zoneAt(x, y);
  const allowed = zoneToolPolicy[tool];
  if (zone !== null && allowed.includes(zone)) return { ok: true, zone };
  const homes = allowed.map((id) => STACKACRES_ZONES[id].label);
  const where =
    homes.length === 1 ? homes[0] : `${homes.slice(0, -1).join(", ")} and ${homes[homes.length - 1]}`;
  return { ok: false, zone, reason: `That only works in ${where}.` };
}

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

/** A district's ground is dealt as squares this many world units a side,
 *  each drawn as its projected diamond. Big enough that a whole district is
 *  a few dozen fills rather than a few thousand; small enough that the
 *  feathered border is a soft ragged edge rather than a staircase. */
export const ZONE_TILE = 24;

export interface ZoneGroundTile {
  /** Top-left corner of the tile's world square. */
  x: number;
  y: number;
  size: number;
  colour: number;
  alpha: number;
}

/**
 * A deterministic random source. Mulberry32, the same one ./world.ts uses,
 * restated here rather than imported for the module-cycle reason in the file
 * header. A district's border is the same ragged border on every visit.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 0xRRGGBB colour with its channels scaled by `factor`, clamped to a valid
 * byte each. A continuous per-tile brightness jitter rather than a third
 * hard colour: `ZoneGround.alt`'s own comment already found out the hard way
 * that a second colour with real contrast reads as a chessboard at a tile's
 * size on screen, so grain has to come from shading the colour that was
 * already picked, not from adding another one to pick between.
 */
function shade(colour: number, factor: number): number {
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel * factor)));
  const r = clamp((colour >> 16) & 255);
  const g = clamp((colour >> 8) & 255);
  const b = clamp(colour & 255);
  return (r << 16) | (g << 8) | b;
}

/**
 * How strongly a point is inside a rect, 0 on the edge and 1 once it is a
 * full `ZONE_FEATHER` in.
 *
 * Squared rather than linear, and that is what makes the corners actually
 * disappear rather than merely dim. A corner tile is only a half-tile in
 * from BOTH edges, so on a linear ramp it still lands around a tenth of full
 * cover -- faint, but a visible right angle, which is the exact thing the
 * feather exists to destroy. Squaring drops it under the threshold
 * `zoneGroundTiles` discards at, on every district's cover value, so the
 * corner tile is not drawn at all.
 */
function insetFraction(rect: WorldRect, x: number, y: number): number {
  const dx = Math.min(x - rect.x, rect.x + rect.width - x);
  const dy = Math.min(y - rect.y, rect.y + rect.height - y);
  const linear = Math.max(0, Math.min(1, Math.min(dx, dy) / ZONE_FEATHER));
  return linear * linear;
}

/**
 * A district's ground, as tiles to fill.
 *
 * Two things stop the bounding box from looking like a bounding box, and
 * both matter more than they sound: the alpha fades over the outer
 * `ZONE_FEATHER` units so the ground dissolves into the lawn instead of
 * ending, and each tile's own alpha is jittered by a seeded roll so the
 * fade is ragged rather than a clean gradient. Tiles that come out nearly
 * invisible are dropped entirely, which is what eats the corners and leaves
 * an irregular blob -- a rectangle you cannot see the corners of is not
 * read as a rectangle.
 */
export function zoneGroundTiles(id: ZoneId): ZoneGroundTile[] {
  const zone = STACKACRES_ZONES[id];
  if (zone.ground.cover <= 0) return [];
  const random = seeded(id.length * 2654435761 + Math.round(zone.bounds.x) * 40503 + 17);
  const tiles: ZoneGroundTile[] = [];
  const cols = Math.ceil(zone.bounds.width / ZONE_TILE);
  const rows = Math.ceil(zone.bounds.height / ZONE_TILE);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = zone.bounds.x + col * ZONE_TILE;
      const y = zone.bounds.y + row * ZONE_TILE;
      const inset = insetFraction(zone.bounds, x + ZONE_TILE / 2, y + ZONE_TILE / 2);
      // Two separate rolls, doing two different jobs. The fray is strongest
      // at the edge and gone in the middle, so the border breaks up without
      // the district's heart looking moth-eaten. The mottle is small and
      // everywhere, so the interior has grain rather than being one flat
      // plane of identical diamonds -- the same job the faint sweeps in the
      // grass tile do. Both only ever reduce alpha, so the invariant that a
      // tile never exceeds its district's cover holds by construction.
      const fray = 1 - random() * 0.55 * (1 - inset);
      const mottle = 1 - random() * 0.1;
      const alpha = zone.ground.cover * inset * fray * mottle;
      if (alpha < 0.05) continue;
      // Near the edge, DROP tiles outright as well as dimming them. Alpha
      // alone gives a smooth ramp, and a smooth ramp around a rectangle
      // reads as a vignetted stage -- concentric bands with square corners.
      // Punching holes in the outer band instead leaves a broken, organic
      // boundary, which is what ground actually does where a field peters
      // out into grass.
      if (inset < 0.75 && random() > 0.35 + inset * 0.65) continue;
      // A third, continuous roll on top of the base/alt pick: +-7% per-tile
      // brightness, so two tiles that land the same colour still are not
      // identical. This is grain, the same job the lawn tile's own mottle
      // patches do underneath everything -- see `shade`'s own comment for
      // why it is a shade and not a third colour.
      const tone = shade(random() < 0.34 ? zone.ground.alt : zone.ground.base, 0.93 + random() * 0.14);
      tiles.push({
        x,
        y,
        size: ZONE_TILE,
        colour: tone,
        alpha,
      });
    }
  }
  return tiles;
}

/* ------------------------------------------------------------------ */
/* Scenery                                                             */
/* ------------------------------------------------------------------ */

/**
 * What stands in a district. Separate from ./world.ts's `SceneryKind` (the
 * woodland's own trees and litter) rather than bolted onto it: the two are
 * grown by different functions into different chunks, and one union covering
 * both would let a mushroom be dealt into a mud wallow.
 */
export type ZoneSceneryKind =
  // The Long Meadow: nothing built, four heights of growing things.
  | "grassTall"
  | "grassMid"
  | "clover"
  | "buttercup"
  // The Ox Fields: worked ground and the gear that works it.
  | "furrow"
  | "hitchPost"
  | "hayBale"
  | "plough"
  | "oxTrough"
  // The Fold: wet ground, a fence and somewhere to stand out of the sun.
  | "mudPool"
  | "wallowPost"
  | "shadeCanopy"
  | "hogTrough";

export interface ZoneSceneryItem {
  kind: ZoneSceneryKind;
  /** World units, absolute. */
  x: number;
  y: number;
}

/** How wide the district-scenery chunks are, matching ./world.ts's own
 *  `STACKACRES_CHUNK` so the scene can tend both on one lattice. */
export const ZONE_CHUNK = 160;

/**
 * The furniture each district scatters, and how thickly. The meadow's own
 * grass is NOT in here -- it is a density field, not a scatter, because it
 * has to be mown tile by tile (see `meadowDensityAt`).
 */
const ZONE_SCATTER: Readonly<Record<ZoneId, readonly ZoneSceneryKind[]>> = {
  farmstead: [],
  meadow: ["clover", "clover", "buttercup", "buttercup", "clover"],
  // Furrows dominate: the ground itself is the content in a worked field,
  // and the posts and gear are what break it up.
  oxfields: ["furrow", "furrow", "furrow", "furrow", "hitchPost", "hayBale", "plough", "oxTrough"],
  wallow: ["mudPool", "mudPool", "wallowPost", "hogTrough", "shadeCanopy"],
};

/** Scatter density per chunk, by district. */
const ZONE_SCATTER_COUNT: Readonly<Record<ZoneId, number>> = {
  farmstead: 0,
  meadow: 7,
  oxfields: 9,
  wallow: 6,
};

/**
 * One chunk of a district's scenery, deterministic by chunk coordinate the
 * same way `chunkScenery` is, so a district regrows identically every time
 * the camera comes back to it.
 *
 * A chunk can straddle a district's edge, so every candidate is tested
 * individually rather than the chunk being assigned to one district: a point
 * outside every district grows nothing here (the woodland's own generator
 * has it), and a point in a different district grows that one's furniture.
 */
/** The kinds that lie flat on the ground rather than standing on it. */
const FLAT_KINDS: ReadonlySet<ZoneSceneryKind> = new Set<ZoneSceneryKind>(["furrow", "mudPool"]);

/** Well inside a district, past the band where its ground has faded out. */
function deepInZone(id: ZoneId, x: number, y: number): boolean {
  const b = STACKACRES_ZONES[id].bounds;
  const dx = Math.min(x - b.x, b.x + b.width - x);
  const dy = Math.min(y - b.y, b.y + b.height - y);
  return Math.min(dx, dy) > ZONE_FEATHER * 0.7;
}

/**
 * The grow area a district's owned units stand and wander in, restated here
 * as a literal -- see world.ts's `growAreaBounds` (backed by its own
 * `GROW_AREA`), which this has to match by hand for the same reason
 * `FARM_ZONE` is restated rather than imported: world.ts imports THIS module
 * as a value, so the reverse would read a constant before world.ts finishes
 * evaluating. Kept out of the ambient scatter so a furrow, a mud pool or a
 * stray clover patch can never spawn on top of a fence or a wandering animal.
 * The Farmstead has none: its own scatter list is already empty, so there is
 * nothing to exclude.
 */
const PEN_BLOCKS: Readonly<Partial<Record<ZoneId, WorldRect>>> = {
  meadow: { x: 220, y: 560, width: 160, height: 160 },
  oxfields: { x: 680, y: 70, width: 160, height: 160 },
  wallow: { x: -320, y: -390, width: 160, height: 160 },
};

function inPenBlock(id: ZoneId, x: number, y: number): boolean {
  const block = PEN_BLOCKS[id];
  if (!block) return false;
  return x >= block.x && x <= block.x + block.width && y >= block.y && y <= block.y + block.height;
}

/**
 * `locked` names districts whose land the player has not cleared yet (see
 * ./sectors.ts). Everything this function deals is FARM GEAR -- a plough, a
 * hitching post, an ox trough, a furrow somebody cut -- so none of it may
 * stand on ground nobody has taken on: a trough in a wood is a story about a
 * farm that is already there, which is the exact impression a locked sector
 * must not give. What grows there instead is `sectorOvergrowth`, dealt by
 * that module and painted by the scene in place of all of this.
 *
 * Optional, and defaulting to "nothing is locked", so every existing caller
 * and test keeps the behaviour it had.
 */
export function zoneScenery(
  cx: number,
  cy: number,
  locked: ReadonlySet<ZoneId> = new Set(),
): ZoneSceneryItem[] {
  const random = seeded((cx * 0x2545f491) ^ (cy * 0x9e3779b1) ^ 0x1b873593);
  const x0 = cx * ZONE_CHUNK;
  const y0 = cy * ZONE_CHUNK;
  const items: ZoneSceneryItem[] = [];
  // One pass at the densest district's count; each candidate is kept only if
  // it lands in a district that wants that many. Rolling the position first
  // and the district second is what keeps a chunk's layout stable when a
  // neighbouring district's bounds move.
  const most = Math.max(...OUTER_ZONE_IDS.map((id) => ZONE_SCATTER_COUNT[id]));
  for (let i = 0; i < most; i += 1) {
    const x = x0 + random() * ZONE_CHUNK;
    const y = y0 + random() * ZONE_CHUNK;
    const roll = random();
    const id = zoneAt(x, y);
    if (id === null || id === "farmstead") continue;
    if (locked.has(id)) continue;
    if (i >= ZONE_SCATTER_COUNT[id]) continue;
    // The connectors run right through two of the districts, so the same
    // exclusion the woodland respects applies here: a hay bale in the middle
    // of the road stops it reading as a road.
    if (nearPath(x, y)) continue;
    if (inPenBlock(id, x, y)) continue;
    const pool = ZONE_SCATTER[id];
    if (pool.length === 0) continue;
    const kind = pool[Math.floor(roll * pool.length)];
    // Ground-hugging art is part of the ground, so it may only land where
    // there IS ground: out in the feathered border the district's own colour
    // has faded away, and a furrow lying on bare lawn reads as a dropped
    // plank rather than as a ploughed row. Things with height are fine out
    // there -- a fence post at the edge of a field is a fence post.
    if (FLAT_KINDS.has(kind) && !deepInZone(id, x, y)) continue;
    items.push({ kind, x, y });
  }
  return items.sort((a, b) => a.x + a.y - (b.x + b.y));
}

/* ------------------------------------------------------------------ */
/* The Long Meadow's grass                                             */
/* ------------------------------------------------------------------ */

/**
 * The meadow is a density field rather than a scatter, because it is the one
 * piece of scenery the player changes: a scythe dragged across it cuts it
 * down, and it grows back.
 *
 * Density runs 0..3 and each level is a different picture -- 3 is waist-high
 * grass with a flower head, 2 is mid-length, 1 is stubble, 0 is cut. That is
 * what makes mowing legible: a swathe you have walked reads differently from
 * one you have not, at any zoom, without a single number on screen.
 */
export const MEADOW_TILE = 16;
export const MEADOW_MAX_DENSITY = 3;

/** Tile coordinates, floor-divided. Negative world coordinates have to floor
 *  rather than truncate or the tile at x -0.5 and the one at x 0.5 collapse
 *  into one. */
export function meadowTileAt(x: number, y: number): { tx: number; ty: number } {
  return { tx: Math.floor(x / MEADOW_TILE), ty: Math.floor(y / MEADOW_TILE) };
}

export function meadowTileKey(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}

/** The world square a meadow tile covers. */
export function meadowTileRect(tx: number, ty: number): WorldRect {
  return { x: tx * MEADOW_TILE, y: ty * MEADOW_TILE, width: MEADOW_TILE, height: MEADOW_TILE };
}

/**
 * How tall the grass grows on a tile if nobody ever cuts it.
 *
 * Not uniformly 3: a field of identical maximum grass is as flat as a field
 * of no grass. Most of it is full height, with thinner patches rolled in, so
 * the meadow has grain to it before anyone has touched it -- and so a mown
 * swathe reads against something irregular rather than against a solid block.
 *
 * Returns 0 outside the meadow, which is what makes every other function
 * here safe to call anywhere.
 */
export function meadowBaseDensity(tx: number, ty: number): number {
  const rect = meadowTileRect(tx, ty);
  const cx = rect.x + MEADOW_TILE / 2;
  const cy = rect.y + MEADOW_TILE / 2;
  if (zoneAt(cx, cy) !== "meadow") return 0;
  // Nothing grows on the lane through the field, so a stroke that follows the
  // road cuts nothing and the road stays visible through waist-high grass.
  if (nearPath(cx, cy)) return 0;
  const random = seeded((tx * 374761393) ^ (ty * 668265263) ^ 0x27d4eb2f);
  const roll = random();
  if (roll < 0.12) return 1;
  if (roll < 0.38) return 2;
  return 3;
}

/** How long one level of grass takes to grow back. Three levels is a little
 *  under half an hour from bare to waist-high: long enough that a mown
 *  swathe is still visibly yours when you come back from the ox fields,
 *  short enough that the meadow is never permanently bald. */
export const MEADOW_REGROW_MS = 9 * 60 * 1000;

/**
 * A tile's density now, given when it was last cut. `cutAt` is null for a
 * tile nobody has touched.
 *
 * Regrowth is capped at the tile's own base density rather than at 3: a
 * thin patch stays a thin patch, so cutting the meadow flat and letting it
 * regrow does not quietly erase the grain `meadowBaseDensity` put there.
 */
export function meadowDensityAt(tx: number, ty: number, cutAtMs: number | null, nowMs: number): number {
  const base = meadowBaseDensity(tx, ty);
  if (base === 0 || cutAtMs === null) return base;
  const grown = Math.floor(Math.max(0, nowMs - cutAtMs) / MEADOW_REGROW_MS);
  return Math.max(0, Math.min(base, grown));
}

/** How wide a swing of the scythe cuts, in world units, either side of the
 *  line the finger drew. A little over a tile, so a single straight drag
 *  leaves an unbroken swathe rather than a dotted line.
 *
 *  The BASE reach, and what a player holding the starting Trowel cuts. The
 *  equipment ladder widens it -- see `scytheReachFor` in ./equipment.ts,
 *  whose own starting rung is defined as exactly this value so that shipping
 *  the ladder cannot nerf a player who buys nothing. */
export const SCYTHE_REACH = 20;

/**
 * Every meadow tile a scythe stroke from `from` to `to` cuts.
 *
 * The stroke is sampled along its own length rather than rasterised, because
 * a drag arrives as a handful of pointer moves and the gaps between them can
 * be many tiles long at low zoom -- walking the line is what stops a fast
 * swipe from cutting a dashed line. Tiles outside the meadow are dropped
 * here rather than by the caller, so a stroke that runs off the field simply
 * stops cutting at the edge.
 *
 * Returns tile coordinates, de-duplicated, in the order they were reached:
 * the scene animates the cut in that order so the swathe falls the way the
 * hand moved.
 *
 * `reach` defaults to the base swathe, so every existing caller and test is
 * unchanged; the scene passes the reach of whatever tool the player is
 * holding. It is only ever widened, never narrowed -- see ./equipment.ts.
 */
export function mowStroke(
  from: WorldPoint,
  to: WorldPoint,
  reach: number = SCYTHE_REACH,
): { tx: number; ty: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // Half a tile between samples: fine enough that no tile the line crosses
  // can be stepped over, cheap enough for a per-move call.
  const steps = Math.max(1, Math.ceil(length / (MEADOW_TILE / 2)));
  const seen = new Set<string>();
  const out: { tx: number; ty: number }[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    // The reach is a square rather than a disc: it is a tile test, and the
    // difference between the two at this radius is under half a tile.
    const tileReach = Math.ceil(reach / MEADOW_TILE);
    const centre = meadowTileAt(px, py);
    for (let oy = -tileReach; oy <= tileReach; oy += 1) {
      for (let ox = -tileReach; ox <= tileReach; ox += 1) {
        const tx = centre.tx + ox;
        const ty = centre.ty + oy;
        if (meadowBaseDensity(tx, ty) === 0) continue;
        const key = meadowTileKey(tx, ty);
        if (seen.has(key)) continue;
        // Measured to the tile's centre, so the swathe's edge is where the
        // grass visibly is rather than where its cell happens to start.
        const cx = tx * MEADOW_TILE + MEADOW_TILE / 2;
        const cy = ty * MEADOW_TILE + MEADOW_TILE / 2;
        if (Math.hypot(cx - px, cy - py) > reach) continue;
        seen.add(key);
        out.push({ tx, ty });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The herds                                                           */
/* ------------------------------------------------------------------ */

/**
 * A district's own AMBIENT animals: not livestock, not stocked, not worth
 * anything -- scenery, the way `zoneScenery`'s furrows and mud pools are
 * scenery. They exist so an unclaimed district reads as inhabited rather
 * than an empty coloured rectangle.
 *
 * Ox Fields and the Fold HAD one of these each (wild oxen, wild hogs) until
 * the pens moved in. Kayo: those pens should REPLACE the ambient herd, not
 * sit beside it -- the player's own Cattle Pens and Sheep Pens are that
 * district's life now, the same way the Hen Coops are the Farmstead's. So
 * `HERDS` is empty; the interface and `zoneHerd` stay, for a future district
 * that wants ambient life of its own with nothing to tend yet.
 *
 * They reuse ./world.ts's `stepCritter` exactly as the pens' animals do (it
 * takes a rectangle and a speed and knows nothing about plots), so this is a
 * new picture rather than a new system.
 */
export interface ZoneHerd {
  /** Which painter the scene draws for one of them. */
  art: "ox" | "hog";
  count: number;
  /** World units per second. An ox does not hurry. */
  speed: number;
  /** Where they may walk. Inset well inside the district so one never
   *  wanders out into the woods. */
  range: WorldRect;
}

const HERDS: Readonly<Partial<Record<ZoneId, ZoneHerd>>> = {};

export function zoneHerd(id: ZoneId): ZoneHerd | null {
  return HERDS[id] ?? null;
}

/* ------------------------------------------------------------------ */
/* Getting there                                                       */
/* ------------------------------------------------------------------ */

/**
 * What the camera should frame on arriving at a district: a box around its
 * approach point rather than the district's whole extent.
 *
 * Framing the whole rect would zoom out until the district is a smudge and
 * put its centre behind the toolbelt. A fixed-size window at the gate lands
 * at a readable zoom in every district regardless of how big it is, and the
 * player pans on from there -- which is the behaviour the map wants anyway.
 */
export const ZONE_ARRIVAL_WINDOW = 260;

export function zoneFrame(id: ZoneId): WorldRect {
  const at = STACKACRES_ZONES[id].approach;
  const half = ZONE_ARRIVAL_WINDOW / 2;
  return { x: at.x - half, y: at.y - half, width: ZONE_ARRIVAL_WINDOW, height: ZONE_ARRIVAL_WINDOW };
}

/**
 * The districts in the order the destination strip lists them: the farm
 * first (it is where you are and where "back" means), then the other three
 * by how far their gate is from the farmyard, so the strip reads as a
 * journey outward rather than as an alphabetised menu.
 */
export function zonesByDistance(): readonly ZoneDef[] {
  const home = STACKACRES_ZONES.farmstead.approach;
  return [
    STACKACRES_ZONES.farmstead,
    ...OUTER_ZONE_IDS.map((id) => STACKACRES_ZONES[id]).sort(
      (a, b) =>
        Math.hypot(a.approach.x - home.x, a.approach.y - home.y) -
        Math.hypot(b.approach.x - home.x, b.approach.y - home.y),
    ),
  ];
}
