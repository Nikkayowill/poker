/** HTTP methods that are not allowed to mutate application state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface OriginCheckRequest {
  method: string;
  headers: Pick<Headers, "get">;
  nextUrl: { origin: string; protocol: string };
}

/**
 * The origin the browser actually addressed, reconstructed from the request.
 *
 * Not `nextUrl.origin`, which is what this used to compare against. That is a
 * framework-normalised URL rather than a statement about what the browser
 * typed: Next's dev server reports `http://localhost:<port>` for every
 * request no matter which host it arrived on, so a browser on
 * `http://127.0.0.1:<port>` sent a correct, same-origin `Origin` header and
 * was rejected as foreign. That failed closed rather than open, but it
 * rejected every mutation the E2E suite makes, which is why the whole suite
 * could not sign in as a guest.
 *
 * Trusting the forwarding headers is safe for the threat this guards. A page
 * cannot add `x-forwarded-host` to a cross-origin request without triggering
 * a CORS preflight this app never approves, and it cannot set `Origin` at
 * all. A non-browser client can forge both, but it is then making a plain
 * request with no victim's cookies attached, which is not CSRF. Vercel
 * overwrites both headers at its edge regardless.
 */
/**
 * The last value of a forwarding header, or null.
 *
 * Last rather than first, which is the opposite of what getClientIp wants
 * from x-forwarded-for. There the leftmost entry is the caller being
 * identified; here each proxy appends, so the rightmost is the one written
 * closest to this server and is the only entry an outside caller could not
 * have put there.
 */
function lastForwarded(request: OriginCheckRequest, header: string): string | null {
  const raw = request.headers.get(header);
  if (!raw) return null;
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function addressedOrigin(request: OriginCheckRequest): string {
  const host = lastForwarded(request, "x-forwarded-host") ?? request.headers.get("host");
  // No Host at all is a synthetic or HTTP/1.0 request; fall back to the
  // framework's own view rather than inventing one.
  if (!host) return request.nextUrl.origin;

  const protocol = lastForwarded(request, "x-forwarded-proto")
    ?? request.nextUrl.protocol.replace(/:$/, "");
  return `${protocol}://${host}`;
}

/**
 * Detects browser cross-site mutation attempts without adding I/O.
 *
 * SameSite cookies are the first line of defence. This is the second: modern
 * browsers attach Origin to unsafe requests, so a mismatched value means a
 * foreign page is trying to spend the caller's ambient cookies. Requests with
 * no Origin remain valid for trusted server-to-server senders such as Stripe
 * and Vercel Cron; they cannot read a browser's HttpOnly cookies.
 */
export function isCrossOriginMutation(request: OriginCheckRequest): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

  // Fetch Metadata is added by browsers and cannot be set by page script.
  // It closes the gap left by privacy tools or legacy clients that omit
  // Origin, while remaining absent on Stripe/Cron server-to-server requests.
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;

  const supplied = request.headers.get("origin");
  if (!supplied) return false;
  if (supplied === "null") return true;

  try {
    return new URL(supplied).origin !== addressedOrigin(request);
  } catch {
    return true;
  }
}
