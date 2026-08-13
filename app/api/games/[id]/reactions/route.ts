import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadGameWithTimeouts } from "@/lib/server/game-store";
import { isBanned } from "@/lib/server/profile-store";
import { checkRateLimit, enforceRateLimit, rateLimited } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { adminClient } from "@/lib/server/supabase-admin";
import {
  PLAYER_REACTION,
  REACTION_COOLDOWN_MS,
  isReactionId,
  reactionChannelName,
} from "@/lib/game/reaction-channel";

export const runtime = "nodejs";

const bodySchema = z.object({ reactionId: z.string() });
const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Sends a cosmetic table reaction. No engine call, no expectedVersion, no
 * game_signals row -- this only checks that the sender is actually seated,
 * then relays the emoji to everyone else over its own broadcast channel
 * (see lib/game/reaction-channel.ts for why it's a separate topic from the
 * game-state one). A dropped send never desyncs a hand; worst case, nobody
 * sees the bubble.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // Usual per-IP abuse backstop. The cooldown the feature actually needs is
  // enforced per seat below.
  const limited = enforceRateLimit(request, "games:reaction", 40, 10 * 1000);
  if (limited) return limited;

  const ownerToken = readSessionToken(request);
  if (!ownerToken) return NextResponse.json({ error: "Your table session expired." }, { status: 401 });
  if (await isBanned(ownerToken)) {
    return NextResponse.json({ error: "Your account has been suspended." }, { status: 403 });
  }

  const paramsParsed = paramsSchema.safeParse(await context.params);
  if (!paramsParsed.success) return NextResponse.json({ error: "Table not found." }, { status: 404 });
  const { id } = paramsParsed.data;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid reaction." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success || !isReactionId(parsed.data.reactionId)) {
    return NextResponse.json({ error: "Invalid reaction." }, { status: 400 });
  }
  const reactionId = parsed.data.reactionId;

  const game = await loadGameWithTimeouts(id);
  if (!game) return NextResponse.json({ error: "Table not found." }, { status: 404 });
  const seat = game.seats.find((candidate) => candidate.ownerToken === ownerToken);
  if (!seat) return NextResponse.json({ error: "You are not seated at this table." }, { status: 403 });

  // The real "one reaction, briefly" cooldown, keyed on the seat rather than
  // the caller so it survives a device swap and can't be dodged with a
  // second tab.
  const seatLimit = checkRateLimit(`reaction:${id}:${seat.id}`, 1, REACTION_COOLDOWN_MS);
  if (!seatLimit.ok) return rateLimited(seatLimit.retryAfterSeconds);

  // Best-effort: nobody's hand depends on this landing. A missing admin
  // client (memory-mode dev, no Supabase env) or a Realtime hiccup just
  // means only the sender's own bubble shows up -- not worth surfacing as
  // an error for something purely cosmetic.
  const client = adminClient();
  if (client) {
    try {
      await client.channel(reactionChannelName(id)).httpSend(PLAYER_REACTION, {
        seatId: seat.id,
        reactionId,
        sentAt: Date.now(),
      });
    } catch (error) {
      console.error("Could not broadcast table reaction", error);
    }
  }

  return NextResponse.json({ ok: true });
}
