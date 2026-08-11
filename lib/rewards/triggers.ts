import type { GameSnapshot } from "@/lib/game/types";

/**
 * When the app should offer a rewarded ad, decided without React.
 *
 * The requirement is a *decoupled* prompt: the table should not know that a
 * modal exists, and the modal should not know how a hand is won. So the whole
 * decision is this one pure reducer -- previous snapshot plus next snapshot
 * plus a wallet in, a trigger and the next watch state out -- and the hook in
 * components/rewards/use-game-achievements.ts does nothing but hold the state
 * and render what comes back.
 *
 * Pure and in lib/ for the reason lib/game/seat-presence.ts is: vitest.config
 * .ts collects only lib/ and app/, so nothing under components/ is reachable
 * by `npm test`. A rule about when to interrupt a player mid-hand is exactly
 * the kind of thing that should be pinned by a test rather than by looking at
 * it, and none of these conditions are pleasant to reproduce by hand.
 *
 * EDGE-TRIGGERED, NOT LEVEL-TRIGGERED
 *
 * Every rule here fires on a *transition*. "Balance is under a buy-in" is true
 * on every render once it is true once; "balance just fell under a buy-in" is
 * true exactly once. The former would re-open the modal the instant a player
 * dismissed it, which is the failure mode that makes a reward offer read as
 * malware. `offered` then holds each kind down for the rest of the session, so
 * a player is prompted, not pestered.
 */

export type RewardTriggerKind =
  /** The player can no longer afford the cheapest seat in the house. */
  | "low-gold"
  /** First pot of the session. */
  | "first-win"
  /** A pot worth at least BIG_POT_BIG_BLINDS big blinds. */
  | "big-pot"
  /** WIN_STREAK_MILESTONE hands in a row. */
  | "win-streak";

export interface RewardTrigger {
  kind: RewardTriggerKind;
  /** The line above the offer. Fixed strings, never interpolated prose -- see the length cap in the test. */
  headline: string;
  /** One sentence of why this appeared. */
  detail: string;
}

/** A pot this size is a moment worth marking, expressed in big blinds so it scales with the tier. */
export const BIG_POT_BIG_BLINDS = 20;

/** Consecutive wins that count as a streak. */
export const WIN_STREAK_MILESTONE = 3;

export interface RewardWatchState {
  /** Consecutive hands the local player has won. */
  winStreak: number;
  /**
   * The last hand number already folded into the streak.
   *
   * A snapshot can arrive more than once for the same hand -- a Realtime
   * invalidation and a poll can both land, and `ingest` keeps whichever is
   * newer without deduplicating identical versions. Counting a hand twice
   * would hand out a streak that never happened.
   */
  countedHand: number | null;
  /** Whether the balance was already under a buy-in, so the crossing can be detected. */
  wasBelowBuyIn: boolean;
  /** Kinds already offered this session. One prompt each, then silence. */
  offered: RewardTriggerKind[];
}

export const initialRewardWatchState: RewardWatchState = {
  winStreak: 0,
  countedHand: null,
  wasBelowBuyIn: false,
  offered: [],
};

export interface RewardWatchInput {
  /** The snapshot before this change, or null on the first observation. */
  previous: GameSnapshot | null;
  /** The snapshot now, or null in the lobby. */
  next: GameSnapshot | null;
  /** The wallet, or null before the profile has loaded. */
  goldBalance: number | null;
  /** A profile that is never charged gains nothing from a faucet. Mirrors claimDailyGold's `unlimited`. */
  unlimitedGold: boolean;
  /** The cheapest seat in the house -- TIER_CONFIG[CHEAPEST_TIER].minBuyIn, passed in so this stays pure data. */
  cheapestBuyIn: number;
}

/** The seat the requesting session owns, or null when watching rather than playing. */
function ownSeat(snapshot: GameSnapshot | null) {
  return snapshot?.seats.find((seat) => seat.isMine) ?? null;
}

/** What the local player just won, in chips. Zero when they were not among the winners. */
function ownWinnings(snapshot: GameSnapshot | null): number {
  const seat = ownSeat(snapshot);
  if (!seat || !snapshot) return 0;
  return snapshot.winners
    .filter((winner) => winner.seatId === seat.id)
    .reduce((total, winner) => total + winner.amount, 0);
}

