/**
 * The contract behind `window.__stackchipsScene`, shared by both rooms.
 *
 * There are two table renderers -- the Canvas-2D room in
 * `components/table/scene/` and the R3F room in `components/game3d/` -- and
 * `poker-table.tsx` picks between them with a single ternary. The e2e specs
 * that check where chips land, where a bet spot sits relative to the DOM
 * avatar over it, and whether the render loop ever goes back to sleep are
 * about the *table*, not about how it is drawn, so they have to run against
 * whichever room is mounted.
 *
 * That only works if both rooms answer the same questions in the same units,
 * which is why this is one exported interface rather than a `declare global`
 * in each renderer. Two structurally-identical declarations would merge
 * without complaint until the day they drifted, and the failure then is a
 * spec silently asserting something different depending on a preference
 * flag. Here, a renderer that stops matching fails to compile.
 *
 * UNITS. Every coordinate is **viewport CSS pixels** -- the same space
 * `getBoundingClientRect()` reports in -- except `roomLift`, which is
 * canvas-local by name. Consumers compare these against DOM rects, so a
 * canvas-local answer anywhere else would be wrong by the header's height on
 * every page that has one.
 *
 * PERSPECTIVE. `roomScale` and `roomFelt` were coined for an orthographic
 * projection, where a world unit is the same number of pixels everywhere.
 * The 3D room has no such number, so it *measures* both at the felt plane
 * and says so in its implementation; a caller must not read `roomScale` as a
 * constant that holds anywhere else in the scene.
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
   * spot is the one that can end up behind its own avatar, and that is a
   * disagreement between the room and the DOM that nothing in either
   * system can notice on its own.
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
   * Pending work, not recent paint. Both rooms mean it that way -- the 2D
   * room reads its scheduler flag -- and the 3D room learned the hard way
   * that they are not the same question: under software rendering it drew
   * twice a second, so any "did we paint recently" window tight enough to
   * prove a loop had settled called a visibly animating room asleep. See the
   * note at the foot of `lib/game3d/scene-projection.ts`.
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
