import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { equipCosmetic } from "@/lib/server/cosmetics-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

const bodySchema = z.object({ cosmeticId: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "cosmetics:equip", 40, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose an item to equip." }, { status: 400 });
    }
    const token = readOrCreateSessionToken(request);
    const profile = await ensureProfile(token);
    const equipped = await equipCosmetic(token, profile, parsed.data.cosmeticId);
    return withSessionCookie(NextResponse.json({ equipped }), token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not equip that item.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