/**
 * Folds one observation into the watch state and says whether to prompt.
 *
 * Returns the state unchanged and a null trigger for the overwhelming
 * majority of calls, which is what makes it safe to run on every render.
 */
export function advanceRewardWatch(
  state: RewardWatchState,
  input: RewardWatchInput,
): { state: RewardWatchState; trigger: RewardTrigger | null } {
  const { previous, next, goldBalance, unlimitedGold, cheapestBuyIn } = input;

  // Unlimited Gold is a gift flag, not a balance: spendGold never deducts from
  // such a profile, so crediting it means nothing and offering to would be a
  // wait through an ad in exchange for a number that was never going to move.
  if (unlimitedGold) return { state, trigger: null };

  const belowBuyIn = goldBalance !== null && goldBalance < cheapestBuyIn;
  let nextState: RewardWatchState = { ...state, wasBelowBuyIn: belowBuyIn };

  // The hand is only counted once, on the transition into a settled pot for a
  // hand number this state has not seen. `winners` is empty for the whole hand
  // and populated at showdown, so that edge is the hand ending.
  const settledHand = next !== null
    && next.winners.length > 0
    && next.handNumber !== state.countedHand
    && (previous === null || previous.winners.length === 0 || previous.handNumber !== next.handNumber);

  if (settledHand && next) {
    const won = ownWinnings(next);
    nextState = {
      ...nextState,
      countedHand: next.handNumber,
      // A hand the player sat out neither extends a streak nor breaks one --
      // they were not in it. Only a hand they were dealt into resets the
      // count. Without that, watching two hands from an "out" seat between
      // rebuys would wipe a streak the player never actually lost.
      winStreak: won > 0
        ? state.winStreak + 1
        : (wasDealtIn(next) ? 0 : state.winStreak),
    };

    const potBigBlinds = next.bigBlind > 0 ? won / next.bigBlind : 0;

    // Most notable first. A first win that is also a big pot should say "Big
    // pot"; the milestone it does not announce stays unoffered and can fire
    // later, which is why each branch marks only its own kind.
    if (won > 0 && potBigBlinds >= BIG_POT_BIG_BLINDS && !nextState.offered.includes("big-pot")) {
      return offer(nextState, {
        kind: "big-pot",
        headline: "Big pot",
        detail: `That one was worth over ${BIG_POT_BIG_BLINDS} big blinds.`,
      });
    }
    if (nextState.winStreak >= WIN_STREAK_MILESTONE && !nextState.offered.includes("win-streak")) {
      return offer(nextState, {
        kind: "win-streak",
        headline: `${WIN_STREAK_MILESTONE} in a row`,
        detail: "You are running hot. Keep the stack deep for the next one.",
      });
    }
    if (won > 0 && !nextState.offered.includes("first-win")) {
      return offer(nextState, {
        kind: "first-win",
        headline: "First pot of the session",
        detail: "Nicely played. Here is a way to top the stack back up.",
      });
    }
  }

  // Last, and deliberately: running out of Gold in the same commit as winning
  // a pot is not a thing that happens, but if the two ever did collide the
  // achievement is the better moment and the empty wallet will still be empty
  // on the next observation.
  const justFellBelow = belowBuyIn && !state.wasBelowBuyIn;
  // A player who arrives already broke gets the offer too: `previous === null`
  // with no balance is the lobby's own backstop condition, and waiting for a
  // crossing that already happened before the page loaded would mean the one
  // player who most needs the offer never sees it.
  const arrivedBroke = belowBuyIn && goldBalance !== null && state.countedHand === null && previous === null;

  if ((justFellBelow || arrivedBroke) && !nextState.offered.includes("low-gold")) {
    return offer(nextState, {
      kind: "low-gold",
      headline: "Short of a buy-in",
      detail: `You need ${cheapestBuyIn.toLocaleString("en-US")} Gold to sit down at the cheapest table.`,
    });
  }

  return { state: nextState, trigger: null };
}

/** True when the local player was dealt into the hand that just settled. */
function wasDealtIn(snapshot: GameSnapshot): boolean {
  const seat = ownSeat(snapshot);
  return seat !== null && seat.status !== "out";
}

function offer(
  state: RewardWatchState,
  trigger: RewardTrigger,
): { state: RewardWatchState; trigger: RewardTrigger } {
  return { state: { ...state, offered: [...state.offered, trigger.kind] }, trigger };
}
