import { isSeatRebuyEligible } from "./rebuy";
import type { GameSnapshot, PlayerAction } from "./types";

/**
 * Whether an action the server turned away as stale is still exactly the
 * decision the player made, so the client can send it once more against the
 * new version.
 *
 * The version check exists so a retried request can't bet twice. But the
 * version also moves when someone else joins, leaves or rebuys mid-turn, and
 * then a fold or call that never landed was silently dropped. Acting or
 * timing out always starts a new turn, so the same hand, street and turn
 * start means this player's move has not been applied yet. The server still
 * validates the resubmitted action like any other.
 */
export function canResubmitStaleAction(
  base: GameSnapshot,
  latest: GameSnapshot,
  action: PlayerAction,
): boolean {
  if (base.id !== latest.id) return false;

  if (action.type === "rebuy") {
    // The server refuses a rebuy on a seat that has chips, so a stack still
    // at zero means the first one never landed.
    const seat = latest.seats.find((candidate) => candidate.isMine);
    return !latest.tournament
      && seat !== undefined
      && seat.stack === 0
      && isSeatRebuyEligible(latest.status, seat.status);
  }

  const before = base.legalActions;
  const now = latest.legalActions;
  if (!before || !now) return false;
  const sameTurn = base.handNumber === latest.handNumber
    && base.street === latest.street
    && base.turnStartedAt !== null
    && base.turnStartedAt === latest.turnStartedAt;
  if (!sameTurn) return false;

  switch (action.type) {
    case "fold":
      return now.canFold;
    case "check":
      return now.canCheck;
    case "call":
      return now.canCall && now.callAmount === before.callAmount;
    case "raise":
      return now.canRaise && action.amount >= now.minRaiseTo && action.amount <= now.maxRaiseTo;
    case "all-in":
      return now.canAllIn && now.maxRaiseTo === before.maxRaiseTo;
    default:
      return false;
  }
}
