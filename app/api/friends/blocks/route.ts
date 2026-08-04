import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { blockProfile, unblockProfile } from "@/lib/server/friends-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const GUEST_MESSAGE = "Create an account to manage blocked players.";

const bodySchema = z.object({ profileId: z.string().uuid() });

/**
 * Blocks a player.
 *
 * More than an insert: the store also drops any friendship and cancels live
 * requests in both directions. Unlike a friend request this does not verify
 * the target exists first -- blocking is one-sided and needs no consent, and
 * a lookup here would hand back exactly the enumeration oracle the request
 * route is rate-limited to deny.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:block", 30, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid player." }, { status: 400 });
    }

    const blocked = await blockProfile(auth.profile.id, parsed.data.profileId);
    if (!blocked) {
      return NextResponse.json({ error: "You cannot block yourself." }, { status: 400 });
    }
    return NextResponse.json({ blocked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not block that player.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Lifts a block. Does not restore the friendship it tore down. */
export async function DELETE(request: NextRequest) {
  const limited = enforceRateLimit(request, "friends:block", 30, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, GUEST_MESSAGE);
    if (auth.response) return auth.response;

    const parsed = bodySchema.safeParse({
      profileId: request.nextUrl.searchParams.get("profileId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid player." }, { status: 400 });
    }

    return NextResponse.json({ unblocked: await unblockProfile(auth.profile.id, parsed.data.profileId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not unblock that player.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
