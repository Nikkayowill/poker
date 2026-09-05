/**
 * Where the farm's fixed props stand.
 *
 * Pure layout: the windmill, the well, the clutter by the silo, the lamps
 * down the lane, Grandfather Ray and the rest, each as a kind and the world
 * point its feet are on. The renderer (components/arcade/stackacres/
 * art-props.ts) paints them; the scene places each one by its feet with a
 * soft ground shadow under it and sorts it by that y like everything else
 * with height.
 *
 * Every number here is a literal and only types come in from ./world and
 * ./paths, the arrangement those modules have with each other: this file is
 * not in that cycle today, but the props' positions are measured against
 * the same fixed geometry -- the plot square at x 64..384, y 64..384, the
 * barn's feet on y 34 (barn x 71..145, silo 143..165, hay 166..188 at
 * y 23..33, barrel 60..70 at y 20..33), the road centred on y 46 (body
 * 36..56, damp rim to ~33), the lane at x 50 (body 41..59), the track
 * leaving (60,46) north-west and the pond at x -84..20, y 80..160 -- and
 * props.test.ts is what holds them to it.
 *
 * The yard is the band NORTH of the road, between the silo and the seed
 * strip: feet at y <= 32, x 150..370. Nothing stands on a path body, on the
 * plot square, or in the pond's clearing. Lamps stand on the lane's west
 * verge only, three of them, the way FarmVille lights one driveway rather
 * than every path.
 */

import { BARN_FOOTPRINT, WHEAT_FIELD, growAreaBounds, seededRandom, type WorldPoint, type WorldRect } from "./world";
// A value import, safe for the reason paths.ts's own header gives: this
// module is not part of the world.ts/paths.ts/zones.ts import cycle, so
// there is nothing here that could be read before either module finishes
// evaluating.
import { nearPath } from "./paths";
import { inPondZone } from "./water";

export type PropKind =
  | "windmill"
  | "well"
  | "wheelbarrow"
  | "crate"
  | "logPile"
  | "toolBarrel"
  | "mailbox"
  | "signpost"
  | "lampPost"
  | "flowerBed"
  | "stoneWall"
  | "scarecrow"
  | "grandfatherRay";

export interface PropPlacement extends WorldPoint {
  kind: PropKind;
}

/**
 * The props, in no particular order (the scene sorts by depth). About a
 * dozen in the yard: the reference farm has six or seven around one
 * building, and twenty-two read as a junk shop.
 */
export const YARD_PROPS: readonly PropPlacement[] = [
  // The one tall silhouette in the yard, and the only thing that moves
  // there: its blades turn (see WINDMILL_HUB). Left of the seed strip
  // (x >= ~374 at the opening shot) so a new player sees it.
  { kind: "windmill", x: 330, y: 28 },

  // Clutter east of the silo and the hay, against the road's north rim.
  // The second crate and the wheelbarrow sit a few units further off the
  // road than the rest of the cluster -- widening the road (2026-09-03,
  // see lib/stackacres/paths.ts) pushed its rim out from under them.
  { kind: "crate", x: 200, y: 26 },
  { kind: "crate", x: 211, y: 24 },
  { kind: "logPile", x: 182, y: 2 },
  { kind: "well", x: 238, y: 30 },
  { kind: "wheelbarrow", x: 284, y: 24 },
  { kind: "flowerBed", x: 270, y: 6 },
  { kind: "flowerBed", x: 302, y: 6 },

  // At the fork where the track leaves the lane.
  { kind: "signpost", x: 38, y: 42 },

  // Down the lane's west verge, on the stone line, ending at the mailbox.
  // A little further off the centreline than the lane's own doc comment
  // above once had them (2026-09-03: widening the lane pushed its body out
  // from under the old x 40/39).
  { kind: "lampPost", x: 38, y: 80 },
  { kind: "lampPost", x: 38, y: 190 },
  { kind: "lampPost", x: 38, y: 300 },
  { kind: "mailbox", x: 36, y: 404 },

  // Field wall north of the yard: three broken lengths, not a fence line.
  { kind: "stoneWall", x: 176, y: -46 },
  { kind: "stoneWall", x: 216, y: -46 },
  { kind: "stoneWall", x: 254, y: -46 },

  // Watching the first row of fields from the east verge.
  { kind: "scarecrow", x: 402, y: 110 },

  // Grandfather Ray, at his post beside the barn door -- the front desk.
  { kind: "grandfatherRay", x: 178, y: 20 },
];

/**
 * The windmill's hub, as an offset from its feet: where the blades sprite
 * is pinned and turned about. The tower is 70 tall and the hub sits on the
 * cap's face, fourteen units below the peak.
 */
