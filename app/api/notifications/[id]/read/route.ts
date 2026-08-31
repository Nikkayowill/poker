import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markNotificationRead } from "@/lib/server/notifications-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

/** Marks one notification read. Same guest-open posture as GET /api/notifications. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "notifications:read-mark", 120, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid notification." }, { status: 400 });
    }

    const profile = await ensureProfile(token);
    const ok = await markNotificationRead(profile.id, parsedParams.data.id);
    return NextResponse.json({ ok });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that notification.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
