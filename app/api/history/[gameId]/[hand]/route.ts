import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getArchivedHand } from "@/lib/server/hand-archive-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

const paramsSchema = z.object({
  gameId: z.string().uuid(),
  hand: z.coerce.number().int().positive(),
});

/**
 * One archived hand, redacted for the caller.
 *
 * The store decides both whether the caller was in this hand and which hole
 * cards they may see; this route only resolves who is asking. A hand the
 * caller did not play returns 404 rather than 403 -- the existence of
 * somebody else's hand is not the caller's to learn.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string; hand: string }> },
) {
  const limited = enforceRateLimit(request, "history:read", 120, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) {
      return NextResponse.json({ error: "Sign in to review your hand history." }, { status: 401 });
    }

    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Hand not found." }, { status: 404 });
    }

    const profile = await ensureProfile(token);
    if (!profile.isRegistered) {
      return NextResponse.json(
        { error: "Create an account to keep and review your hand history." },
        { status: 403 },
      );
    }

    const hand = await getArchivedHand(profile.id, parsed.data.gameId, parsed.data.hand);
    if (!hand) return NextResponse.json({ error: "Hand not found." }, { status: 404 });

    return NextResponse.json({ hand });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load that hand.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
