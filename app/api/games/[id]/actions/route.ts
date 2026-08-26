import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyPlayerAction, toSnapshot } from "@/lib/game/engine";
import { isSeatRebuyEligible } from "@/lib/game/rebuy";
import { clampBuyIn } from "@/lib/game/tiers";
import { loadGameWithTimeouts, logTurn, persistenceMode, updateStoredGame } from "@/lib/server/game-store";
import { creditGold, isBanned, spendGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { onHandCompleted } from "@/lib/server/hand-completion";
import { settleSitAndGoIfFinished } from "@/lib/server/sit-and-go-service";
import { settleHeadsUpIfFinished } from "@/lib/server/heads-up-service";
import { readSessionToken } from "@/lib/server/session";
import type { PlayerProfile } from "@/lib/profile/types";

export const runtime = "nodejs";

/**
 * The action itself, plus the version of the state the player was looking at
 * when they chose it. `expectedVersion` is optional so an older client keeps
 * working, but when it is sent a stale duplicate is rejected before it can be
 * applied a second time.
 */
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold") }),
  z.object({ type: z.literal("check") }),
  z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("raise"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("all-in") }),
  z.object({ type: z.literal("next-hand") }),
  z.object({ type: z.literal("leave-seat") }),
  z.object({ type: z.literal("rebuy"), amount: z.number().int().positive() }),
]);

