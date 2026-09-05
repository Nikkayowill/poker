/**
 * The Frenzy Heat Combo Engine: how fast the player is tapping, turned into a
 * short-lived "heat" value and a small ladder of feel tiers riding on top of
 * it.
 *
 * PURE REAL-TIME MODIFIER, NOT A GAME RULE. Nothing in this file is ever
 * written to a row, and nothing it returns is allowed near a settlement path.
 * `equipment.ts`'s own header already draws this exact line for
 * `StackAcresToolTierDef` -- `reach` is cosmetic-adjacent and client-only,
 * `critChance`/`critBonus` pay Gold and are server-rolled -- and this file
 * sits entirely on the `reach` side of it. `yieldMultiplier` below is a
 * DISPLAY bonus a harvest handler may float on top of a tap (see
 * `frenzyBonusYield`); the real payout is still whatever
 * `harvestStackAcres`'s guarded write says it is, unmodified. A player who
 * tabs away and back gets a cold engine and nothing else changes -- there is
 * no state here worth restoring, which is the whole point of "never saved".
 *
 * HEAT IS A FUNCTION OF TIME, NOT A COUNTER. Every earlier draft of this that
 * tried to decay a stored number by some fixed amount "per frame" drifted
 * under a variable frame rate and needed its own clamp to match
 * `frameSeconds`'s. Instead, `heatAtLastHit` is a value FROZEN at the instant
 * of the last hit, and `heatAt(now)` derives the current heat by evaluating a
 * pure decay curve against elapsed wall-clock time -- calling it twice with
 * the same `now` is guaranteed to agree, and nothing here needs its own
 * per-frame clamp because nothing here integrates.
 *
 * THE STREAK IS FOR THE HIT-FREQUENCY GATE, NOT A SEPARATE SCORE. A "combo"
 * only continues while hits land inside `FRENZY_COMBO_BREAK_MS` of each
 * other; anything slower resets it to 1. A longer streak earns a slightly
 * bigger `registerHit` gain (capped at `FRENZY_HIT_STREAK_BONUS_CAP`), which
 * is what makes a sustained fast tapper climb the tier ladder measurably
 * faster than someone landing the same total number of hits with gaps
 * between them -- "frequency" is the whole mechanic, so the curve has to
 * reward it twice: once by outrunning decay, once by the streak bonus.
 *
 * Pure, and in lib/ for the usual reason: vitest only reaches lib/ and app/.
 * The only consumer with a Phaser instance is
 * components/arcade/stackacres/frenzy-fx-manager.ts, which plays this file's
 * numbers back through a screen tint, a particle rate and a couple of
 * one-shot bursts and decides none of them itself.
 */

/* ------------------------------------------------------------------ */
/* The tier ladder                                                     */
/* ------------------------------------------------------------------ */

export type FrenzyTier = "cold" | "warm" | "hot" | "blazing" | "overdrive";

export interface FrenzyTierDef {
  tier: FrenzyTier;
  /** The heat value (0..1) at which this tier starts. Tiers are checked in
   *  ascending order and the LAST one whose threshold is met wins, so this
   *  array must stay sorted ascending -- `tierForHeat` does not sort it. */
  minHeat: number;
  /** Multiplies a harvest's DISPLAY yield only -- see `frenzyBonusYield` and
   *  this file's own header for why the real payout never reads this. */
  yieldMultiplier: number;
  /** Multiplies the farmhand's walk speed for as long as this tier holds --
   *  see lib/stackacres/farmhand-path.ts's `advanceTowards`, whose optional
   *  `speedMultiplier` parameter exists for exactly this caller. Cosmetic:
   *  he is presentation, not authority (farmhand.ts's own header), so a
   *  faster or slower errand runner changes nothing about what was already
   *  sent to the server. */
  speedMultiplier: number;
  /** Packed 0xRRGGBB, this tier's own signature colour -- used for a burst's
   *  particles and a bonus label's text, never for the continuous screen
   *  wash (see `frenzyOverlayColor`, which blends smoothly by heat instead
   *  of stepping at these boundaries). */
  tint: number;
  /** What a bonus label calls this tier. Never shown for "cold" -- there is
   *  nothing to celebrate at baseline, which is why every FX trigger in
   *  frenzy-fx-manager.ts checks for it explicitly. */
  label: string;
}

