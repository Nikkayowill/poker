import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HISTORY_PAGE_SIZE, listHandHistory } from "@/lib/server/hand-archive-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(HISTORY_PAGE_SIZE),
  // An opaque keyset cursor produced by the store -- bounded here, and
  // parsed (or rejected) there. See its decodeCursor.
  cursor: z.string().max(200).nullable().default(null),
});

/**
 * The caller's own recent hands, newest first.
 *
 * Registered accounts only. A guest's hands are still archived -- they may
 * link an account later and it would be strange for their history to start
 * the day they signed up -- but reviewing history is durable, cross-session
 * progress, which this app only promises to a real account.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "history:list", 60, 60 * 1000);
  if (limited) return limited;

  try {
    const token = readSessionToken(request);
    if (!token) {
      return NextResponse.json({ error: "Sign in to review your hand history." }, { status: 401 });
    }

    const parsed = querySchema.safeParse({
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      cursor: request.nextUrl.searchParams.get("cursor") ?? null,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid history request." }, { status: 400 });
    }

    const profile = await ensureProfile(token);
    if (!profile.isRegistered) {
      return NextResponse.json(
        { error: "Create an account to keep and review your hand history." },
        { status: 403 },
      );
    }

    const page = await listHandHistory(profile.id, parsed.data);
    return NextResponse.json(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your hand history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
