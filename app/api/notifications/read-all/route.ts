import { NextRequest, NextResponse } from "next/server";
import { markAllNotificationsRead } from "@/lib/server/notifications-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/** Marks every unread notification read, fired when the bell popover opens. */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "notifications:read-all", 30, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    const profile = await ensureProfile(token);
    await markAllNotificationsRead(profile.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update your notifications.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
