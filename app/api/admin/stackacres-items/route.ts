import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MACHINE_RAW_ITEMS } from "@/lib/stackacres/machine-items";
import { adjustStackAcresInventory } from "@/lib/server/stackacres-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

// Gathered materials only (Wood, Stone, Metal and the like), for testing what
// they pay for before every one has a way to be earned: Metal has no smelter yet.
const bodySchema = z.object({
  profileId: z.string().uuid(),
  item: z.enum(MACHINE_RAW_ITEMS),
  delta: z.number().int().refine((value) => value !== 0, "delta must not be zero"),
});

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "admin:stackacres:items", 30, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid profileId, item and non-zero delta." }, { status: 400 });
    }
    const { profileId, item, delta } = parsed.data;
    const quantity = await adjustStackAcresInventory(profileId, item, delta);
    if (quantity === null) return NextResponse.json({ error: `Not that much ${item} to take.` }, { status: 400 });
    return NextResponse.json({ item, quantity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not adjust that item.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