export const WINDMILL_HUB: WorldPoint = { x: 0, y: -56 };

/** Radians per millisecond the blades turn at: about a turn every 18s. */
export const WINDMILL_SPEED = 0.00035;

/** A prop's painted box in units, for the tests and the ground shadow. */
export interface PropSize {
  w: number;
  h: number;
}

export const PROP_SIZE: Record<PropKind, PropSize> = {
  windmill: { w: 30, h: 70 },
  well: { w: 28, h: 32 },
  wheelbarrow: { w: 28, h: 18 },
  crate: { w: 16, h: 14 },
  logPile: { w: 30, h: 16 },
  toolBarrel: { w: 18, h: 20 },
  mailbox: { w: 12, h: 24 },
  signpost: { w: 18, h: 26 },
  lampPost: { w: 9, h: 34 },
  flowerBed: { w: 28, h: 12 },
  stoneWall: { w: 32, h: 10 },
  scarecrow: { w: 20, h: 36 },
  grandfatherRay: { w: 25.125, h: 40 },
};

/**
 * The soft green pool under each prop, in units: a little wider than the
 * footprint, and low. The scene draws it with the `shadow` painter, which
 * already sits the pool a touch right of the feet for the upper-left sun.
 */
export const PROP_SHADOW: Record<PropKind, PropSize> = {
  windmill: { w: 40, h: 14 },
  well: { w: 34, h: 12 },
  wheelbarrow: { w: 32, h: 9 },
  crate: { w: 20, h: 7 },
  logPile: { w: 34, h: 8 },
  toolBarrel: { w: 22, h: 8 },
  mailbox: { w: 12, h: 5 },
  signpost: { w: 18, h: 6 },
  lampPost: { w: 11, h: 4 },
  flowerBed: { w: 30, h: 6 },
  stoneWall: { w: 34, h: 5 },
  scarecrow: { w: 24, h: 7 },
  grandfatherRay: { w: 27, h: 8 },
};

/**
 * Props that stand on a path's verge, right beside the body: a lamp, a
 * sign, a mailbox. Everything else keeps the full scenery clearance off
 * the paths.
 */
export const VERGE_PROPS: ReadonlySet<PropKind> = new Set<PropKind>(["lampPost", "signpost", "mailbox"]);

/** The box a prop's picture covers, given its feet. Painters anchor at
 *  (0.5, 1): centred on x, standing on y. */
export function propRect(prop: PropPlacement): { x: number; y: number; width: number; height: number } {
  const size = PROP_SIZE[prop.kind];
  return { x: prop.x - size.w / 2, y: prop.y - size.h, width: size.w, height: size.h };
}

/* ------------------------------------------------------------------ */
/* Farmstead clutter                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ambient, non-interactive dressing for the bare grass between the yard's
 * own hand-placed cluster and the Hen Coop/wheat field further south -- the
 * "dead, empty gap" a district scatter fills everywhere else (see
 * ./zones.ts's `ZONE_SCATTER`), which the Farmstead alone never got: its own
 * entry there is `[]`, because when that pass shipped the Farmstead already
 * had `YARD_PROPS`. `YARD_PROPS` is a tight cluster by the barn, though, not
 * a scatter across the whole district, and the band below it -- roughly
 * where `generatePathwaysBetweenNodes` (./paths.ts) now has to run its own
 * two spurs -- had nothing at all standing in it.
 *
 * A well, a pile of split logs, an empty tool barrel: small, stationary,
 * nothing to tap. Reusing `well`/`logPile` rather than inventing two more
 * kinds keeps one picture doing double duty (the yard's own well by the barn
 * door, and now a second one further out reads as the same farm, not two
 * different ones); `toolBarrel` is the one genuinely new kind, painted by
 * components/arcade/stackacres/art-props.ts.
 */
export const CLUTTER_KINDS: readonly PropKind[] = ["well", "logPile", "toolBarrel", "toolBarrel"];

/**
 * The dead band itself: south of the road's own clearance, north of the Hen
 * Coop and the wheat field's own north edges. x 40..420 clears the lane's
 * west verge and sits inside the Farmstead's own bounds (./zones.ts);
 * y 40..195 is measured the same way FARMSTEAD_PATH_NODES's own doc comment
 * measures its clearance -- south of the road (`nearPath` already excludes
 * everything within its own body) and north of both destinations' 200/140
 * edges, with room for a candidate's own clearance check to bite before
 * either edge.
 */
export const FARMSTEAD_CLUTTER_BAND: WorldRect = { x: 40, y: 40, width: 380, height: 155 };

