import "server-only";
import { NextResponse } from "next/server";
import { findUserIdBySessionToken } from "./profile-store";

/**
 * Who may reach the Homestead while it is on production but not released.
 *
 * The allowlist is auth account ids, held in HOMESTEAD_ALLOWED_USER_IDS as a
 * comma-separated list. Two decisions worth keeping:
 *
 * IDS, NOT EMAILS. The request already carries a session cookie that resolves
 * to `profiles.user_id`, so an id is one lookup we are making anyway; matching
 * on an email would mean calling the Supabase auth admin API on every read
 * just to turn that id back into an address. Find an id from an address once,
 * by hand:
 *
 *     select id from auth.users where lower(email) = 'someone@example.com';
 *
 * IN ENV, NEVER IN THE REPO. This repository is public. An email is personal
 * data and an account id names one real person's account, so neither belongs
 * in a committed file -- which also means there is no default: an unset or
 * empty variable allows NOBODY, the same posture ADMIN_SECRET takes (no
 * secret configured means no default-open door). The cost of that choice is
 * that forgetting the variable looks exactly like the feature being broken,
 * so say so plainly wherever this is deployed.
 *
 * A guest has no account and so is never on the list; `findUserIdBySessionToken`
 * returns null for them and null never matches.
 */
export function homesteadAllowedUserIds(): Set<string> {
  return new Set(
    (process.env.HOMESTEAD_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Whether this session's owning account is on the list. */
export async function isHomesteadAllowed(token: string | null): Promise<boolean> {
  const allowed = homesteadAllowedUserIds();
  if (allowed.size === 0) return false;

  const userId = await findUserIdBySessionToken(token);
  return userId !== null && allowed.has(userId.toLowerCase());
}

/**
 * What everyone else gets: 404, never 403. A 403 confirms the feature is
 * there and worth coming back for; a 404 says nothing at all, which is the
 * point of "not released". Shaped like Next's own missing-route response so
 * it is indistinguishable from a URL that was never built.
 */
export function homesteadNotFound(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
