import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { toArcadeErrorResponse } from "@/lib/server/arcade-request";
import { readFarmShowcase } from "@/lib/server/farm-showcase-visits";

export const runtime = "nodejs";

const paramsSchema = z.object({ profileId: z.string().uuid() });

/**
 * Somebody else's farm, read-only.
 *
 * NOT A CHEAPER READ THAN THE OWNER'S. It runs the same `view()` their own
 * farm screen does and then throws most of it away
 * (lib/server/stackacres-showcase-service.ts's `project`), so the limit here
 * is sized like the owner's own: a visitor opens a farm, looks, and leaves.
 * It is not on a poll.
 *
 * Every refusal is the same 404, whatever the reason -- see the service's
 * header. A route that answered differently for "private", "not your friend"
 * and "no such profile" would tell anyone holding a profile id whether that
 * player farms and whether they have been blocked.
 *
 * The farm's clock is read at real `now`, not through `resolveChronoNow`:
 * the time on the farm belongs to its owner, not to whoever is looking at it.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ profileId: string }> },
) {
  const limited = await enforceRateLimit(request, "stackacres:showcase:visit", 60, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return NextResponse.json({ error: "That farm isn't open to visitors." }, { status: 404 });
    }
    return NextResponse.json(await readFarmShowcase(token, parsed.data.profileId, new Date()));
  } catch (error) {
    return toArcadeErrorResponse(error, "Could not load that farm.");
  }
}
