/**
 * Chrono-DeLorean Mode's state mocking engine: the piece that "speeds up or
 * loops Phaser update systems to quickly test long-term tile growth states."
 *
 * WHAT THIS DOES NOT DO. It never advances a stored `readyAt`/`lastFedAt`/
 * `lastWateredAt` timestamp and never touches `Date`, `Date.now()` or the
 * system clock -- that half of Chrono-DeLorean Mode is
 * lib/server/chrono-delorean.ts's per-profile offset, applied server-side to
 * the `now` argument every StackAcres service function already accepts. This
 * module is purely cosmetic: it changes how fast Phaser's OWN clock (its
 * render loop and every tween/timer built on it) advances relative to real
 * time, using Phaser's own supported mechanism for exactly this
 * (`Phaser.Core.TimeStep.timeScale`, `Phaser.Time.Clock.timeScale`,
 * `Phaser.Tweens.TweenManager.timeScale` -- see the Phaser 3.90 API, not
 * anything invented here). Nothing it does can make a unit collectible a
 * moment sooner than the server's own guard allows; it only makes whatever
 * animation IS playing (a crop's growth tween, an animal's gait sway, a
 * harvest's chip flight) visibly race to completion, so a developer watching
 * the canvas does not have to wait real minutes for a tween that already
 * finished server-side to catch up on screen.
 *
 * WHY A STRUCTURAL INTERFACE INSTEAD OF `Phaser.Game`. A real `Phaser.Game`
 * satisfies `ChronoSimulatableGame` (it has exactly this shape), but this
 * file does not import `phaser` -- lib/ is where this codebase puts logic it
 * wants tested without booting the engine (see lib/stackacres/units.ts's own
 * header for the same reasoning), and vitest has no WebGL/canvas context to
 * boot a real Phaser.Game in anyway. `chrono-simulation-engine.test.ts` tests
 * this against a plain object shaped like one instead.
 *
 * WHERE THE GAME INSTANCE COMES FROM. `getChronoSimulatableGame` reads it off
 * the SAME dev-only `window.__stackacres` handle
 * components/arcade/stackacres/stackacres-world.tsx already exposes outside
 * production (extended with a `game` field for this feature) -- there is
 * exactly one dev-only door onto the live scene, not a second global to keep
 * in sync with it.
 */

/** The narrow slice of `Phaser.Time.Clock` / `Phaser.Tweens.TweenManager`
 *  this engine touches. Both real classes satisfy this structurally. */
export interface ChronoSimulatableClock {
  timeScale: number;
}

/** The narrow slice of one `Phaser.Scene` this engine touches. */
export interface ChronoSimulatableScene {
  time: ChronoSimulatableClock;
  tweens: ChronoSimulatableClock;
}

/** The narrow slice of `Phaser.Game` this engine touches. A real
 *  `Phaser.Game` satisfies this without any cast -- `loop` is its
 *  `Phaser.Core.TimeStep` and `scene.scenes` is its live scene list. */
export interface ChronoSimulatableGame {
  loop: ChronoSimulatableClock;
  scene: { scenes: readonly ChronoSimulatableScene[] };
}

/**
 * Bounds on the multiplier, in both directions.
 *
 * The floor exists so "slow it down to inspect a transition" stays usable
 * rather than effectively pausing the scene (Phaser still needs SOME forward
 * motion to render anything). The ceiling exists because Phaser's own timer
 * and tween systems step in discrete frames -- a large enough timeScale can
 * make a short-lived tween's `onUpdate` skip callbacks entirely as it jumps
 * past its own duration between frames, which looks like the tween never
 * played rather than like it played fast. 200x turns a 5-minute crop cycle
 * into 1.5 real seconds, comfortably inside what a 60fps frame budget can
 * still step through smoothly.
 */
export const CHRONO_MIN_TIME_SCALE = 0.1;
export const CHRONO_MAX_TIME_SCALE = 200;

export function clampChronoTimeScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(CHRONO_MAX_TIME_SCALE, Math.max(CHRONO_MIN_TIME_SCALE, scale));
}

/**
 * Sets Phaser's own clock rate everywhere a scene's animations are driven
 * from: the game loop itself, plus every live scene's `time` and `tweens`
 * managers. All three, not just `loop.timeScale`, because a Scene's `time`
 * and `tweens` managers each keep their own `timeScale` multiplier in Phaser
 * 3.90 rather than inheriting the loop's -- setting only the loop leaves
 * every tween (which is where a crop's own growth animation actually lives,
 * per components/arcade/stackacres/stackacres-scene.ts) running at 1x.
 *
 * Returns the clamped scale actually applied, so a caller rendering a slider
 * can reflect what took effect rather than what it asked for.
 */
export function setChronoTimeScale(game: ChronoSimulatableGame, scale: number): number {
  const applied = clampChronoTimeScale(scale);
  game.loop.timeScale = applied;
  for (const scene of game.scene.scenes) {
    scene.time.timeScale = applied;
    scene.tweens.timeScale = applied;
  }
  return applied;
}

/** Back to real time everywhere this engine could have touched. Always call
 *  this when the dev panel closes or unmounts -- a scene left at a non-1x
 *  timeScale would keep every later animation sped up for the rest of the
 *  session, which is exactly the kind of "still broken after I closed the
 *  tool" state a sandboxed harness must never leave behind. */
export function resetChronoTimeScale(game: ChronoSimulatableGame): void {
  setChronoTimeScale(game, 1);
}

function isChronoSimulatableClock(value: unknown): value is ChronoSimulatableClock {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { timeScale?: unknown }).timeScale === "number"
  );
}

function isChronoSimulatableScene(value: unknown): value is ChronoSimulatableScene {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { time?: unknown; tweens?: unknown };
  return isChronoSimulatableClock(candidate.time) && isChronoSimulatableClock(candidate.tweens);
}

/** Runtime shape check for whatever `window.__stackacres.game` turns out to
 *  hold -- the window global is untyped by nature (it crosses a dev-only
 *  door with no compile-time contract on the other side), so this is a real
 *  guard rather than a cast standing in for one. */
export function isChronoSimulatableGame(value: unknown): value is ChronoSimulatableGame {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { loop?: unknown; scene?: unknown };
  if (!isChronoSimulatableClock(candidate.loop)) return false;
  const sceneHolder = candidate.scene as { scenes?: unknown } | undefined;
  if (typeof sceneHolder !== "object" || sceneHolder === null || !Array.isArray(sceneHolder.scenes)) {
    return false;
  }
  return sceneHolder.scenes.every(isChronoSimulatableScene);
}

/**
 * The dev-only window handle, read defensively. `window` is undefined during
 * SSR/build (this is only ever called from a "use client" effect, but the
 * guard costs nothing and avoids a crash if that ever changes), and the
 * handle itself is absent until stackacres-world.tsx has booted a scene, or
 * in any production build at all.
 */
export function getChronoSimulatableGame(): ChronoSimulatableGame | null {
  if (typeof window === "undefined") return null;
  const handle = (window as unknown as { __stackacres?: { game?: unknown } }).__stackacres;
  if (!handle || !isChronoSimulatableGame(handle.game)) return null;
  return handle.game;
}
