import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRegisteredProfile } from "@/lib/server/api-auth";
import { HISTORY_PAGE_SIZE, listHandHistory } from "@/lib/server/hand-archive-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(HISTORY_PAGE_SIZE),
  // An opaque keyset cursor produced by the store, bounded here and
  // parsed (or rejected) there. See its decodeCursor.
  cursor: z.string().max(200).nullable().default(null),
});

/**
 * The caller's own recent hands, newest first.
 *
 * Registered accounts only. A guest's hands are still archived, since they
 * may link an account later and it would be strange for their history to
 * start the day they signed up, but reviewing history is durable,
 * cross-session progress, which this app only promises to a real account.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "history:list", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const auth = await requireRegisteredProfile(
      request,
      "Create an account to keep and review your hand history.",
      "Sign in to review your hand history.",
    );
    if (auth.response) return auth.response;

    const parsed = querySchema.safeParse({
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      cursor: request.nextUrl.searchParams.get("cursor") ?? null,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid history request." }, { status: 400 });
    }

    const page = await listHandHistory(auth.profile.id, parsed.data);
    return NextResponse.json(page);
  } catch (error) {
    console.error("history:list failed", error);
    return NextResponse.json({ error: "Could not load your hand history." }, { status: 500 });
  }
}
