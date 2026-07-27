import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:delete-profile", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId." }, { status: 400 });
    }
    await deleteProfile(parsed.data.profileId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete that profile.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
