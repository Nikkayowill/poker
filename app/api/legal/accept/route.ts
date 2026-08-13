import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { LEGAL_DOCUMENT_SLUGS, type LegalDocumentSlug } from "@/lib/legal/documents";
import { ensureProfile } from "@/lib/server/profile-store";
import { recordAcceptance } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

// Derived from LEGAL_DOCUMENT_SLUGS rather than hand-listed -- a hand-listed
// copy here is exactly what silently rejected "privacy_policy" acceptances
// after that slug was added to the real list but not to this one.
const bodySchema = z.object({
  documents: z
    .array(z.enum(LEGAL_DOCUMENT_SLUGS as [LegalDocumentSlug, ...LegalDocumentSlug[]]))
    .min(1),
});

/** Records acceptance of the current version of one or more documents. */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "legal:accept", 20, 60 * 1000);
  if (limited) return limited;
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid acceptance request." }, { status: 400 });

    const token = readOrCreateSessionToken(request);
    const profile = await ensureProfile(token);
    await Promise.all(parsed.data.documents.map((slug) => recordAcceptance(profile.id, slug)));

    return withSessionCookie(NextResponse.json({ ok: true }), token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record acceptance.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
