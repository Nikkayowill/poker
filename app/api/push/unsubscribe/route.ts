import { NextRequest, NextResponse } from "next/server";
import { removePushSubscription } from "@/lib/server/push-subscription-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Drops one device's subscription -- the player-menu notification toggle's
 * server half (lib/push/client.ts's disablePushOnThisDevice).
 *
 * Deletes by endpoint alone, not scoped to the caller's profile_id: the
 * endpoint is unique to the device that unsubscribed, so there's nothing to
 * check ownership against, and requiring a session here would break the
 * service worker's own pushsubscriptionchange path if it ever needs to
 * clean up a stale endpoint outside a normal page load.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "push:unsubscribe", 20, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });

    const body = await request.json().catch(() => null);
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
    if (!endpoint) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });

    await removePushSubscription(endpoint);
    return NextResponse.json({ unsubscribed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove your subscription.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
