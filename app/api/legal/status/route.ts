import { NextRequest, NextResponse } from "next/server";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_SLUGS } from "@/lib/legal/documents";
import { ensureProfile } from "@/lib/server/profile-store";
import { pendingAcceptances } from "@/lib/server/legal-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Which of the two documents this player still needs to accept, plus their
 * current text -- so the storefront can render the prompt (or skip it
 * entirely for a returning player who already agreed) without a second
 * round trip to fetch the body copy.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "legal:status", 60, 60 * 1000);
  if (limited) return limited;
  try {
    // A reader with no session has accepted nothing, which is answerable
    // without giving them an identity. Minting one here would create a
    // throwaway profile for every visitor who merely opened the storefront.
    const token = readSessionToken(request);
    const pending = token
      ? await pendingAcceptances((await ensureProfile(token)).id)
      : [...LEGAL_DOCUMENT_SLUGS];
    return NextResponse.json({
      pending,
      documents: pending.map((slug) => LEGAL_DOCUMENTS[slug]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load legal status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
