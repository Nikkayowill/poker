/**
 * The swing gauge: a screen-anchored popup's timing bar for a graded, one-tap
 * strike -- the shared mechanic behind chopping a tree and mining a boulder.
 *
 * PURE AND RENDERER-FREE, same split ./fishing-gauge.ts keeps against its own
 * scene: nothing here knows about pixels or Phaser, and a caller integrates
 * frames of `dtMs` on its own clock. Where ./fishing-gauge.ts is a HOLD
 * mechanic (track a moving fish with a bar you steer), this is a single-TAP
 * mechanic: a marker sweeps back and forth across a track once, and the one
 * press decides the grade. That is the shape wood-chopping is described as
 * having introduced (a sweeping timing bar with a "sweet zone"); this module
 * is a fresh, from-scratch build of the same shape rather than a copy of that
 * branch's file, since it lands on a branch cut from `origin/main` and that
 * branch's own module is not reachable from here (see this feature's own
 * report for that constraint). It is written generic over a `SwingGaugeKind`
 * so a future merge of wood-chopping's own gauge can fold into this one
 * instead of the app carrying two near-identical sweep-and-grade modules.
 *
 * SCORING. The marker sweeps 0..1..0 forever at `sweepSpeed` track-fractions
 * per second. A tap while the marker sits inside `sweetZone` grades "sweet";
 * anywhere else on the track still grades "hit" -- there is no way to miss
 * the swing outright, because whether the swing LANDS is never this module's
 * call (the server's node state owns that; see ./stone-nodes.ts). This
 * module only ever grades HOW WELL a landed swing went, matching the brief
 * that a timing miss changes yield, never validity.
 */

export type SwingGaugeKind = "mine" | "chop";

export interface SwingGaugeProfile {
  /** Track fractions/second the marker sweeps at. */
  readonly sweepSpeed: number;
  /** [start, end) of the track, 0..1, that grades a "sweet" tap. */
  readonly sweetZone: readonly [number, number];
}

/**
 * One profile per kind. Mining's sweet zone is narrower than a hypothetical
 * chop's would be (stone is meant to reward precision a little more than
 * wood does, the same "tougher than wood" posture ./stone-nodes.ts's
 * `HITS_TO_BREAK` takes), and sweeps a touch faster for the same reason.
 */
export const SWING_GAUGE_PROFILES: Readonly<Record<SwingGaugeKind, SwingGaugeProfile>> = {
  mine: { sweepSpeed: 0.9, sweetZone: [0.42, 0.58] },
  chop: { sweepSpeed: 0.75, sweetZone: [0.38, 0.62] },
};

export interface SwingGaugeState {
  readonly kind: SwingGaugeKind;
  /** 0..1 position of the marker on the track. */
  readonly position: number;
  /** +1 or -1: which way the marker is currently travelling. */
  readonly direction: 1 | -1;
  /** Set once a tap has graded this swing; further ticks are inert. */
  readonly resolved: "hit" | "sweet" | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function swingGaugeProfile(kind: SwingGaugeKind): SwingGaugeProfile {
  return SWING_GAUGE_PROFILES[kind];
}

/** A fresh gauge: the marker starts at the bottom of the track, heading up. */
export function createSwingGaugeState(kind: SwingGaugeKind): SwingGaugeState {
  return { kind, position: 0, direction: 1, resolved: null };
}

/** Advances the marker by one frame. A resolved gauge is inert -- the same
 *  "a finished gauge returns itself untouched" contract ./fishing-gauge.ts's
 *  `stepFishingGauge` holds, so a scene that keeps ticking after the tap
 *  cannot un-resolve it. */
export function stepSwingGauge(state: SwingGaugeState, dtMs: number): SwingGaugeState {
  if (state.resolved) return state;
  const profile = swingGaugeProfile(state.kind);
  const dt = Math.max(0, dtMs) / 1000;
  let position = state.position + state.direction * profile.sweepSpeed * dt;
  let direction = state.direction;
  if (position >= 1) {
    position = 1 - (position - 1);
    direction = -1;
  } else if (position <= 0) {
    position = -position;
    direction = 1;
  }
  return { ...state, position: clamp01(position), direction };
}

/** Grades a tap at the gauge's current position. Idempotent: a gauge already
 *  resolved returns its own grade rather than re-rolling on a double tap. */
export function resolveSwingTap(state: SwingGaugeState): SwingGaugeState {
  if (state.resolved) return state;
  const [start, end] = swingGaugeProfile(state.kind).sweetZone;
  const grade = state.position >= start && state.position <= end ? "sweet" : "hit";
  return { ...state, resolved: grade };
}
