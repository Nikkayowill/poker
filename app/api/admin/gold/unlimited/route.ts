import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setUnlimitedGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  unlimited: z.boolean(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:gold:unlimited", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId and unlimited flag." }, { status: 400 });
    }
    await setUnlimitedGold(parsed.data.profileId, parsed.data.unlimited);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that profile's Gold flag.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
