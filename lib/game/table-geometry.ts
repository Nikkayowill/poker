/**
 * Where the seats sit, and how far away they read.
 *
 * The seats ring a round table. A circle viewed from a tilted camera
 * projects to an ellipse whose horizontal radius is unchanged and whose
 * vertical radius is foreshortened by sin(camera tilt) -- so placing seats
 * on an ellipse is not a stylistic choice, it is what a real round table
 * looks like from a player's chair.
 *
 * Depth determines overlap order while avatar size stays constant. The table
 * plane itself supplies the perspective cue; changing people's size made them
 * look inconsistent rather than distant.
 */

/** Seat 0 sits nearest the viewer; screen y grows downward, so 90deg is the near edge. */
const NEAR_ANGLE_DEG = 90;

/**
 * Ellipse radii as a percentage of the table's bounding box.
 *
 * Sized so a seat's centre lands on the rail itself, which is where the figure
 * meets its own drawn rail -- the player then reads as sitting at this table
 * rather than hovering outside it. The rail is inset 8% of the box, so these
 * track that inset rather than reaching for the corners the way they did when
 * a seat was a small floating card.
 */
const RADIUS_X = 46;
/* Pull the vertical arc inward without shrinking the figures. At 44%, the
   opposite seat was anchored at y=6%; subtracting half its layout height put
   the top of the avatar outside the scene. A 34% radius leaves a real 16%
   safe area above the far seat while preserving the wide table silhouette.
   Now 38: .poker-rail's inset gives the ring a band outside the felt to sit
   in, so the arc follows the rail while its shifted centre keeps the far seat
   inside the box. */
const RADIUS_Y = 38;

/**
 * The desktop rail is not vertically centred in the wrapper: its CSS inset
 * is 15% at the top and 8% at the bottom.  The old ring was centred at 50%,
 * so every seat was orbiting a point 3.5% above the table it was meant to
 * surround.  This is the rail's actual centre: (15 + (100 - 8)) / 2.
 */
const DESKTOP_CENTER_Y = 53.5;

/**
 * Narrow viewports cannot afford the full horizontal radius: a seat is a
 * fixed-width box, so past a point the ring pushes the side seats off the
 * edge of the screen. Pulling the ellipse in keeps every name on screen,
 * which matters more than the width of the oval.
 */
const NARROW_RADIUS_X = 38;
const NARROW_BREAKPOINT_PX = 620;

/**
 * A portrait phone gets the tall table plate, and a ring shaped for a wide
 * oval does not fit a tall one: keeping ry at 34 leaves the side seats
 * stranded in the middle of the felt with empty rail above and below them.
 * Both radii are near-equal here because the tall plate's felt is close to
 * as far from centre vertically as horizontally once the box is taller than
 * it is wide.
 */
/* Not equal, and rx is the smaller of the two on purpose. A nameplate is at
   least 86px wide whatever the table does, so on a ~376px portrait plate an
   rx of 43 hung the side plates off both edges of the screen -- the same
   trap NARROW_RADIUS_X exists to avoid. ry can stay generous because a tall
   plate is where the vertical room actually is. */
const PORTRAIT_RADIUS_X = 37;
const PORTRAIT_RADIUS_Y = 44;

/**
 * Radii for the table's actual measured box, not the viewport.
 *
 * Keyed off the table rather than the window because the table is capped by
 * leftover height as well as by width -- the same viewport can hold a wide
 * plate or a tall one depending on how much room the header and action bar
 * took, and only the box itself knows which happened.
 */
export interface SeatEllipse {
  rx: number;
  ry: number;
  /** Percentage down the table wrapper; portrait rails remain centred. */
  cy?: number;
}

export function radiiForTable(table: { width: number; height: number }): SeatEllipse {
  if (isPortrait(table)) return { rx: PORTRAIT_RADIUS_X, ry: PORTRAIT_RADIUS_Y, cy: 50 };
  return isNarrow(table.width)
    ? { rx: NARROW_RADIUS_X, ry: RADIUS_Y, cy: DESKTOP_CENTER_Y }
    : { rx: RADIUS_X, ry: RADIUS_Y, cy: DESKTOP_CENTER_Y };
}

