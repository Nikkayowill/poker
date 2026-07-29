import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteProfiles } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid().optional(),
  profileIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
}).refine((body) => Boolean(body.profileId || body.profileIds?.length), {
  message: "Choose at least one profile.",
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:delete-profile", 30, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide between 1 and 1,000 valid profile IDs." }, { status: 400 });
    }
    const profileIds = [
      ...(parsed.data.profileIds ?? []),
      ...(parsed.data.profileId ? [parsed.data.profileId] : []),
    ];
    const deletedIds = await deleteProfiles(profileIds);
    if (parsed.data.profileId && deletedIds.length === 0) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      deletedIds,
      deletedCount: deletedIds.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete that profile.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
