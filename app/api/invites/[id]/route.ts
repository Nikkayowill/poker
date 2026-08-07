import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { claimSeat, toSnapshot } from "@/lib/game/engine";
import { clampBuyIn, TIER_CONFIG } from "@/lib/game/tiers";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { getStoredGame, persistenceMode, persistSeatClaim } from "@/lib/server/game-store";
import { creditGold, spendGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { findPendingTableInvite, respondToTableInvite } from "@/lib/server/table-invite-store";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  action: z.enum(["accept", "decline"]),
  buyIn: z.number().int().positive().optional(),
});

const GUEST_MESSAGE = "Create an account to get table invites.";

/**
 * Settles an invite, and -- on accept -- redeems it into a seat.
 *
 * Accepting is a join, not an acknowledgement: the room code never leaves the
 * server, so there is no second request the client could make with it. That is
 * the whole reason the code travels in the row rather than in the payload (see
 * the column comment in 20260804120000_friends_and_table_invites.sql), and it
 * is why this route repeats app/api/games/join/route.ts' buy-in dance instead
 * of handing anything back for the client to finish.
 *
 * Ordering, which is the part worth getting right:
 *
 *  1. Pre-flight the things a player can plainly see and fix -- the table is
 *     gone, it is full, they cannot afford the buy-in -- *before* the invite is
 *     consumed. Burning a one-shot invite to say "you need more Gold" would
 *     make the fixable case unrecoverable without the inviter re-sending.
 *  2. Consume the invite. `respondToTableInvite`'s status-guarded write is what
 *     makes a double-tapped Accept seat once and buy in once; the pre-flight
 *     above is not a guard and is not treated as one.
 *  3. Debit, then seat, refunding if the claim throws -- the same order and the
 *     same refund join/route.ts uses. Between 2 and 3 a genuine race can still
 *     take the last seat; that spends the invite, which is the honest cost of
 *     never letting one be redeemed twice.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "invites:respond", 30, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;
    // Non-null: requireRegisteredProfile 401s without one.
    const token = readSessionToken(request)!;

    const parsedParams = paramsSchema.safeParse(await context.params);
    const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsedParams.success || !parsedBody.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    if (parsedBody.data.action === "decline") {
      const declined = await respondToTableInvite(auth.profile.id, parsedParams.data.id, "decline");
      if (declined.status === "not_found") {
        return NextResponse.json({ error: "That invite is no longer open." }, { status: 404 });
      }
      return NextResponse.json(declined);
    }

    // ---- 1. pre-flight ------------------------------------------------------
    //
    // Peeking at the invite costs a read the accept below repeats, and buys the
    // player a failure they can act on. It is deliberately not a guard: every
    // one of these is re-decided under the status predicate a moment later.
    const pending = await findPendingTableInvite(auth.profile.id, parsedParams.data.id);
    if (!pending) {
      return NextResponse.json({ error: "That invite is no longer open." }, { status: 404 });
    }
    const preview = await getStoredGame(pending.gameId);
    if (!preview || preview.status !== "playing") {
      return NextResponse.json({ error: "That table has finished." }, { status: 410 });
    }
    const alreadySeated = preview.seats.some((seat) => seat.ownerToken === token);
    if (!alreadySeated && !preview.seats.some((seat) => seat.ownerToken === null)) {
      return NextResponse.json({ error: "That table filled up." }, { status: 409 });
    }

    const config = TIER_CONFIG[preview.tier];
    const buyIn = clampBuyIn(preview.tier, parsedBody.data.buyIn ?? config.minBuyIn);
    // Re-seating an existing seat costs nothing, so only a genuine sit-down is
    // gated on the balance.
    if (!alreadySeated && !auth.profile.unlimitedGold && auth.profile.goldBalance < config.minBuyIn) {
      return NextResponse.json(
        { error: `You need at least ${config.minBuyIn.toLocaleString()} Gold to join this table.` },
        { status: 400 },
      );
    }

    // ---- 2. consume ---------------------------------------------------------
    const accepted = await respondToTableInvite(auth.profile.id, parsedParams.data.id, "accept");
    if (accepted.status !== "accepted") {
      return NextResponse.json({ error: "That invite is no longer open." }, { status: 404 });
    }

    // Re-read rather than reusing the pre-flight copy: the pre-flight happened
    // before the invite was consumed, and claimSeat writes into the state it is
    // given. Seating against a stale snapshot is how two players end up
    // believing they hold the same chair.
    const game = await getStoredGame(accepted.gameId);
    if (!game || game.status !== "playing") {
      return NextResponse.json({ error: "That table has finished." }, { status: 410 });
    }

    // ---- 3. debit, seat, refund on failure ---------------------------------
    let profile = auth.profile;
    if (!alreadySeated) profile = await spendGold(token, buyIn);

    let state;
    let seatIndex;
    try {
      const beforeVersion = game.version;
      ({ state, seatIndex } = claimSeat(game, token, profile, buyIn));
      if (state.version !== beforeVersion) {
        await persistSeatClaim(state, state.seats[seatIndex].id);
      }
    } catch (claimError) {
      if (!alreadySeated) profile = await creditGold(token, buyIn).catch(() => profile);
      const message = claimError instanceof Error ? claimError.message : "Could not take that seat.";
      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json({
      status: "accepted",
      game: toSnapshot(state, token),
      persistence: persistenceMode(),
      profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not answer that invite.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
