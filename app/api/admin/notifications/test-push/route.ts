import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminAuthorized } from "@/lib/server/admin-auth";
import { pushSubscriptionsForProfile } from "@/lib/server/push-subscription-store";
import { sendPushToProfile } from "@/lib/server/push-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({ profileId: z.string().uuid() });

/**
 * Fires one push straight at a profile's subscribed devices -- no
 * notifications-store row, no kind, nothing persisted. Purely "does push
 * delivery work for this profile," which is why this lives under admin
 * rather than the player-facing /api/notifications routes: it's a delivery
 * check, not a real event a player caused.
 *
 * Reports how many devices it was sent to (0 is not an error -- a profile
 * with no subscription is a valid, common answer, and the admin dashboard
 * needs to be able to tell that apart from "it silently did nothing").
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:notifications:test-push", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId." }, { status: 400 });
    }

    const subscriptions = await pushSubscriptionsForProfile(parsed.data.profileId);
    await sendPushToProfile(parsed.data.profileId, {
      title: "StackChips",
      body: "Test notification -- if you can see this, push is working.",
      url: "/",
    });

    return NextResponse.json({ sentTo: subscriptions.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send that test push.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
