/**
 * WHICH CLIP A SEATED AVATAR SHOULD BE PLAYING — the whole of it, as one
 * pure transition machine, so that "what is running" is a value that can be
 * recomputed from scratch every frame rather than a set of side effects that
 * have to have fired in the right order.
 *
 * THE BUG THIS REPLACES, precisely, because it is the shape of the whole
 * problem. glb-avatar.tsx used to start a one-shot gesture and arm a
 * `window.setTimeout` to hand the figure back to its sustained mood. The
 * effect that armed it listed `transientState` among its dependencies, and
 * its cleanup cleared the timeout on EVERY re-run — so when `lastAction`
 * went null while a gesture was still playing (a new hand starting inside
 * `Poker_Bet`'s 2.17s, against a 2,800ms NEXT_HAND_DELAY_MS), the effect
 * cleared the restore, re-ran, early-returned on its own `!transientState`
 * guard, and armed nothing. The gesture then reached its last frame, and
 * because one-shots are played with `clampWhenFinished`, three.js paused it
 * there. `baseState` had not changed, so the effect that plays the base
 * never re-ran either. The avatar held the final frame of a bet until its
 * mood or status next happened to change.
 *
 * THREE RULES FALL OUT OF THAT, and they are what this module encodes.
 *
 * 1. A DEFERRED HAND-BACK MUST BE ADDRESSED TO A SPECIFIC GESTURE, never to
 *    "whatever is playing". Every committed change bumps `epoch`, and both
 *    ways a gesture can end (`settleGesture` from the mixer's own `finished`
 *    event, `tickPlayback` from the scene clock) take the epoch they were
 *    issued under and no-op if it has moved. A late signal from a gesture
 *    that has already been superseded cannot cancel its replacement, which
 *    is the failure that "trapped weight" actually looks like from here.
 *
 * 2. THE DEADLINE IS IN SCENE-CLOCK SECONDS, NOT WALL CLOCK. drei's
 *    `useAnimations` advances the mixer from `useFrame((state, delta) =>
 *    mixer.update(delta))`, so a clip's remaining duration is denominated in
 *    the same clock `state.clock.elapsedTime` counts and NOT in the one
 *    `setTimeout` fires on. The two diverge the moment rAF throttles — a
 *    hidden tab stops the mixer dead while timers keep firing, so a
 *    wall-clock restore lands on a gesture that has not visually played.
 *    Sharing one clock makes that case correct by construction rather than
 *    by clamping: when the frame loop stalls, the deadline stalls with it.
 *
 * 3. A REQUEST THAT CHANGES NOTHING MUST CHANGE NOTHING. `requestBase` with
 *    the base it already holds returns the identical state, gesture intact.
 *    React effects re-run for reasons that have nothing to do with the
 *    server (a parent re-render, StrictMode's double invoke), and an
 *    idempotent request is what stops a re-render from cancelling a gesture
 *    that is halfway through playing.
 *
 * Pure — no three.js, no timers, no clock of its own — so `npm test` reaches
 * every transition, the same convention `arm-ik.ts` and `hand-anchors.ts`
 * follow. The caller owns exactly two things this cannot: reading the scene
 * clock, and driving the mixer to match `activeClip`.
 */

import { CLIP_FADE_S, type AvatarAnimationState } from "./avatar-state";

/**
 * How long past its own deadline a gesture is allowed to linger before the
 * frame-loop watchdog takes it off regardless.
 *
 * Zero on purpose. The deadline is already the moment the hand-back should
 * begin (see `requestGesture`), it is measured in the same clock the
 * watchdog reads, and the mixer's `finished` event — which fires a further
 * CLIP_FADE_S later, at the clip's true end — is the independent backstop.
 * A slack window here would only postpone the recovery this whole module
 * exists to guarantee, and buys nothing: there is no jitter between two
 * readings of one clock.
 */
export const GESTURE_WATCHDOG_SLACK_S = 0;

export interface PlaybackState {
  /** The sustained state: what plays whenever no gesture is running. */
  readonly base: AvatarAnimationState;
  /** The one-shot currently running, or null when the base holds the figure. */
  readonly gesture: AvatarAnimationState | null;
  /** Scene-clock second at which `gesture` should begin handing back. */
  readonly gestureEndsAt: number;
  /**
   * Bumped on every committed transition. This is the identity a deferred
   * hand-back is addressed to — not the clip name, which repeats (two calls
   * in a row are the same `Poker_Bet`) and so cannot tell one gesture from
   * the next.
   */
  readonly epoch: number;
}

/** What the mixer should be playing, and whether it is a one-shot. */
export interface ActiveClip {
  readonly state: AvatarAnimationState;
  readonly once: boolean;
  /** The `epoch` this selection belongs to; see PlaybackState.epoch. */
  readonly epoch: number;
}

