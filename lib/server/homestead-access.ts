import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { hasHomesteadAccess } from "./profile-store";
import { readSessionToken } from "./session";

/**
 * Who may reach the Homestead while it is on the floor but not open.
 *
 * A LIST OF PEOPLE, KEPT IN THE ADMIN DASHBOARD. This replaces a shared access
 * code, which replaced an allowlist of account ids in env. Both of those put
 * the guest list in a deploy and neither could let one person in without
 * letting in everyone holding the same string -- and a code that is never set
 * in the environment it ships to is indistinguishable from a broken feature,
 * which is exactly how the code version failed. A row in the dashboard cannot
 * fail that way: it is on or off, and it is visible.
 *
 * KEYED ON THE PROFILE, NOT THE ACCOUNT. `profiles.homestead_access` is the
 * same shape as `banned` and `unlimited_gold`, written only by
 * /api/admin/homestead-access. Profiles are what the dashboard lists and what
 * a session cookie resolves to, so a guest can be let in exactly like a
 * registered player -- which matches how the rest of the game treats guests.
 *
 * FAIL CLOSED. The column defaults to false, so shipping this admits nobody
 * until somebody is granted, including whoever deployed it. There is no env
 * var left to forget.
 *
 * THIS COSTS A DATABASE READ, so it must never run in front of the rate
 * limiter -- gating ahead of the limiter hands an unauthenticated flood a
 * query amplifier. That was the ordering rule the account-allowlist version
 * established and it is live again for the same reason. It must still run
 * BEFORE a session is minted, though: probing a locked route must never hand
 * the prober a session cookie.
 */

/** Whether the session behind this token has been let in. A tokenless caller never has. */
export async function tokenHasHomesteadAccess(token: string | null): Promise<boolean> {
  if (!token) return false;
  return hasHomesteadAccess(token);
}

/**
 * The same check for a route holding a NextRequest.
 *
 * Reads the session cookie WITHOUT minting one (readSessionToken, never
 * readOrCreateSessionToken): a fresh token has no profile behind it, so
 * minting here would both fail the check and leave a stranger holding an
 * identity they never asked for.
 */
export async function requestHasHomesteadAccess(request: NextRequest): Promise<boolean> {
  return tokenHasHomesteadAccess(readSessionToken(request));
}

/**
 * What a caller who is not on the list gets from the API.
 *
 * 401, never 404. The tile is on the arcade floor announcing the game exists,
 * so pretending the route is not there only makes a locked door look broken.
 * The body names the reason so the client can show the "ask for access" screen
 * rather than "something went wrong".
 */
export function homesteadLocked(): NextResponse {
  return NextResponse.json(
    { error: "The Homestead is not open to you yet.", locked: true },
    { status: 401 },
  );
}