/** Grid cell a clutter candidate is rolled in, in world units -- coarse
 *  enough that a well and a barrel never crowd, fine enough that the band
 *  reads as scattered rather than gridded once the exclusions have thinned
 *  it out. */
const CLUTTER_CELL = 40;

/** Chance any given cell rolls a prop at all. Below half so the band still
 *  reads as open grass with things standing in it, not a second yard. */
const CLUTTER_FILL_CHANCE = 0.4;

/** Extra clearance, beyond a destination's own edge, a clutter candidate
 *  must clear -- a barrel sitting flush against the Hen Coop's fence reads
 *  as leaning on it, not as furniture near it. */
const CLUTTER_CLEARANCE = 10;

/** How far apart (measured centre to centre, each side's own half-width
 *  and height already folded in) two props must land, be it two clutter
 *  items or a clutter item and a `YARD_PROPS` entry -- overlapping picture
 *  boxes is the one thing a scatter must never produce. */
const CLUTTER_PROP_GAP = 4;

function insideRect(x: number, y: number, rect: WorldRect, margin: number): boolean {
  return x >= rect.x - margin && x <= rect.x + rect.width + margin && y >= rect.y - margin && y <= rect.y + rect.height + margin;
}

/** Half the longer side of a prop's own picture box -- a circle a little
 *  larger than its true footprint, cheap to check pairwise and generous
 *  enough that a diagonal overlap between two rectangular boxes still gets
 *  caught. */
function propRadius(kind: PropKind): number {
  const size = PROP_SIZE[kind];
  return Math.max(size.w, size.h) / 2;
}

function tooCloseToAny(x: number, y: number, kind: PropKind, others: readonly PropPlacement[]): boolean {
  const ownRadius = propRadius(kind);
  for (const other of others) {
    const clearance = ownRadius + propRadius(other.kind) + CLUTTER_PROP_GAP;
    if (Math.hypot(x - other.x, y - other.y) < clearance) return true;
  }
  return false;
}

/**
 * The Farmstead's own ambient clutter: a jittered grid over
 * `FARMSTEAD_CLUTTER_BAND`, one deterministic roll per cell (fill or not,
 * which kind, where inside the cell), same pattern ./zones.ts's own
 * `zoneScenery` scatters a district's furniture with, just over a fixed
 * band rather than an infinite chunk lattice -- the Farmstead does not
 * stream, so there is no reason for this to be chunked.
 *
 * A cell's candidate is rejected, in order, for: landing on a path (this is
 * what makes the two spurs `generatePathwaysBetweenNodes` just grew read as
 * clear ground, not obstacle course -- `nearPath` already knows about them,
 * see paths.ts's `ALL_FARM_PATHS`), landing too close to the barn, the Hen
 * Coop or the wheat field, landing in the pond's own clearing, and landing
 * too close to another prop -- a `YARD_PROPS` entry or an earlier cell in
 * this same pass. Every rejection just skips the cell; nothing retries at
 * a jittered position, so the result stays a pure function of `seed`.
 */
export function farmsteadClutter(seed = 0xc1f7e4): PropPlacement[] {
  const band = FARMSTEAD_CLUTTER_BAND;
  const henCoop = growAreaBounds("farmstead");
  const cols = Math.ceil(band.width / CLUTTER_CELL);
  const rows = Math.ceil(band.height / CLUTTER_CELL);
  const items: PropPlacement[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const random = seededRandom((seed ^ Math.imul(col + 1, 0x1f123bb5) ^ Math.imul(row + 1, 0x6c9291a7)) >>> 0);
      if (random() > CLUTTER_FILL_CHANCE) continue;
      const kind = CLUTTER_KINDS[Math.floor(random() * CLUTTER_KINDS.length)];
      const x = band.x + col * CLUTTER_CELL + random() * CLUTTER_CELL;
      const y = band.y + row * CLUTTER_CELL + random() * CLUTTER_CELL;
      if (nearPath(x, y)) continue;
      if (insideRect(x, y, BARN_FOOTPRINT, CLUTTER_CLEARANCE)) continue;
      if (insideRect(x, y, henCoop, CLUTTER_CLEARANCE)) continue;
      if (insideRect(x, y, WHEAT_FIELD, CLUTTER_CLEARANCE)) continue;
      if (inPondZone(x, y)) continue;
      if (tooCloseToAny(x, y, kind, YARD_PROPS)) continue;
      if (tooCloseToAny(x, y, kind, items)) continue;
      items.push({ kind, x, y });
    }
  }
  return items;
}
