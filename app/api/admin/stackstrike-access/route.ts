import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setStackStrikeAccess } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

/**
 * Lets one player into the StackDead prototype, or takes it back.
 *
 * Same shape as the StackAcres toggle beside it: admin cookie, one profile,
 * one boolean. The guest list lives in the dashboard; there is no code.
 */
const bodySchema = z.object({
  profileId: z.string().uuid(),
  allowed: z.boolean(),
});

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "admin:stackstrike-access", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId and allowed flag." }, { status: 400 });
    }
    await setStackStrikeAccess(parsed.data.profileId, parsed.data.allowed);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that profile's StackDead access.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
