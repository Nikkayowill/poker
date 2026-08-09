/** HTTP methods that are not allowed to mutate application state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Detects browser cross-site mutation attempts without adding I/O.
 *
 * SameSite cookies are the first line of defence. This is the second: modern
 * browsers attach Origin to unsafe requests, so a mismatched value means a
 * foreign page is trying to spend the caller's ambient cookies. Requests with
 * no Origin remain valid for trusted server-to-server senders such as Stripe
 * and Vercel Cron; they cannot read a browser's HttpOnly cookies.
 */
export function isCrossOriginMutation(request: {
  method: string;
  headers: Pick<Headers, "get">;
  nextUrl: { origin: string };
}): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

  // Fetch Metadata is added by browsers and cannot be set by page script.
  // It closes the gap left by privacy tools or legacy clients that omit
  // Origin, while remaining absent on Stripe/Cron server-to-server requests.
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;

  const supplied = request.headers.get("origin");
  if (!supplied) return false;
  if (supplied === "null") return true;

  try {
    return new URL(supplied).origin !== request.nextUrl.origin;
  } catch {
    return true;
  }
}
