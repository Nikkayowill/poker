import "server-only";
import type { GameState } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { settleHeadsUpIfFinished } from "./heads-up-service";
import { settleSitAndGoIfFinished } from "./sit-and-go-service";

/**
 * Settles a decided tournament game (Sit & Go or heads-up), for any route
 * that loads a game through loadGameWithTimeouts. The timed advance inside
 * that load can itself be the step that names the winner, so a route must
 * not decide "already settled" from the state it got back. This asks the
 * escrow table instead: both settle functions check its status and version,
 * so calling this on every request for a finished game is safe and only
 * ever pays once.
 *
 * Returns the winner's just-credited profile only when `requesterToken`
 * belongs to the winner, so a route never swaps its caller's balance for
 * someone else's. Never throws.
 */
export async function settleTournamentIfDecided(
  state: GameState,
  requesterToken: string,
): Promise<PlayerProfile | null> {
  const winnerId = state.tournament?.winnerProfileId;
  if (!winnerId) return null;

  const settle = state.tournament?.format === "sit_and_go" ? settleSitAndGoIfFinished : settleHeadsUpIfFinished;
  const settledProfile = await settle(state).catch((error: unknown) => {
    console.error("tournament.settle_failed", { gameId: state.id, format: state.tournament?.format, error });
    return null;
  });

  const requesterProfileId = state.seats.find((seat) => seat.ownerToken === requesterToken)?.profileId;
  return settledProfile && requesterProfileId === winnerId ? settledProfile : null;
}