/**
 * Five rungs. Kept short on purpose: a ladder long enough to need its own
 * legend defeats a HUD-less feel system, and StackAcres already runs the
 * juice budget `game-juice-manager.ts`'s own header sets for a screen that
 * may be sharing a browser tab with a live poker table -- the top rung
 * (`overdrive`) still stays inside that budget (see FRENZY_OVERLAY_MAX_ALPHA
 * and FRENZY_PULSE_AMPLITUDE below).
 */
export const FRENZY_TIERS: readonly FrenzyTierDef[] = [
  { tier: "cold", minHeat: 0, yieldMultiplier: 1, speedMultiplier: 1, tint: 0xffffff, label: "" },
  { tier: "warm", minHeat: 0.3, yieldMultiplier: 1.1, speedMultiplier: 1.05, tint: 0xffe08a, label: "WARM" },
  { tier: "hot", minHeat: 0.55, yieldMultiplier: 1.25, speedMultiplier: 1.15, tint: 0xffb347, label: "HOT" },
  {
    tier: "blazing",
    minHeat: 0.78,
    yieldMultiplier: 1.45,
    speedMultiplier: 1.3,
    tint: 0xff7a1f,
    label: "BLAZING",
  },
  {
    tier: "overdrive",
    minHeat: 0.95,
    yieldMultiplier: 1.75,
    speedMultiplier: 1.5,
    tint: 0xff3d1f,
    label: "OVERDRIVE",
  },
];

/** The tier a given heat value sits in -- the last rung whose `minHeat` it
 *  clears, so `heat` of exactly a threshold belongs to the tier it opens. */
export function tierForHeat(heat: number): FrenzyTierDef {
  let match = FRENZY_TIERS[0];
  for (const def of FRENZY_TIERS) {
    if (heat >= def.minHeat) match = def;
  }
  return match;
}

/* ------------------------------------------------------------------ */
/* Heat: gain, decay, combo window                                     */
/* ------------------------------------------------------------------ */

/** Heat added by any hit that keeps a combo alive, before the streak bonus. */
const FRENZY_HIT_BASE_GAIN = 0.1;
/** Extra heat per streak level, so a longer run climbs faster than the same
 *  number of hits spread out with gaps between them. */
const FRENZY_HIT_STREAK_BONUS = 0.01;
/** Streak level the bonus above stops growing past -- a hundred-hit run
 *  should not gain heat any faster than a twelve-hit one. */
const FRENZY_HIT_STREAK_BONUS_CAP = 10;
/** A gap this long or longer breaks the streak back to 1 on the next hit.
 *  Below the "hot" tier's own decay-to-zero time (see FRENZY_DECAY_PER_MS's
 *  own comment) on purpose: a broken combo should read as broken well before
 *  the heat bar has finished bleeding out. */
export const FRENZY_COMBO_BREAK_MS = 900;
/** How long heat holds at its last value before decay starts eating it --
 *  the "grace" a single tap gets to not visibly start cooling the instant it
 *  lands, matching the small pause every other tap-driven effect in this
 *  scene (`popUnit`'s own bounce) takes before anything reads as settled. */
const FRENZY_DECAY_GRACE_MS = 220;
/** Heat lost per millisecond once decay is running. At this rate, full heat
 *  (1.0) bleeds out in ~2.2s of silence after the grace window -- long enough
 *  that a brief pause to read a float label does not instantly cool a run,
 *  short enough that heat is a real-time signal and not a slow-draining
 *  battery. */
const FRENZY_DECAY_PER_MS = 0.00045;

export interface FrenzySnapshot {
  /** 0..1. Never persisted -- see this file's own header. */
  heat: number;
  /** Consecutive hits landed inside `FRENZY_COMBO_BREAK_MS` of each other. */
  streak: number;
  tier: FrenzyTierDef;
}

