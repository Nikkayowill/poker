import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { sendFriendRequest } from "@/lib/server/friends-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({ profileId: z.string().uuid() });

/**
 * Asks someone to be friends.
 *
 * Rate-limited far harder than the read routes, and that is the point: the
 * store has to look the target up to answer at all, so an unlimited caller
 * could walk the uuid space and learn which profile ids are real. 10/minute
 * makes that worthless without ever getting in a real player's way -- nobody
 * adds ten friends a minute.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:request", 10, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, "Create an account to add friends.");
    if (auth.response) return auth.response;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid player." }, { status: 400 });
    }

    const result = await sendFriendRequest(auth.profile.id, parsed.data.profileId);

    // Every one of these is a state the drawer draws, so they are 200s with a
    // status the client switches on -- not error codes. The single exception
    // is `unknown_profile`, which is a genuinely bad request.
    //
    // `blocked` deliberately does not distinguish who blocked whom: telling a
    // requester "they blocked you" hands them information the block exists to
    // withhold.
    if (result.status === "unknown_profile") {
      return NextResponse.json({ error: "That player no longer exists." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send that friend request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
