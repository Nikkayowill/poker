import { NextRequest, NextResponse } from "next/server";
import { ensureProfile } from "@/lib/server/profile-store";
import { savePushSubscription } from "@/lib/server/push-subscription-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Saves (or refreshes) a device's Web Push subscription against the calling
 * profile. Called by lib/push/client.ts right after the browser grants
 * notification permission, and again by public/sw.js's
 * pushsubscriptionchange handler when the push service rotates an endpoint.
 *
 * Guest profiles are accepted, not rejected -- the sign-up prompt this is
 * wired to (see AccountEntryCard) runs before a fresh guest necessarily has
 * an account, and there's nothing unsafe about holding a subscription for
 * one; the cron sender's own query only ever selects registered profiles,
 * so a guest's subscription just sits unused until they register.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "push:subscribe", 20, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });

    const body = await request.json().catch(() => null);
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
    const p256dh = typeof body?.p256dh === "string" ? body.p256dh : null;
    const auth = typeof body?.auth === "string" ? body.auth : null;
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: "Missing subscription details." }, { status: 400 });
    }

    const profile = await ensureProfile(token);
    await savePushSubscription(profile.id, { endpoint, p256dh, auth }, request.headers.get("user-agent"));
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your subscription.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
