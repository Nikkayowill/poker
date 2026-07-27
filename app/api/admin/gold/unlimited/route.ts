import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setUnlimitedGold } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  unlimited: z.boolean(),
});

/**
 * Not a full admin panel -- there is no admin UI yet, by design (see the
 * Gold-economy plan). This is the "protected way to set it" for now: called
 * by hand (e.g. curl) with the target's Player ID, shown read-only in their
 * own ProfileModal so it can be shared with whoever is granting the flag.
 * Comparing SHA-256 digests (always 32 bytes) rather than the raw strings
 * keeps the timingSafeEqual call valid regardless of either string's length,
 * without leaking length via an early mismatch.
 */
function isAuthorized(request: NextRequest): boolean {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) return false;
  const provided = request.headers.get("x-admin-secret") ?? "";
  const providedHash = createHash("sha256").update(provided).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(providedHash, configuredHash);
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:gold:unlimited", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAuthorized(request)) {
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
