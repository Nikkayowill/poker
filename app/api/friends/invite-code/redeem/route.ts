import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { redeemFriendInviteCode } from "@/lib/server/friends-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({ code: z.string().trim().min(1).max(32) });

/**
 * Turns someone else's invite code into a friendship.
 *
 * Rate-limited as tightly as sending a friend request by profile id: this
 * route also has to resolve an id it was only handed a code for, and an
 * unlimited caller could grind through the code space to find live ones.
 * 10/minute is worthless to an attacker and unnoticed by a real player, who
 * redeems at most one code in a sitting.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:invite-code:redeem", 10, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, "Create an account to add friends.");
    if (auth.response) return auth.response;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter an invite code." }, { status: 400 });
    }

    const result = await redeemFriendInviteCode(auth.profile.id, parsed.data.code);

    // Every ordinary outcome is a 200 the client switches on, same posture
    // as POST /api/friends/requests -- `blocked` stays undirected there for
    // the same reason it does here: naming who blocked whom undoes it.
    if (result.status === "invalid_code") {
      return NextResponse.json({ error: "That invite code isn't valid." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add that friend.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
