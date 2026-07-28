import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { purchaseCosmetic } from "@/lib/server/cosmetics-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

// Only the item id is accepted. The price comes from the server-side catalog,
// so a client can never name its own.
const bodySchema = z.object({ cosmeticId: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "cosmetics:purchase", 20, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose an item to buy." }, { status: 400 });
    }
    const token = readOrCreateSessionToken(request);
    const profile = await ensureProfile(token);
    const result = await purchaseCosmetic(token, profile, parsed.data.cosmeticId);
    return withRequestSessionCookie(request,
      NextResponse.json({ profile: result.profile, owned: result.owned }),
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete that purchase.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
