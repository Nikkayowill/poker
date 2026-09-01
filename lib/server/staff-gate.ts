import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAdminAuthorized } from "./admin-auth";

/**
 * The gate for a game that is finished but not being offered to the public
 * yet: reachable only by someone holding a live admin session.
 *
 * Why a guard rather than just leaving the row off the arcade floor, which is
 * the same lesson lib/arcade/retired.ts records: removing a catalog row hides
 * a link, it does not close a route. A still-mounted POST handler is reachable
 * by anyone with the URL or an open tab, and this one moves real Gold. So both
 * API routes check the admin session, and staff-gate.test.ts fails if a new
 * route appears under app/api/admin/homestead without doing so -- the property
 * that matters is not that today's routes are gated but that tomorrow's cannot
 * quietly skip it.
 *
 * WHY THE ROUTES LIVE UNDER /api/admin, which is not a filing preference:
 * ADMIN_SESSION_COOKIE is scoped `path=/api/admin`, so the browser only ever
 * sends it to routes beneath that path. Mounted at /api/homestead the gate
 * could not see the cookie that authorises it, and refused staff as well as
 * strangers -- confirmed by curl, not by reasoning, before this moved.
 * Widening the cookie to `/` was the alternative and is the wrong trade: the
 * narrow path is what keeps an admin credential off ordinary traffic, the same
 * reasoning that moved admin auth off a request header (see admin-auth.ts).
 *
 * There is deliberately no server-side helper for gating a PAGE. A page under
 * /admin cannot read this cookie either, for the same path reason, and the
 * existing console already answers that: /admin renders for anyone and the API
 * behind it refuses, so a stranger gets a locked state and no data. A page
 * gate that silently never fires would be worse than having none.
 *
 * Everything answers 404, never 401 or 403. A 403 confirms the feature exists
 * and is worth poking at; a 404 says nothing at all, which is the point of
 * "not public yet".
 */

export function isStaffRequest(request: NextRequest): boolean {
  return isAdminAuthorized(request);
}

/**
 * What an unauthorised caller gets from a staff-only API route. Shaped like
 * Next's own missing-route response so it is indistinguishable from a URL that
 * was never built.
 */
export function staffOnlyNotFound(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
