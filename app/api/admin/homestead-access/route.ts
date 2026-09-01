import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setHomesteadAccess } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

/**
 * Lets one player into the Homestead while it is unreleased, or takes it back.
 *
 * The whole guest list lives here now -- there is no code and no env var to
 * set. Same shape as the ban and unlimited-Gold toggles beside it: admin
 * cookie, one profile, one boolean.
 */
const bodySchema = z.object({
  profileId: z.string().uuid(),
  allowed: z.boolean(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:homestead-access", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId and allowed flag." }, { status: 400 });
    }
    await setHomesteadAccess(parsed.data.profileId, parsed.data.allowed);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that profile's Homestead access.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