const bodySchema = z.object({
  action: actionSchema,
  expectedVersion: z.number().int().nonnegative().optional(),
});

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "games:action", 40, 10 * 1000);
  if (limited) return limited;
  try {
    const ownerToken = readSessionToken(request);
    if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
    if (await isBanned(ownerToken)) {
      return NextResponse.json({ error: "Your account has been suspended." }, { status: 403 });
    }
    const raw = await request.json();
    // Accepts either shape: {type: "call"} from an older client, or
    // {action: {...}, expectedVersion: n} from this one.
    const parsed = bodySchema.safeParse(
      raw && typeof raw === "object" && "action" in raw ? raw : { action: raw },
    );
    if (!parsed.success) return NextResponse.json({ error: "Invalid poker action." }, { status: 400 });
    const paramsParsed = paramsSchema.safeParse(await context.params);
    if (!paramsParsed.success) return NextResponse.json({ error: "Table not found." }, { status: 404 });
    const { id } = paramsParsed.data;
    const game = await loadGameWithTimeouts(id);
    if (!game) return NextResponse.json({ error: "Table not found." }, { status: 404 });

    // Optimistic concurrency. A retried or double-submitted action arrives
    // carrying the version its player was looking at; if the table has moved
    // on, applying it again would be a second bet nobody asked for. Answering
    // 409 with the current state is a no-op the client can simply adopt.
    const { expectedVersion } = parsed.data;
    if (typeof expectedVersion === "number" && expectedVersion !== game.version) {
      return NextResponse.json(
        {
          error: "That action was already applied.",
          stale: true,
          game: toSnapshot(game, ownerToken),
          persistence: persistenceMode(),
        },
        { status: 409 },
      );
    }

    let action = parsed.data.action;
    let goldSpent = 0;
    let profile: PlayerProfile | undefined;

    // Chips a departing player still has in front of them convert back to
    // Gold. Read before applying, because vacateSeat clears the seat as part
    // of handing it to a bot. Never for a tournament seat (Sit & Go or
    // heads-up): leaving there is a forfeit, not a cash-out -- the whole
    // escrowed pot goes to whoever's left through settleSitAndGoIfFinished/
    // settleHeadsUpIfFinished below, and crediting the leaver's live stack
    // here on top of that would pay out more Gold than was ever staked.
    // forfeitTournamentSeat (engine.ts) is what applyPlayerAction actually
    // calls for a tournament leave-seat, and it credits nothing itself.
    const cashOutAmount = action.type === "leave-seat" && !game.tournament
      ? game.seats.find((seat) => seat.ownerToken === ownerToken)?.stack ?? 0
      : 0;

    if (action.type === "rebuy") {
      if (game.tournament) {
        return NextResponse.json(
          {
            error: game.tournament.format === "heads_up"
              ? "There are no rebuys in a heads-up match."
              : "This is a Sit & Go -- there's no rebuy.",
          },
          { status: 409 },
        );
      }
      const seat = game.seats.find((candidate) => candidate.ownerToken === ownerToken);
      if (!seat) return NextResponse.json({ error: "You are not seated at this table." }, { status: 403 });
      if (seat.stack > 0) {
        return NextResponse.json({ error: "Your seat still has chips." }, { status: 409 });
      }
      // Same predicate applyPlayerAction enforces (lib/game/rebuy.ts) --
      // rebuy is allowed any time this seat itself isn't currently live in
      // a hand in progress, not just between hands (see the bust-grace-
      // period removal in engine.ts). action-bar.tsx checks this too before
      // it even shows the button, so reaching this rejection from the real
      // UI should no longer happen -- see that file's comment.
      if (!isSeatRebuyEligible(game.status, seat.status)) {
        return NextResponse.json({ error: "Wait for this hand to finish deciding your seat." }, { status: 409 });
      }
      const clamped = clampBuyIn(game.tier, action.amount);
      profile = await spendGold(ownerToken, clamped);
      goldSpent = clamped;
      action = { type: "rebuy", amount: clamped };
    }

    try {
      const wasComplete = game.status === "complete";
      const wasAlreadyFinished = Boolean(game.tournament?.winnerProfileId);
      const updated = applyPlayerAction(game, action, ownerToken);
      logTurn(updated, "player action applied", { action: action.type, expectedVersion });
      await updateStoredGame(updated, action, ownerToken);
      // Only after the departure is durably persisted -- crediting first
      // would pay out a player whose seat never actually got released.
      if (cashOutAmount > 0) {
        profile = await creditGold(ownerToken, cashOutAmount).catch(() => profile);
      }
      // Awaited, not fired-and-forgotten: this credits real Gold, and a
      // serverless invocation is not guaranteed to keep running an
      // un-awaited promise after the response is sent -- unlike
      // onHandCompleted just below (pure stats, genuinely fine to lose).
      // Neither settle function ever throws, so this cannot turn an
      // ordinary poker action response into an error either way.
      // wasAlreadyFinished skips the guarded-write attempt entirely once a
      // table is already settled, rather than repeating it on every poll.
      // No-ops for free on any cash table (format-dispatched, since a Sit &
      // Go's game_id will never match a heads-up table lookup or vice versa,
      // but there's no reason to pay for the wrong store's lookup either).
      if (updated.tournament?.winnerProfileId && !wasAlreadyFinished) {
        if (updated.tournament.format === "sit_and_go") {
          await settleSitAndGoIfFinished(updated).catch((error) => {
            console.error("sit_and_go.settle_failed", { gameId: updated.id, error });
          });
        } else {
          await settleHeadsUpIfFinished(updated).catch((error) => {
            console.error("heads_up.settle_failed", { gameId: updated.id, error });
          });
        }
      }
      // A human action just closed the hand (e.g. the last call that ends
      // the river). Recording is idempotent and best-effort -- a stats write
      // failing here must never turn a completed poker action into an error.
      if (!wasComplete && updated.status === "complete") {
        void onHandCompleted(updated).catch((error) => {
          console.error("Could not record hand stats", error);
        });
      }
      return NextResponse.json({
        game: toSnapshot(updated, ownerToken),
        persistence: persistenceMode(),
        ...(cashOutAmount > 0 ? { cashedOut: cashOutAmount } : {}),
        ...(profile ? { profile } : {}),
      });
    } catch (applyError) {
      // The rebuy's Gold was already spent; a failure applying or persisting
      // the state transition means the player got nothing for it, so make
      // them whole rather than leaving a silent, unrecoverable loss.
      if (goldSpent > 0) {
        profile = await creditGold(ownerToken, goldSpent).catch(() => profile);
      }
      throw applyError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "That action could not be completed.";
    const status = message.includes("not seated") ? 403 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