/**
 * The engine itself: three numbers, and every read of them is a pure
 * function of `now` rather than of "how many frames have ticked since". See
 * this file's own header for why that split matters.
 *
 *     const frenzy = new FarmFrenzyManager();
 *     // on an accepted tap:
 *     const snapshot = frenzy.registerHit(scene.time.now);
 *     // every frame, whether or not a tap landed on it:
 *     const snapshot = frenzy.sample(scene.time.now);
 */
export class FarmFrenzyManager {
  private lastHitAt: number | null = null;
  private heatAtLastHit = 0;
  private streak = 0;

  /**
   * A tap that became a real action (never a refused one -- see
   * onWorldUnitTap's own call site in stackacres-farm.tsx). Returns the
   * snapshot immediately, so a caller can throw a bonus float off the same
   * frame the hit landed on rather than waiting for the next `sample`.
   */
  registerHit(now: number): FrenzySnapshot {
    // A gap outside [0, FRENZY_COMBO_BREAK_MS] breaks the streak -- both "too
    // slow" (gap too large) and "went backwards" (gap negative, which only
    // happens if the scene's own clock did, e.g. a hard scene restart) are
    // the same case: nothing about the PREVIOUS hit can be trusted to still
    // describe a live combo, so start a fresh one rather than let a negative
    // duration corrupt the decay math below.
    const gap = this.lastHitAt === null ? Number.POSITIVE_INFINITY : now - this.lastHitAt;
    const brokeCombo = !(gap >= 0 && gap <= FRENZY_COMBO_BREAK_MS);
    this.streak = brokeCombo ? 1 : this.streak + 1;

    const decayedHeat = this.heatAt(now);
    const gain =
      FRENZY_HIT_BASE_GAIN + FRENZY_HIT_STREAK_BONUS * Math.min(this.streak, FRENZY_HIT_STREAK_BONUS_CAP);
    this.heatAtLastHit = Math.min(1, decayedHeat + gain);
    this.lastHitAt = now;
    return this.snapshotAt(this.heatAtLastHit);
  }

  /**
   * A read that does not register a hit -- called every frame from the
   * scene's own `update()` so the tint, the farmhand's speed and the ember
   * rate all cool down in real time even while nothing is being tapped.
   */
  sample(now: number): FrenzySnapshot {
    const heat = this.heatAt(now);
    // Heat bled all the way to zero without a fresh miss ever landing on
    // this engine (nobody tapped for over FRENZY_COMBO_BREAK_MS, so the next
    // hit would have broken the streak anyway) -- the combo is over, and the
    // streak display should say so immediately rather than hold its last
    // number until one more tap arrives to notice.
    if (heat <= 0) this.streak = 0;
    return this.snapshotAt(heat);
  }

  /** Scene teardown, or a hard restart -- back to fully cold with no combo. */
  reset(): void {
    this.lastHitAt = null;
    this.heatAtLastHit = 0;
    this.streak = 0;
  }

  private heatAt(now: number): number {
    if (this.lastHitAt === null) return 0;
    const elapsed = now - this.lastHitAt;
    // The scene's clock moved backwards relative to the last hit it recorded
    // -- only possible from a hard scene restart resetting `time.now`. A
    // decay computed against a negative duration is meaningless; treating it
    // as fully cold is the honest answer; the same "clock is what it is,
    // never negative-decayed" posture `frameSeconds` takes for a delta.
    if (elapsed < 0) return 0;
    if (elapsed <= FRENZY_DECAY_GRACE_MS) return this.heatAtLastHit;
    const decaying = elapsed - FRENZY_DECAY_GRACE_MS;
    return Math.max(0, this.heatAtLastHit - decaying * FRENZY_DECAY_PER_MS);
  }

  private snapshotAt(heat: number): FrenzySnapshot {
    return { heat, streak: this.streak, tier: tierForHeat(heat) };
  }
}

