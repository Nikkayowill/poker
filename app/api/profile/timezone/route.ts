import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setProfileTimezone } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

const bodySchema = z.object({ timezone: z.string().min(1).max(100) });

/**
 * Records this browser's own IANA zone (Intl.DateTimeFormat().resolvedOptions().timeZone),
 * so the re-engagement push cron can send at a sensible local hour instead
 * of one fixed UTC time for everyone. See components/poker-app.tsx's capture
 * effect. A bad/unknown zone name is silently dropped by the store rather
 * than surfaced as an error -- this is background telemetry a player never
 * sees the result of either way.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:timezone", 10, 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "That timezone isn't valid." }, { status: 400 });
    await setProfileTimezone(token, parsed.data.timezone);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your timezone.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
