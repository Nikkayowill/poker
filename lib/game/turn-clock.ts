/**
 * When, if ever, this browser should ask the server to advance the table.
 *
 * Pulled out of the effect that used to own it so it can be tested, because
 * the bugs it replaces were invisible in review and expensive in production.
 *
 * There were two, pulling in opposite directions:
 *
 *  - Too much traffic. One seated browser issued POST /advance every 1.5s
 *    forever; measured idle at a table, 18 requests in 30 seconds with nobody
 *    doing anything. The persistent path had a 200ms floor on its retry, and
 *    an overdue deadline is still overdue 200ms later, so it rescheduled
 *    itself indefinitely.
 *
 *  - Too little. Both paths elected a single browser -- the lowest-position
 *    human -- to run the clock. When that player closed their tab, nothing
 *    advanced the table at all. Observed live: three abandoned seats ahead of
 *    a real player, a bot showing "AI THINKING 0s", and zero requests. The
 *    polling was hiding it, so removing the polling exposed a stall.
 *
 * So: every seated human is willing to advance the table, but they queue.
 * The browser whose clock it actually is goes at the deadline; everyone else
 * waits an extra beat per place in line. A successful advance changes the
 * version, which re-plans every other browser and cancels their pending
 * attempt -- so in the ordinary case exactly one request is made, and in the
 * case where that browser is gone, the next one covers for it.
 */

/** How long each backup waits behind the browser in front of it. */
export const BACKUP_STAGGER_MS = 900;

/** The subset of a snapshot this decision needs. Deliberately primitives. */
export interface TurnClockInput {
  isSeated: boolean;
  /** ISO deadline the server wrote for the seat on turn, if any. */
  turnDeadlineAt: string | null;
  /**
   * ISO deadline for replacing a finished hand, if the table has one.
   *
   * This is what makes play continuous. A completed hand has no turn and so
   * no turn deadline, which is why the table used to rest here until somebody
   * pressed Deal. Both deadlines are resolved by the same request to the same
   * route, so the queue, the stagger and the optimistic write all carry over
   * without a second mechanism.
   */
  nextHandAt: string | null;
  /** Whether the seat currently on turn is a human. */
  currentIsHuman: boolean;
  /** Is the seat on turn mine? */
  currentIsMine: boolean;
  /**
   * My place in the queue of seated humans, ordered by seat position.
   * 0 for the first, 1 for the next, and so on. -1 if I am not seated.
   */
  myHumanRank: number;
}

export type TurnClockPlan =
  | { kind: "idle"; reason: string }
  | { kind: "advance-at"; delayMs: number; rank: number };

/**
 * How many places back in the queue this browser sits for the current turn.
 *
 * When a human is on the clock it is their own browser's job first -- they
 * are the one who might still act, and the request that resolves their
 * expired clock should come from them. Otherwise the queue is simply seat
 * order, which every browser computes identically from the same snapshot.
 */
export function advanceRank(input: TurnClockInput): number {
  if (!input.isSeated || input.myHumanRank < 0) return -1;
  if (input.currentIsHuman) return input.currentIsMine ? 0 : input.myHumanRank + 1;
  return input.myHumanRank;
}

export function planTurnClock(input: TurnClockInput, now: number): TurnClockPlan {
  if (!input.isSeated) return { kind: "idle", reason: "not seated" };

  const rank = advanceRank(input);
  if (rank < 0) return { kind: "idle", reason: "not a seated human" };

  // A turn deadline when a hand is in play, a next-hand deadline when one has
  // just finished. Never both: the engine clears the turn when it completes a
  // hand and clears nextHandAt when it deals one.
  const turn = Date.parse(input.turnDeadlineAt ?? "");
  const nextHand = Date.parse(input.nextHandAt ?? "");
  const deadline = Number.isFinite(turn) ? turn : nextHand;
  // Neither means there is nothing to wait for: a table with no funded
  // opponents, or one still waiting for players. That is the state a table
  // rests in, and it must generate nothing.
  if (!Number.isFinite(deadline)) return { kind: "idle", reason: "no deadline" };

  // Overdue: go now, once. A minimum delay here is what produced the retry
  // storm, because the deadline stayed overdue between attempts.
  const delayMs = Math.max(0, deadline - now) + rank * BACKUP_STAGGER_MS;
  return { kind: "advance-at", delayMs, rank };
}
