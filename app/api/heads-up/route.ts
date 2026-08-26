import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STAKES_TIERS } from "@/lib/game/tiers";
import {
  openHeadsUpInvite,
  openHeadsUpQuickPlay,
  readMyHeadsUpTable,
  readPendingHeadsUpInviteFor,
  toHeadsUpErrorResponse,
} from "@/lib/server/heads-up-service";
import { ensureProfile, isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The heads-up lobby.
 *
 * GET answers "where do I stand": the caller's own live match if there is
 * one (waiting or already dealt), and any pending invites addressed to them
 * -- no browsable open-table list, unlike cribbage's lobby, since a heads-up
 * seeker either quick-plays into the matchmaking queue or acts on a specific
 * invite, never picks a table off a list.
 *
 * POST opens a match, discriminated on `action`:
 *   - "quick-play": join the oldest open table at this tier, or start one.
 *   - "invite": open a table reserved for a specific friend.
 * Both DEBIT the caller and seat them -- see lib/server/heads-up-service.ts.
 */

const quickPlaySchema = z.object({
  action: z.literal("quick-play"),
  tier: z.enum(STAKES_TIERS),
});
const inviteSchema = z.object({
  action: z.literal("invite"),
  tier: z.enum(STAKES_TIERS),
  friendProfileId: z.string().uuid(),
});
const bodySchema = z.discriminatedUnion("action", [quickPlaySchema, inviteSchema]);

export async function GET(request: NextRequest) {
  const token = readOrCreateSessionToken(request);
  try {
    const mine = await readMyHeadsUpTable(token);
    const invites = mine.table ? [] : await readPendingHeadsUpInviteFor((await ensureProfile(token)).id);
    return withRequestSessionCookie(
      request,
      NextResponse.json({ table: mine.table, invites, profile: mine.profile }),
      token,
    );
  } catch (error) {
    return withRequestSessionCookie(request, toHeadsUpErrorResponse(error), token);
  }
}

export async function POST(request: NextRequest) {
  // Every accepted call here escrows Gold, same posture as cribbage:open.
  const limited = enforceRateLimit(request, "heads-up:open", 30, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Choose a stakes tier to play heads-up." }, { status: 400 }),
        token,
      );
    }

    const result = parsed.data.action === "quick-play"
      ? await openHeadsUpQuickPlay(token, parsed.data.tier)
      : await openHeadsUpInvite(token, parsed.data.tier, parsed.data.friendProfileId);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toHeadsUpErrorResponse(error), token);
  }
}