/* ------------------------------------------------------------------ */
/* The harvest handler's own cosmetic bonus                            */
/* ------------------------------------------------------------------ */

/**
 * The DISPLAY-ONLY extra a collect's float label may claim, on top of
 * `baseYieldGold` -- itself already an ESTIMATE (STACKACRES_YIELDS' quantity
 * times its Gold value, with no crit or synergy bonus folded in, since those
 * are rolled server-side and this fires before the server has answered at
 * all). Floored at zero and rounded to a whole Gold figure, because "+0.4
 * Gold" reads as a bug and a float label has no decimal place to spend on
 * one. Returns 0 outright at the "cold" tier -- there is nothing to add at a
 * 1x multiplier, and a caller should treat 0 as "do not show a bonus label"
 * rather than "show one that says +0".
 */
export function frenzyBonusYield(baseYieldGold: number, tier: FrenzyTierDef): number {
  if (!Number.isFinite(baseYieldGold) || baseYieldGold <= 0) return 0;
  return Math.max(0, Math.round(baseYieldGold * (tier.yieldMultiplier - 1)));
}

/* ------------------------------------------------------------------ */
/* Visual overdrive: pure curves for the screen wash, pulse and embers  */
/* ------------------------------------------------------------------ */

/** The overlay's own ceiling alpha -- capped low and stated as its own
 *  constant for the same reason `CRIT_SHAKE_BONUS_CAP` in ./juice.ts is: this
 *  screen may be a background tab next to a live poker table, and a wash
 *  bright enough to read as "juicy" full-screen here would read as "the page
 *  is broken" there. */
export const FRENZY_OVERLAY_MAX_ALPHA = 0.22;

/**
 * The screen wash's opacity at a given heat: quadratic, not linear, so the
 * first half of the climb barely tints the screen and the last stretch into
 * "overdrive" ramps up fast -- the same "nothing, then suddenly a lot" shape
 * a combo meter in any tap-driven game wants, and a clean curve to hold a
 * test to.
 */
export function frenzyOverlayAlpha(heat: number): number {
  const clamped = Math.max(0, Math.min(1, heat));
  return clamped * clamped * FRENZY_OVERLAY_MAX_ALPHA;
}

/** Packed 0xRRGGBB at zero heat: no tint at all. */
const FRENZY_COOL_RGB = { r: 255, g: 255, b: 255 };
/** Packed 0xRRGGBB at heat 1: the hot orange/gold ceiling the brief asks for
 *  -- the same family as the "overdrive" tier's own `tint` but computed
 *  continuously rather than stepped, so the wash never visibly jumps at a
 *  tier boundary the way the discrete per-tier tint would if used here. */
const FRENZY_HOT_RGB = { r: 255, g: 63, b: 23 };

/** A smooth per-frame lerp between `FRENZY_COOL_RGB` and `FRENZY_HOT_RGB`,
 *  packed the way Phaser's own `setFillStyle`/`setTint` want it. Kept
 *  Phaser-free (plain arithmetic, no `Phaser.Display.Color`) so this stays
 *  testable under vitest like every other curve in this file. */
export function frenzyOverlayColor(heat: number): number {
  const t = Math.max(0, Math.min(1, heat));
  const r = Math.round(FRENZY_COOL_RGB.r + (FRENZY_HOT_RGB.r - FRENZY_COOL_RGB.r) * t);
  const g = Math.round(FRENZY_COOL_RGB.g + (FRENZY_HOT_RGB.g - FRENZY_COOL_RGB.g) * t);
  const b = Math.round(FRENZY_COOL_RGB.b + (FRENZY_HOT_RGB.b - FRENZY_COOL_RGB.b) * t);
  return (r << 16) | (g << 8) | b;
}

/** Heat below which the overlay never pulses at all -- only the top two
 *  rungs ("blazing" and "overdrive") get the rapid scale-pulse the brief
 *  asks for; "warm"/"hot" stay a plain, steady wash so the effect reads as
 *  earned rather than twitchy from the first tap. */
