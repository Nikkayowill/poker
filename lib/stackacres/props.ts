/**
 * Where the farm's fixed props stand.
 *
 * Pure layout: the windmill, the well, the clutter by the silo, the lamps
 * down the lane and the rest, each as a kind and the world point its feet
 * are on. The renderer (components/arcade/stackacres/art-props.ts) paints
 * them; the scene places each one by its feet with a soft ground shadow
 * under it and sorts it by that y like everything else with height.
 *
 * Every number here is a literal and only types come in from ./world and
 * ./paths, the arrangement those modules have with each other: this file is
 * not in that cycle today, but the props' positions are measured against
 * the same fixed geometry -- the plot square at x 64..384, y 64..384, the
 * barn's feet on y 34 (barn x 71..145, silo 143..165, hay 166..188 at
 * y 23..33, barrel 60..70 at y 20..33), the road centred on y 46 (body
 * 38..54, damp rim to ~35), the lane at x 50 (body 43..57), the track
 * leaving (60,46) north-west and the pond at x -84..20, y 80..160 -- and
 * props.test.ts is what holds them to it.
 *
 * The yard is the band NORTH of the road, between the silo and the seed
 * strip: feet at y <= 32, x 150..370. Nothing stands on a path body, on the
 * plot square, or in the pond's clearing. Lamps stand on the lane's west
 * verge only, three of them, the way FarmVille lights one driveway rather
 * than every path.
 */

import type { WorldPoint } from "./world";

export type PropKind =
  | "windmill"
  | "well"
  | "wheelbarrow"
  | "crate"
  | "logPile"
  | "mailbox"
  | "signpost"
  | "lampPost"
  | "flowerBed"
  | "stoneWall"
  | "scarecrow";

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
  { kind: "crate", x: 200, y: 26 },
  { kind: "crate", x: 211, y: 31 },
  { kind: "logPile", x: 182, y: 2 },
  { kind: "well", x: 238, y: 30 },
  { kind: "wheelbarrow", x: 284, y: 31 },
  { kind: "flowerBed", x: 270, y: 6 },
  { kind: "flowerBed", x: 302, y: 6 },

  // At the fork where the track leaves the lane.
  { kind: "signpost", x: 38, y: 42 },

  // Down the lane's west verge, on the stone line, ending at the mailbox.
  { kind: "lampPost", x: 40, y: 80 },
  { kind: "lampPost", x: 40, y: 190 },
  { kind: "lampPost", x: 40, y: 300 },
  { kind: "mailbox", x: 39, y: 404 },

  // Field wall north of the yard: three broken lengths, not a fence line.
  { kind: "stoneWall", x: 176, y: -46 },
  { kind: "stoneWall", x: 216, y: -46 },
  { kind: "stoneWall", x: 254, y: -46 },

  // Watching the first row of fields from the east verge.
  { kind: "scarecrow", x: 402, y: 110 },
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
  mailbox: { w: 12, h: 24 },
  signpost: { w: 18, h: 26 },
  lampPost: { w: 9, h: 34 },
  flowerBed: { w: 28, h: 12 },
  stoneWall: { w: 32, h: 10 },
  scarecrow: { w: 20, h: 36 },
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
  mailbox: { w: 12, h: 5 },
  signpost: { w: 18, h: 6 },
  lampPost: { w: 11, h: 4 },
  flowerBed: { w: 30, h: 6 },
  stoneWall: { w: 34, h: 5 },
  scarecrow: { w: 24, h: 7 },
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