/** True once the table is taller than it is wide, i.e. showing the tall plate. */
export function isPortrait(table: { width: number; height: number }): boolean {
  return table.height > 0 && table.width / table.height < 1;
}

export function isNarrow(viewportWidth: number): boolean {
  return viewportWidth <= NARROW_BREAKPOINT_PX;
}

/**
 * Stacking order for a seat: depth-sorted, and always in front of the rail.
 *
 * Seats used to pass *behind* the rail, which looked right until the seat
 * became a whole figure with a nameplate and two cards attached. A seat is
 * scaled, so it is its own stacking context, and its children cannot climb out
 * of it: putting the body behind the rail put that player's hole cards and
 * their name behind it too. Measured on a six-handed table, three seats lost
 * their cards to the felt and the far seat lost its nameplate entirely.
 *
 * Nothing is given up by dropping it, because the artwork already carries a
 * rail with the player's elbows resting on it. The depth cue that survives --
 * perspective scale and distance haze -- is the part that was doing the work
 * anyway, and the ordering here still keeps near figures over far ones where
 * two seats overlap.
 */
export function seatZ(depth: number): number {
  return 4 + Math.round(depth);
}

export interface SeatGeometry {
  /** Percentage across the table's bounding box. */
  x: number;
  y: number;
  /** 0 at the far rail, 1 nearest the viewer. */
  depth: number;
  /**
   * Painter's-algorithm order: far seats draw first and therefore behind the
   * rail, near seats draw over it. The rail itself sits at RAIL_Z.
   */
  z: number;
  /**
   * Direction from the seat toward the middle of the table, for the things
   * that belong between a player and the pot -- their posted bet above all.
   * Derived rather than enumerated: a wager slides toward the centre no matter
   * how many seats are in play, where a per-position rule has to be rewritten
   * every time the ring changes size.
   *
   * Normalised so the larger component is exactly 1 -- a box norm, not the
   * usual Euclidean one. That is deliberate. A seat is a rectangle, and
   * scaling a Euclidean unit vector by half the box lands on the rectangle's
   * *inscribed ellipse*, which is inside it everywhere except the four edge
   * midpoints. A seat on a diagonal would put its bet chip in the corner
   * region, on top of the player's own name. Dividing by the larger component
   * instead puts the dominant axis exactly on its edge.
   */
  towardPot: { x: number; y: number };
}

/** The rail's own stacking level inside the isolated table scene. */
export const RAIL_Z = 1;

/**
 * Geometry for one seat on a ring of `count`, offset by `slot` places from
 * the near edge. The local player occupies slot 0 and is drawn separately in
 * the foreground, so opponents start at slot 1.
 */
export function seatGeometry(
  slot: number,
  count: number,
  radii: SeatEllipse = { rx: RADIUS_X, ry: RADIUS_Y, cy: DESKTOP_CENTER_Y },
): SeatGeometry {
  const theta = ((NEAR_ANGLE_DEG + (slot * 360) / count) * Math.PI) / 180;
  const centerY = radii.cy ?? 50;

  // Circle -> ellipse under camera tilt.
  const x = 50 + radii.rx * Math.cos(theta);
  const y = centerY + radii.ry * Math.sin(theta);

  // sin(theta) is +1 at the near edge and -1 at the far rail.
  const depth = (Math.sin(theta) + 1) / 2;

  // Toward (50, 50). The components are in percentage space, so a very wide
  // table skews the direction slightly -- harmless at the short distances a
  // bet chip travels, and not worth threading the pixel size in to correct.
  const inwardX = 50 - x;
  const inwardY = centerY - y;
  const dominant = Math.max(Math.abs(inwardX), Math.abs(inwardY)) || 1;

  return {
    x,
    y,
    depth,
    z: Math.round(depth * 100),
    towardPot: { x: inwardX / dominant, y: inwardY / dominant },
  };
}
