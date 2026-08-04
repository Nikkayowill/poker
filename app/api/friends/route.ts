import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { getFriendsOverview, removeFriend } from "@/lib/server/friends-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const GUEST_MESSAGE = "Create an account to add friends.";

const targetSchema = z.object({ profileId: z.string().uuid() });

/**
 * The caller's friends and both directions of their pending requests.
 *
 * One payload rather than three: the drawer opens on all of it at once, and
 * separate fetches would let it show a friend and their still-pending request
 * to you in the same frame.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:read", 120, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    return NextResponse.json(await getFriendsOverview(auth.profile.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your friends.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Ends a friendship.
 *
 * The target rides in the query string rather than a body because a DELETE
 * with a body is inconsistently handled by proxies and fetch wrappers; the id
 * is a uuid, so there is nothing here worth hiding from a URL.
 */
export async function DELETE(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:mutate", 30, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    const parsed = targetSchema.safeParse({
      profileId: request.nextUrl.searchParams.get("profileId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid player." }, { status: 400 });
    }

    // `removed: false` means they were not friends -- reported rather than
    // raised, because the drawer's own refetch can lose that race with the
    // other party unfriending first, and that is not an error worth showing.
    const removed = await removeFriend(auth.profile.id, parsed.data.profileId);
    return NextResponse.json({ removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove that friend.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
