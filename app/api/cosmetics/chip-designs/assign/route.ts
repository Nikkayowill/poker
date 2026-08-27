import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assignChipDesign } from "@/lib/server/cosmetics-store";
import { CHIP_DESIGN_DENOMINATIONS } from "@/lib/cosmetics/catalog";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  denomination: z.number().refine((value) => CHIP_DESIGN_DENOMINATIONS.includes(value as never)),
  // null clears the slot back to the house default.
  cosmeticId: z.string().min(1).max(64).nullable(),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "cosmetics:assign-chip", 40, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose a chip design to assign." }, { status: 400 });
    }
    const token = readOrCreateSessionToken(request);
    const profile = await ensureProfile(token);
    const equipped = await assignChipDesign(
      token,
      profile,
      parsed.data.denomination as (typeof CHIP_DESIGN_DENOMINATIONS)[number],
      parsed.data.cosmeticId,
    );
    return withRequestSessionCookie(request, NextResponse.json({ equipped }), token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not assign that chip design.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
