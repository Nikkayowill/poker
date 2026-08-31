import { NextRequest, NextResponse } from "next/server";
import { toMintPlotSnapshots } from "@/lib/mint/plots";
import { readMintTreasury, toMintErrorResponse } from "@/lib/server/mint-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * The Sovereign Mint's read side: the caller's whole plot grid plus their
 * profile. Growth is derived client-side from the timestamps this returns,
 * so the client only ever calls this on mount and on tab-return, never on a
 * poll -- the limit is sized for that.
 *
 * Read-only, so it must never mint a session (session-minting.test.ts's
 * rule): a caller with no cookie sees the pristine grid -- four free plots,
 * a locked ladder -- and their first plant is what creates their identity,
 * through the actions route.
 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "mint:read", 120, 60 * 1000);
  if (limited) return limited;

  const token = readSessionToken(request);
  if (!token) {
    return NextResponse.json({ plots: toMintPlotSnapshots([], new Date()), profile: null });
  }
  try {
    return NextResponse.json(await readMintTreasury(token));
  } catch (error) {
    return toMintErrorResponse(error);
  }
}
