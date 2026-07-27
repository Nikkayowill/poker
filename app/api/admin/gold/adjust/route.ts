import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adjustGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  delta: z.number().int().refine((value) => value !== 0, "delta must not be zero"),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:gold:adjust", 30, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId and non-zero delta." }, { status: 400 });
    }
    const profile = await adjustGold(parsed.data.profileId, parsed.data.delta);
    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not adjust that profile's Gold.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
