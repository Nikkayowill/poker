import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { getStoredGame } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { createTableInvite } from "@/lib/server/table-invite-store";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  gameId: z.string().uuid(),
});

const GUEST_MESSAGE = "Create an account to invite players to your table.";

/**
 * Invites someone to the private table the caller is sitting at.
 *
 * Rate-limited like /api/friends/requests and for the same reason: the store
 * looks the invitee up before it will write, so an unlimited caller could walk
 * the uuid space to learn which profile ids are real. Nobody invites ten
 * people a minute.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "invites:send", 10, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid invite." }, { status: 400 });
    }

    // The check the store deliberately does not make -- see createTableInvite's
    // own comment. Everything else about the table is the store's to verify;
    // whether this player has any business inviting anyone to it is decided
    // here, by the one fact only the request carries: the session token that
    // owns a seat. `ownerToken` never leaves the server, so this cannot be
    // spoofed by a client that merely knows a game id.
    //
    // Seated, not merely present: a spectator who guessed a game id would
    // otherwise be able to hand out seats at somebody else's private room.
    const token = readSessionToken(request);
    const game = token ? await getStoredGame(parsed.data.gameId) : null;
    if (!game || !game.seats.some((seat) => seat.ownerToken === token)) {
      return NextResponse.json(
        { error: "Sit down at the table before inviting anyone to it." },
        { status: 403 },
      );
    }

    const result = await createTableInvite(auth.profile.id, parsed.data.profileId, parsed.data.gameId);

    // As in /api/friends/requests: the outcomes a player can actually reach by
    // tapping Invite are 200s carrying a status the drawer renders, not error
    // codes. `blocked` stays undifferentiated on purpose -- naming who blocked
    // whom hands back exactly what a block withholds.
    if (result.status === "unknown_profile") {
      return NextResponse.json({ error: "That player no longer exists." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send that invite.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
