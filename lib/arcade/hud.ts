/**
 * The arcade HUD's rules, as arithmetic.
 *
 * A credit meter that rolls up to a win, a banner whose size matches what was
 * actually won, a session ledger that knows which way it is pointing. These
 * read as decoration, which is exactly why they belong here rather than inside
 * a component: `vitest.config.ts` collects only lib/ and app/, so anything
 * under components/ is unreachable by `npm test`, and "the jackpot banner
 * never fires on a push" is a claim worth being able to check.
 *
 * Nothing here touches the DOM, a clock or `Math.random`. A caller passes the
 * elapsed time in; two renders of the same moment must agree, which is the
 * same determinism contract lib/scene/chip-physics.ts holds.
 */

/** How long a credit meter takes to roll from one balance to the next. */
export const METER_ROLL_MS = 620;

/**
 * Where a rolling meter sits partway through.
 *
 * Cubic ease-out, so it leaves fast and lands soft -- the movement a real
 * credit meter makes, and the reason a linear ramp reads as a progress bar
 * instead. It terminates *exactly*: at `elapsed >= duration` this returns `to`
 * itself rather than something within a rounding error of it, so the number a
 * player finally reads is the number the server sent. The same "a clocked
 * animation must end, not asymptote" argument `stepGlideChip` makes.
 */
export function meterValue(from: number, to: number, elapsedMs: number, durationMs = METER_ROLL_MS): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return to;
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  if (elapsedMs <= 0) return from;
  const progress = elapsedMs / durationMs;
  const eased = 1 - (1 - progress) ** 3;
  return Math.round(from + (to - from) * eased);
}

export type SessionTone = "up" | "down" | "flat";

/** Which way a session ledger is pointing. Zero is flat, not a loss. */
export function sessionTone(net: number): SessionTone {
  if (net > 0) return "up";
  if (net < 0) return "down";
  return "flat";
}

/** "+1,200" / "-500" / "0". An explicit sign on a gain, because a bare number reads as a balance. */
export function formatSigned(amount: number): string {
  return amount > 0 ? `+${amount.toLocaleString()}` : amount.toLocaleString();
}

/**
 * How loud the celebration should be.
 *
 * Measured against the stake rather than in absolute Gold, because the same
 * 5,000 is a routine even-money win at the 5k tier and a twenty-to-one hit at
 * the 250 one. A player who sees the jackpot treatment for a push learns to
 * ignore the banner, which costs it the one job it has.
 *
 * `push` is its own tier and not `none`: getting your stake back is a real
 * outcome the felt should name, and it is emphatically not a win.
 */
export type CelebrationTier = "loss" | "push" | "win" | "big-win" | "jackpot";

/** A win paying this many times the stake or more gets the full treatment. */
export const JACKPOT_MULTIPLE = 20;
/** ...and this many gets the middle one. */
export const BIG_WIN_MULTIPLE = 4;

export function celebrationTier(netGold: number, stake: number): CelebrationTier {
  if (netGold < 0) return "loss";
  if (netGold === 0) return "push";
  // A non-positive stake cannot scale anything; treat any win on one as
  // ordinary rather than dividing by zero into Infinity and firing a jackpot.
  if (!Number.isFinite(stake) || stake <= 0) return "win";
  const multiple = netGold / stake;
  if (multiple >= JACKPOT_MULTIPLE) return "jackpot";
  if (multiple >= BIG_WIN_MULTIPLE) return "big-win";
  return "win";
}

/** Whether a tier deserves the roaring crowd rather than the routine chip sound. */
export function isCelebration(tier: CelebrationTier): boolean {
  return tier === "big-win" || tier === "jackpot";
}
