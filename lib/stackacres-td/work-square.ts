/**
 * Which square the belt works: the one in front of the farmer, Stardew's way.
 *
 * Every tool on the belt -- hoe, watering can, seed pouch, the hand that
 * harvests -- works the square he is FACING, never the one under his feet. The
 * Use key reaches one square on in the way he is looking, and tapping a square
 * walks him to the open square beside it and turns him to face it. So he never
 * ends up standing on the bed he is working, and walking a row with the hoe out
 * breaks the ground just ahead of him, the way it does in Stardew Valley.
 *
 * It used to be the other way round: the belt worked the square under his feet
 * and a tap walked him onto it. That put him on top of everything he did -- the
 * bed formed under his boots and the seeds went in beneath him.
 *
 * Pure and renderer-free, same split as the rest of lib/stackacres-td.
 */

export type Facing = "up" | "down" | "left" | "right";

export interface MapTile {
  mx: number;
  my: number;
}

/** One square on in each direction. Ordered so a tie between two equally near
 *  spots goes to standing BELOW the square and looking up at it, the way he
 *  has always walked up to a crop. */
const STEP: Readonly<Record<Facing, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const FACINGS = Object.keys(STEP) as Facing[];

/** The map tile a farmer standing at `pos` (map pixels) works, looking `facing`. */
export function facedTile(pos: { x: number; y: number }, facing: Facing, tile: number): MapTile {
  const [dx, dy] = STEP[facing];
  return { mx: Math.floor(pos.x / tile) + dx, my: Math.floor(pos.y / tile) + dy };
}

/** The middle of a map tile, in map pixels. */
export function tileCentre(at: MapTile, tile: number): { x: number; y: number } {
  return { x: at.mx * tile + tile / 2, y: at.my * tile + tile / 2 };
}

/** Whether two squares share a side: standing on one, he can work the other. */
export function besideSquare(a: MapTile, b: MapTile): boolean {
  return Math.abs(a.mx - b.mx) + Math.abs(a.my - b.my) === 1;
}

/**
 * Where to stand to work `square`, and which way to face: whichever open square
 * beside it is nearest to where he is now, so he walks up to it from his own
 * side rather than around it. Null when every side is shut -- a square boxed in
 * by a fence and a wall cannot be worked, and that is the honest answer.
 */
export function workSpot(
  square: MapTile,
  from: { x: number; y: number },
  tile: number,
  open: (mx: number, my: number) => boolean,
): (MapTile & { facing: Facing }) | null {
  let best: (MapTile & { facing: Facing; distance: number }) | null = null;
  for (const facing of FACINGS) {
    const [dx, dy] = STEP[facing];
    // Stand on the far side of the step and look back across it at the square.
    const spot = { mx: square.mx - dx, my: square.my - dy };
    if (!open(spot.mx, spot.my)) continue;
    const centre = tileCentre(spot, tile);
    const distance = Math.hypot(centre.x - from.x, centre.y - from.y);
    if (!best || distance < best.distance) best = { ...spot, facing, distance };
  }
  return best ? { mx: best.mx, my: best.my, facing: best.facing } : null;
}
