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
   Was 38: .poker-rail's inset gives the ring a band outside the felt to sit
   in, so the arc follows the rail while its shifted centre keeps the far seat
   inside the box.

   32 now. The room backdrop behind the rail carries real detail now (the
   STACKCHIPS wordmark, neon signage) where it used to be a plain dark
   gradient -- so the far seat's own upward lift into that band, which was
   always there and always harmless against a flat background, now reads as
   the avatar floating over the room's signage rather than sitting at the
   table. Only this seat moves meaningfully: sin(theta) is largest at the far
   seat and roughly half that at the side seats, so pulling ry in mostly
   affects the one seat this was about. */
const RADIUS_Y = 32;

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
/* Was 44, which puts the far seat's anchor at cy - ry = 6% of the wrap's own
   height -- the seat box's own upward lift then lands its TOP just 6px below
   .game-header's bottom edge, measured live at 390x844 (header bottom 56,
   seat top 62). That is before any safe-area inset eats into the header on a
   real notched phone, where it would touch or clip outright. Was 39, which
   moved the far seat's anchor to 11%, ~30px lower, verified against a real
   render rather than reasoned from the ellipse alone -- the two side pairs
   (slot 2/4, slot 1/5) shift a few percent with it but both already had
   generous clearance from the header and the action bar respectively, so
   neither trade costs anything.

   33 now, for the same reason the desktop RADIUS_Y moved: the far seat's
   own upward lift puts its avatar above the rail whatever ry is, and that
   band used to be a plain dark gradient. It carries the same room backdrop
   as desktop now (.game-shell's background, shared across breakpoints), so
   the far seat was floating over real signage instead of the empty space it
   was tuned against. Re-verified live that header clearance still holds at
   the smaller radius -- it only grows with a smaller ry, since the anchor
   moves toward cy=50, further from the header either way. */
const PORTRAIT_RADIUS_Y = 33;

/**
 * The landscape-phone ring: seats pushed out to the glass rather than packed
 * around a squeezed oval.
 *
 * A sideways phone is the one plate where the default ring reads as cramped —
 * `--table-aspect` is 3 there, so the felt is a long shallow band and the
 * seats were orbiting well inside the rail with dead margin either side of
 * them. These radii put the outermost pair of seats on the box's own left and
 * right edges, which is what the layout brief asked for.
 *
 * THE NUMBERS ARE SOLVED, NOT PICKED, and they are solved against the ring
 * this file already draws rather than written as per-seat offsets.
 *
 * On a six-seat ring nothing sits at cos(theta) = ±1: with slot 0 at the near
 * edge the outermost chairs are slots 1 and 2 to the left and 4 and 5 to the
 * right, all four at |cos| = 0.866.
 *
 * THE 4% IS THE SEAT BOX'S EDGE, NOT THE ELLIPSE POINT, and getting that
 * wrong is a whole seat off the screen rather than a near miss. `left: 4%`
 * in CSS positions an element's left edge, but this ellipse yields the point
 * a seat is *centred* on, and `.seat-ring` (08-seat.css) then pulls the box
 * back by half its own width plus an outward `--seat-outset`. Solving
 * `50 - 0.866 * rx = 4` therefore puts the box's edge at minus half a seat:
 * measured at 844x390, the left flank landed at x = -8.8 with its nameplate
 * cut off by the viewport. The correction is that overhang, in percent of
 * the plate:
 *
 *     0.866 * rx = 46 - 100 * (seatWidth / 2 + outset) / plateWidth
 *                = 46 - 100 * (52 + 14) / 793          (at 844x390)
 *                = 37.7        ->   rx = 43.5
 *
 * It generalises across handsets because `seatWidthFor` (poker-table.tsx)
 * derives the seat box from the plate's own width, so that ratio is near
 * constant; it is still checked on a render at three widths rather than
 * trusted.
 *
 * Per-seat `left: 4%` declarations would have reached the same two points
 * and silently detached the other four seats from the ellipse the canvas
 * ring is derived from — see the note on `.poker-rail` below.
 *
 * KEEPING THE CANVAS IN STEP COSTS NOTHING HERE, BY DESIGN. The chip room
 * measures `.poker-rail`'s real box (`fitView` in table-scene.tsx) and solves
 * its own plan shape from it, so bet spots follow the rail automatically. What
 * that buys is also what it demands: the landscape rail inset in
 * 12-responsive.css and `LANDSCAPE_CENTER_Y` are one decision written twice
 * and must move together — the rail is inset 14% top and 4% bottom there so
 * its centre is this ellipse's `cy`, and a ring centred anywhere else would
 * orbit a point the felt is not at.
 *
 * The flank seats sit *on the cloth* here rather than at the rail's edge, and
 * that is the plate's doing rather than a slip. A landscape seat box is a
 * fifth of the plate's width, so a ring wide enough to put its centres on the
 * rail is the one measured above that hangs them off the screen. The desktop
 * relationship RADIUS_X documents — a figure meeting the rail from outside —
 * needs margin either side of the ring that this stage does not have.
 *
 * A flank is a PAIR of seats, not one, so `LANDSCAPE_CENTER_Y` is the line
 * they straddle (45% ± ry/2) rather than the top of either. There is no ry
 * that puts two seats at the same height without collapsing the ellipse into
 * a horizontal line and stacking the near and far chairs on the board.
 */
