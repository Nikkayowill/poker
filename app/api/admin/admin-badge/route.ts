import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setAdminBadge } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

/**
 * Puts the "Admin" tag above one player's poker seat, or takes it off.
 *
 * Same shape as the ban, unlimited-Gold and StackAcres toggles beside it:
 * admin cookie, one profile, one boolean. The tag is cosmetic -- it grants
 * nothing, and the admin portal itself never reads it.
 */
const bodySchema = z.object({
  profileId: z.string().uuid(),
  shown: z.boolean(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:admin-badge", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId and shown flag." }, { status: 400 });
    }
    await setAdminBadge(parsed.data.profileId, parsed.data.shown);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that profile's admin tag.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
