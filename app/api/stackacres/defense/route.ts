import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ZONE_IDS } from "@/lib/stackacres/zones";
import { toArcadeErrorResponse } from "@/lib/server/arcade-request";
import { getStackAcresFenceSegment, upgradeStackAcresFenceSegment } from "@/lib/server/stackacres-defense-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { readSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Wildlife Ecosystem & Nighttime Predator Defense: the one player-initiated
 * write this feature ships, kept in its own route rather than folded into
 * `/api/stackacres/actions` -- that dispatcher's `run()` is typed to always
 * return a `StackAcresView`, and a fence segment is a genuinely different
 * shape with no reason to be squeezed into that snapshot. Same access/ban/
 * rate-limit gate as the main route, restated here rather than shared,
 * matching this codebase's existing posture of a feature-specific route
 * over a shared one when the response shape does not match (see
 * app/api/stackacres/route.ts vs. app/api/stackacres/actions/route.ts
 * already being two files for the same reason: a GET snapshot and a POST
 * action dispatcher answer differently-shaped questions).
 */

const bodySchema = z.object({
  action: z.literal("upgrade-fence"),
  zone: z.enum(ZONE_IDS as unknown as [string, ...string[]]),
  segmentIndex: z.number().int().min(0).max(999),
  /** The version last read for this bay -- 0 for a bay nobody has ever
   *  upgraded, matching the store's own default. */
  version: z.number().int().min(0),
});

/** Reads one fence bay's current tier/durability/version -- what the
 *  fence-upgrade popup opens with, fetched at tap time rather than
 *  hydrated ahead of time, since only the one bay actually tapped is ever
 *  needed. A read, so no ban gate: an ordinary GET, same posture the main
 *  `/api/stackacres` snapshot route already takes. */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "stackacres:defense-read", 60, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  const url = new URL(request.url);
  const zone = url.searchParams.get("zone") ?? "";
  const segmentIndexRaw = url.searchParams.get("segmentIndex") ?? "";
  const segmentIndex = Number(segmentIndexRaw);
  if (!(ZONE_IDS as readonly string[]).includes(zone) || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return withRequestSessionCookie(request, NextResponse.json({ error: "Send a valid segment." }, { status: 400 }), token);
  }

  try {
    const segment = await getStackAcresFenceSegment(token, zone, segmentIndex);
    return withRequestSessionCookie(request, NextResponse.json({ segment }), token);
  } catch (error) {
    return withRequestSessionCookie(request, toArcadeErrorResponse(error, "Could not read that fence."), token);
  }
}

export async function POST(request: NextRequest) {
  // One upgrade per bay is a rare, deliberate tap, not a repeated action --
  // 20/min is generous headroom over any real play pattern.
  const limited = enforceRateLimit(request, "stackacres:defense", 20, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a valid action." }, { status: 400 }),
        token,
      );
    }

    if (await isBanned(token)) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const { zone, segmentIndex, version } = parsed.data;
    const segment = await upgradeStackAcresFenceSegment(token, zone, segmentIndex, version);
    return withRequestSessionCookie(request, NextResponse.json({ segment }), token);
  } catch (error) {
    return withRequestSessionCookie(request, toArcadeErrorResponse(error, "Could not upgrade that fence."), token);
  }
}