const LANDSCAPE_RADIUS_X = 43.5;
/**
 * The vertical pair, solved together against the two things that bound them.
 *
 * A landscape seat box is 104px tall in a plate only ~346px deep, and
 * `.seat-ring` lifts each box by `(seatWidth + plateHeight) / 2` — about 85px
 * for the far chair — so the ring cannot simply be centred and given a
 * generous radius. Two constraints, in plate percent, with H the plate's
 * height in px:
 *
 *   the far seat must clear the 42px header:   cy - ry      >= 24.6
 *   the flank pair must clear the action bar:  cy + ry / 2  <= 72.2
 *
 * Together those cap ry at 31.7, and 28 takes it with margin rather than
 * sitting on the boundary. cy is then anywhere in [52.6, 58.2]; 55 is the
 * middle of that window.
 *
 * THE FIRST CUT WAS ry = 34, cy = 45, AND IT PUT THE FAR PLAYER'S HEAD UNDER
 * THE HEADER — box top at y = -3, measured, with the crown cut off by the
 * viewport. It satisfied neither constraint above because neither had been
 * written down; both came out of reading a render. The near chair is absent
 * from this arithmetic on purpose: 17-landscape.css takes slot 0 off the
 * ellipse entirely and anchors it to the stage's bottom edge, so cy is free
 * to move down without dragging the local player off the screen with it.
 */
const LANDSCAPE_RADIUS_Y = 28;
/* Also the landscape rail's own centre -- inset 14% at the top and 4% at the
   bottom gives (14 + 96) / 2 = 55. The two are one decision; a ring centred
   anywhere but the felt's centre orbits a point the table is not at. The
   asymmetry is the far seat's headroom: it hangs ~85px above its own ellipse
   point, so the space it needs is all at the top. */
const LANDSCAPE_CENTER_Y = 55;
/**
 * The viewport this ring switches on — the same condition, to the pixel, as
 * the `@media (max-height: 500px) and (orientation: landscape)` block in
 * 12-responsive.css that widens the rail to meet it.
 *
 * KEYED ON THE VIEWPORT, WHICH IS AN EXCEPTION TO THIS FILE'S OWN RULE, and
 * the exception was forced by a render rather than chosen. `radiiForTable`
 * otherwise measures the table's box on the principle that only the plate
 * knows what shape it ended up, and the first cut of this ring followed that:
 * it read the landscape plate off an aspect ratio, since `--table-aspect` is
 * 3 there against 1.84 on a desktop.
 *
 * That is true of the plate the CSS *asks* for and not of the box that
 * results. The landscape rules above make the wrap fill its area, which
 * overrides `aspect-ratio` outright — both dimensions are then definite — so
 * the measured box is whatever the letterbox left over. At 844x390 that is
 * 793x346, an aspect of 2.29; on a 667x375 handset it is 627x333, or 1.88,
 * which is within 0.04 of the desktop oval. There is no threshold that
 * separates them. The ring silently kept its desktop radii and the seats
 * stayed bunched — measured, not reasoned: the leftmost pair sat at x = 8.4%
 * of the wrap where this ellipse puts them at 4%.
 *
 * Matching the media query exactly is also the stronger guarantee. The rail
 * inset and these radii are one decision; keyed on the same condition they
 * cannot switch on different viewports and leave the seats off the rail.
 */
const LANDSCAPE_MAX_HEIGHT_PX = 500;

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

export function radiiForTable(
  table: { width: number; height: number },
  /**
   * The window, when the caller has one. Optional so every existing caller
   * and test keeps working unchanged, and so a server render — which has no
   * window — simply gets the plate-derived answer it always got.
   */
  viewport?: { width: number; height: number },
): SeatEllipse {
  /* Before the portrait and narrow checks, not after. A landscape phone is
     short *and* narrow enough to trip `isNarrow`, and NARROW_RADIUS_X (38)
     pulls the ring inward -- the exact opposite of what this plate needs.
     Ordering these the other way round fails silently: the seats stay
     bunched and nothing reports that the landscape ellipse was computed and
     then discarded. */
  if (viewport && isLandscapeBand(viewport)) {
    return { rx: LANDSCAPE_RADIUS_X, ry: LANDSCAPE_RADIUS_Y, cy: LANDSCAPE_CENTER_Y };
  }
  if (isPortrait(table)) return { rx: PORTRAIT_RADIUS_X, ry: PORTRAIT_RADIUS_Y, cy: 50 };
  return isNarrow(table.width)
    ? { rx: NARROW_RADIUS_X, ry: RADIUS_Y, cy: DESKTOP_CENTER_Y }
    : { rx: RADIUS_X, ry: RADIUS_Y, cy: DESKTOP_CENTER_Y };
}

/** True once the table is taller than it is wide, i.e. showing the tall plate. */
export function isPortrait(table: { width: number; height: number }): boolean {
  return table.height > 0 && table.width / table.height < 1;
}

/**
 * True on a phone held sideways: short, and wider than it is tall.
 *
 * Takes the *viewport*, not the table — see `LANDSCAPE_MAX_HEIGHT_PX`. The
 * two clauses are the two halves of the media query it mirrors, and both are
 * needed: height alone would catch a short desktop window, and orientation
 * alone would catch every desktop there is.
 */
export function isLandscapeBand(viewport: { width: number; height: number }): boolean {
  return viewport.height > 0
    && viewport.height <= LANDSCAPE_MAX_HEIGHT_PX
    && viewport.width > viewport.height;
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
