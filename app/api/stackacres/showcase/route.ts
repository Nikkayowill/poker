import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { toArcadeErrorResponse } from "@/lib/server/arcade-request";
import { readShowcaseSettings, setShowcaseVisibility } from "@/lib/server/stackacres-showcase-service";
import { FARM_VISIBILITIES } from "@/lib/stackacres/showcase";

export const runtime = "nodejs";

/**
 * The owner's own Visitor Mode setting, and the compliments left on their
 * farm so far.
 *
 * Same two gates, in the same order, as GET /api/stackacres: the limiter
 * first, because the access check costs a database read and putting it in
 * front would hand an unauthenticated flood a query amplifier; then the
 * access check, because the farm is on the floor but not open.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "stackacres:showcase:read", 60, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  try {
    return NextResponse.json(await readShowcaseSettings(token));
  } catch (error) {
    return toArcadeErrorResponse(error, "Could not load your farm's visitor setting.");
  }
}

const bodySchema = z.object({ visibility: z.enum(FARM_VISIBILITIES) });

/** Changes who may look. Tighter limit than the read: nobody flips this more
 *  than once or twice in a sitting. */
export async function PUT(request: NextRequest) {
  const limited = await enforceRateLimit(request, "stackacres:showcase:set", 20, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Pick who may visit your farm." }, { status: 400 });
    }
    return NextResponse.json(await setShowcaseVisibility(token, parsed.data.visibility));
  } catch (error) {
    return toArcadeErrorResponse(error, "Could not save your farm's visitor setting.");
  }
}
