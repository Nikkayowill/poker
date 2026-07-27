import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { banProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  banned: z.boolean(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:ban", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId and banned flag." }, { status: 400 });
    }
    await banProfile(parsed.data.profileId, parsed.data.banned);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that profile's ban status.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
