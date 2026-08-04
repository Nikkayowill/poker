import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { respondToFriendRequest } from "@/lib/server/friends-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ action: z.enum(["accept", "decline", "cancel"]) });

/**
 * Settles a pending friend request.
 *
 * The store enforces direction -- only the addressee may accept or decline,
 * only the requester may cancel -- and answers `not_found` for anything else,
 * including a request that exists but belongs to someone else. This route
 * passes that through as a 404 rather than a 403 for the same reason
 * app/api/history/[gameId]/[hand]/route.ts does: whether a given id exists is
 * not the caller's to learn.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "friends:respond", 30, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(request, "Create an account to add friends.");
    if (auth.response) return auth.response;

    const parsedParams = paramsSchema.safeParse(await context.params);
    const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsedParams.success || !parsedBody.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const result = await respondToFriendRequest(
      auth.profile.id,
      parsedParams.data.id,
      parsedBody.data.action,
    );
    if (result.status === "not_found") {
      return NextResponse.json({ error: "That request is no longer open." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
