import { NextRequest, NextResponse } from "next/server";
import { listConnectionsArchive, toConnectionsErrorResponse } from "@/lib/server/connections-service";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * GET only -- this player's status on every Connections day they may have
 * missed, oldest excluded (today has its own live page at
 * /api/arcade/connections) and newest first. No POST here: opening or
 * playing a specific archive day stays on the main route with an explicit
 * `day`, not a parallel archive-only open/play pair.
 *
 * No rate limit, matching the sibling GET on /api/arcade/connections: this
 * is one read, not a wallet-adjacent write.
 *
 * The token-reading helper here is deliberately the non-minting one: this
 * file has only a GET handler, and session-minting.test.ts enforces that a
 * GET-only route never creates a session -- a page visit must not be what
 * creates a player. A caller with no cookie yet gets the honest answer
 * (nothing played, since there is no profile to have played anything)
 * rather than a freshly minted one, and with nothing minted there is
 * nothing new to persist, so this never sets a cookie either.
 */
export async function GET(request: NextRequest) {
  const token = readSessionToken(request);
  try {
    return NextResponse.json(await listConnectionsArchive(token));
  } catch (error) {
    return toConnectionsErrorResponse(error);
  }
}