export const FRENZY_PULSE_MIN_HEAT = FRENZY_TIERS[3].minHeat;
/** How far the pulse swings the overlay's scale, each side of 1. Small: this
 *  is a full-screen object, and anything larger reads as the canvas itself
 *  glitching rather than "the farm is on fire". */
export const FRENZY_PULSE_AMPLITUDE = 0.018;
/** Pulses a second at the very top of the heat range. */
const FRENZY_PULSE_MAX_HZ = 3.2;

/**
 * The overlay's scale multiplier at a given heat and elapsed wall-clock time
 * -- a pure sine, not a Phaser tween, so there is no tween to create, track
 * or tear down for this: the caller just evaluates it fresh every frame
 * (lib/scene/chips's own "analytic, so the render loop can sleep" approach,
 * applied here to a full-screen object instead of a chip stack). Returns
 * exactly 1 (no pulse) below `FRENZY_PULSE_MIN_HEAT`.
 */
export function frenzyPulseScale(heat: number, elapsedMs: number): number {
  if (heat < FRENZY_PULSE_MIN_HEAT) return 1;
  // Half speed at the pulse floor, full speed at heat 1 -- the pulse itself
  // should feel like it is accelerating as the player pushes past "blazing",
  // not snap straight to its fastest rate the instant the floor is crossed.
  const span = 1 - FRENZY_PULSE_MIN_HEAT;
  const climbed = span <= 0 ? 1 : (heat - FRENZY_PULSE_MIN_HEAT) / span;
  const hz = FRENZY_PULSE_MAX_HZ * (0.5 + 0.5 * climbed);
  return 1 + FRENZY_PULSE_AMPLITUDE * Math.sin((elapsedMs / 1000) * Math.PI * 2 * hz);
}

/**
 * Heat below which a tap throws no embers at all -- "hot" and up, one rung
 * below the pulse so particles are the first sign something is building and
 * the pulse is the confirmation it has arrived. Below this, `popUnit`'s own
 * squash-and-stretch is already the answer to the finger and needs nothing
 * added to it.
 */
export const FRENZY_EMBER_MIN_HEAT = FRENZY_TIERS[2].minHeat;
const FRENZY_EMBER_COUNT_AT_THRESHOLD = 4;
const FRENZY_EMBER_COUNT_AT_MAX = 14;

/**
 * How many spark particles ONE accepted tap's burst throws, at a given heat.
 * Zero below `FRENZY_EMBER_MIN_HEAT`, scaling up to a shower at heat 1.
 *
 * A PER-TAP BURST, DELIBERATELY NOT A CONTINUOUSLY RUNNING EMITTER. Two
 * reasons. First, stackacres-scene.ts's own header states this codebase's
 * effects are "hand-built Graphics and tweens, no Phaser `ParticleEmitter`
 * (this codebase deliberately does not use one)" -- the one class that does
 * reach for a real emitter, game-juice-manager.ts, is unwired dead code, and
 * every LIVE screen-space effect (weather-overlay-manager.ts's own tint and
 * pooled dust/rain sprites, this scene's `celebrateHarvest`) follows the
 * hand-built convention instead. Second, and more to the point of what this
 * engine measures: an idle ambient stream that keeps throwing sparks during
 * the half-second between taps would read as background noise rather than
 * as an answer to the finger that caused it -- exactly the distinction
 * `game-juice-manager.ts`'s own header draws between "fire-and-forget,
 * called from a pointer-down handler" effects and anything driven by a
 * scene-owned clock.
 */
export function frenzyEmberCount(heat: number): number {
  if (heat < FRENZY_EMBER_MIN_HEAT) return 0;
  const span = 1 - FRENZY_EMBER_MIN_HEAT;
  const t = span <= 0 ? 1 : Math.min(1, (heat - FRENZY_EMBER_MIN_HEAT) / span);
  return Math.round(
    FRENZY_EMBER_COUNT_AT_THRESHOLD + (FRENZY_EMBER_COUNT_AT_MAX - FRENZY_EMBER_COUNT_AT_THRESHOLD) * t,
  );
}
