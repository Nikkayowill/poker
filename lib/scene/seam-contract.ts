/**
 * The contract behind `window.__stackchipsScene`, implemented today by the
 * racetrack room (`components/table/scene/racetrack-scene.tsx`). The e2e
 * specs that check where chips land, where a bet spot sits relative to the
 * DOM avatar over it, and whether the render loop ever goes back to sleep
 * are about the *table*, not about how it is drawn, which is why this is a
 * standalone interface rather than a `declare global` inlined into that one
 * renderer -- a renderer that stops matching it fails to compile instead of
 * a spec silently asserting something the room no longer answers.
 *
 * It used to have a second implementer, the deleted WebGL 3D room
 * (`archive/webgl-3d-table` git tag), which is also why some of the
 * commentary below still explains a choice in terms of two renderers
 * agreeing rather than one.
 *
 * Units: every coordinate is viewport CSS pixels, the same space
 * `getBoundingClientRect()` reports in, except `roomLift`, which is
 * canvas-local by name. Consumers compare these against DOM rects, so a
 * canvas-local answer anywhere else would be wrong by the header's height on
 * every page that has one.
 *
 * Perspective: `roomScale` and `roomFelt` were coined for an orthographic
 * projection, where a world unit is the same number of pixels everywhere.
 * A true perspective camera has no such number, so the racetrack *measures*
 * both at the felt plane and says so in its implementation; a caller must
 * not read `roomScale` as a constant that holds anywhere else in the scene.
 */
export interface StackchipsSceneSeam {
  /** Chips in flight, projected into viewport CSS pixels. */
  chips: () => Array<{ x: number; y: number }>;
  /** Chips resting in the centre pot pile. Standing bets are not counted. */
  pileSize: () => number;
  /** Where the scene thinks a ring slot is, in viewport CSS pixels. */
  seat: (slot: number) => { x: number; y: number };
  /**
   * Where that slot's chips rest when it bets, in viewport CSS pixels.
   *
   * Exposed alongside `seat` because the two have to be checked against
   * each other: slot 0's figure is drawn out over the cloth, so its bet
   * spot is the one that can end up behind its own avatar, a disagreement
   * between the room and the DOM that nothing in either system can notice
   * on its own.
   */
  betSpot: (slot: number) => { x: number; y: number };
  /** CSS pixels per world unit, at the felt plane. */
  roomScale: () => number;
  /**
   * The felt's on-screen size, in CSS pixels. Both axes, because the table's
   * shape is solved per viewport: `roomScale` alone cannot tell a wide
   * desktop oval from a tall portrait one.
   */
  roomFelt: () => { width: number; height: number };
  /** Where world-origin's screen Y landed, canvas-local. */
  roomLift: () => number;
  /** Ring slots the last payout was aimed at. */
  lastFunnel: () => number[];
  /**
   * Whether the room still has animation to show.
   *
   * Pending work, not recent paint -- this room reads its scheduler flag
   * rather than a "did we paint recently" window. The deleted WebGL 3D room
   * learned the hard way that those are not the same question: under
   * software rendering it drew twice a second, so a recency window tight
   * enough to prove a loop had settled called a visibly animating room
   * asleep.
   */
  awake: () => boolean;
  /**
   * Frames actually drawn since the room mounted. The independent half of
   * the sleep evidence: a loop spinning with nothing to show moves this
   * while `awake()` reads false.
   */
  framesRendered: () => number;
}

declare global {
  interface Window {
    __stackchipsScene?: StackchipsSceneSeam;
  }
}