export function initialPlayback(base: AvatarAnimationState): PlaybackState {
  return { base, gesture: null, gestureEndsAt: 0, epoch: 0 };
}

/**
 * Sustained states that own the figure outright and refuse to be interrupted:
 * a folded player holds their lean-back until the next hand, and a winner
 * mid-toss should celebrate rather than finish miming a bet.
 *
 * Both are played as one-shots with `clampWhenFinished`, so unlike every
 * other base state they end on a held final frame rather than a loop — which
 * is exactly why a gesture must not be allowed to start on top of one: there
 * would be nothing running underneath to come back to.
 */
export function holdsTheFigure(base: AvatarAnimationState): boolean {
  return base === "fold" || base === "celebrate";
}

/**
 * Move to a new sustained state. A real change cancels any running gesture —
 * a player who has just folded is not still completing a raise — but a
 * request for the base already held is a no-op, gesture and all. See rule 3
 * in this file's header for why that distinction is load-bearing rather
 * than an optimisation.
 */
export function requestBase(
  state: PlaybackState,
  base: AvatarAnimationState,
): PlaybackState {
  if (base === state.base) return state;
  return { base, gesture: null, gestureEndsAt: 0, epoch: state.epoch + 1 };
}

/**
 * Start a one-shot gesture, replacing any gesture already running.
 *
 * `durationS` is the clip's own length and `nowS` the current scene clock.
 * The deadline lands CLIP_FADE_S early so the return crossfade overlaps the
 * clip's tail rather than following it — the bake keys every action to end
 * back at `base_pose`, so the last beat of the clip and the first beat of
 * the fade home are the same movement, and playing them in sequence reads as
 * the gesture finishing twice. This reproduces the timing the previous
 * `setTimeout` computed, on a clock that cannot drift from the mixer's.
 *
 * Refused outright while the base holds the figure — the caller's own guard
 * used to be the only thing enforcing that, which meant it held only on the
 * paths that remembered to check.
 */
export function requestGesture(
  state: PlaybackState,
  gesture: AvatarAnimationState,
  durationS: number,
  nowS: number,
): PlaybackState {
  if (holdsTheFigure(state.base)) return state;
  const hold = Math.max(0, durationS - CLIP_FADE_S);
  return {
    base: state.base,
    gesture,
    gestureEndsAt: nowS + hold,
    epoch: state.epoch + 1,
  };
}

/**
 * Retire the gesture that was running under `epoch` — the authoritative
 * path, driven by the mixer's own `finished` event, which is the only signal
 * in the system that comes from the clip actually reaching its end rather
 * than from a prediction about when it would.
 *
 * Epoch-guarded, so a `finished` arriving from a gesture that has already
 * been superseded cannot take its replacement off the figure.
 */
export function settleGesture(state: PlaybackState, epoch: number): PlaybackState {
  if (state.gesture === null || epoch !== state.epoch) return state;
  return { ...state, gesture: null, gestureEndsAt: 0, epoch: state.epoch + 1 };
}

/**
 * The frame-loop watchdog: retire a gesture whose deadline has passed.
 *
 * Primary rather than a fallback — it fires CLIP_FADE_S before the clip's
 * true end (see `requestGesture`), so in ordinary running it is what hands
 * the figure back and the later `finished` event is a no-op against the
 * already-bumped epoch. Its real job is that it is unconditional: it needs
 * no event to have been delivered and no effect to have been scheduled, so
 * whatever else was missed, the next frame recovers.
 */
export function tickPlayback(state: PlaybackState, nowS: number): PlaybackState {
  if (state.gesture === null) return state;
  if (nowS < state.gestureEndsAt + GESTURE_WATCHDOG_SLACK_S) return state;
  return { ...state, gesture: null, gestureEndsAt: 0, epoch: state.epoch + 1 };
}

/**
 * What should be on the figure right now. Total by construction — there is
 * always a base, so there is always an answer, and the caller never has to
 * decide what to do about "nothing is playing".
 */
export function activeClip(state: PlaybackState): ActiveClip {
  if (state.gesture !== null) {
    return { state: state.gesture, once: true, epoch: state.epoch };
  }
  return { state: state.base, once: holdsTheFigure(state.base), epoch: state.epoch };
}

/**
 * Is a gesture on the figure right now?
 *
 * Read by the hand rig, which stands down while one plays so the last half
 * of a bet is not dragged back toward the card spot mid-throw. Derived from
 * the machine rather than tracked separately, which is the fix for its own
 * bug: the deadline used to live in a ref that only the timeout path ever
 * cleared, so a gesture cancelled by a fold left the hands standing down for
 * the remainder of a gesture that was no longer playing.
 */
export function isGesturing(state: PlaybackState): boolean {
  return state.gesture !== null;
}
