import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { toArcadeErrorResponse } from "@/lib/server/arcade-request";
import { reactToFarmShowcase } from "@/lib/server/farm-showcase-visits";
import { isShowcaseReaction } from "@/lib/stackacres/showcase";

export const runtime = "nodejs";

const paramsSchema = z.object({ profileId: z.string().uuid() });
// The kind is narrowed by `isShowcaseReaction` below rather than by a
// z.enum: the guard is the one place the three ids are spelled out, and
// z.enum would need a second, mutable copy of that list to build itself from.
const bodySchema = z.object({ reaction: z.string() });

/**
 * Leaves one compliment on a farm.
 *
 * Passes through the same standing check the snapshot read does, so a
 * hand-rolled POST cannot reach a farm its sender was never shown. It moves
 * no Gold, changes nothing about the farm, and notifies nobody -- it adds one
 * row the owner sees next time they open their own setting.
 *
 * Limited to 20 a minute. There are only three reactions and each lands once
 * per farm forever, so a real visitor spends three of these; the rest of the
 * bucket is there so a bot grinding profile ids runs out of room rather than
 * finding out which ids exist.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ profileId: string }> },
) {
  const limited = await enforceRateLimit(request, "stackacres:showcase:react", 20, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "That farm isn't open to visitors." }, { status: 404 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !isShowcaseReaction(parsed.data.reaction)) {
      return NextResponse.json({ error: "Pick a reaction." }, { status: 400 });
    }
    const reaction = parsed.data.reaction;
    return NextResponse.json(await reactToFarmShowcase(token, parsedParams.data.profileId, reaction));
  } catch (error) {
    return toArcadeErrorResponse(error, "Could not leave that reaction.");
  }
}
