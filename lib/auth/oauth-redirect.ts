export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const PASSWORD_RESET_CALLBACK_PATH = "/auth/reset-password/callback";
export const PRODUCTION_SITE_ORIGIN = "https://www.stackchips.app";

function normalizedHttpOrigin(origin: string): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    throw new Error("OAuth callbacks require an HTTP(S) origin.");
  }

  return parsedOrigin.origin;
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  const { hostname, protocol } = new URL(origin);
  return (
    protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
  );
}

/**
 * Production sign-in must always return to the canonical StackChips host.
 *
 * A stale/mistyped Vercel NEXT_PUBLIC_SITE_URL must never be allowed to send a
 * production OAuth exchange to localhost. Localhost remains supported only
 * when the sign-in was genuinely initiated from a loopback browser origin.
 */
export function oauthSiteOrigin(
  browserOrigin: string | undefined =
    typeof window !== "undefined" ? window.location.origin : undefined,
): string {
  if (browserOrigin) {
    const normalizedBrowserOrigin = normalizedHttpOrigin(browserOrigin);
    if (isLocalDevelopmentOrigin(normalizedBrowserOrigin)) {
      return normalizedBrowserOrigin;
    }
  }

  return PRODUCTION_SITE_ORIGIN;
}

/**
 * Keep local PKCE exchanges local, but make every deployed exchange return to
 * the one canonical production callback.
 */
export function oauthCallbackUrl(origin: string = oauthSiteOrigin()): string {
  return new URL(OAUTH_CALLBACK_PATH, normalizedHttpOrigin(origin)).toString();
}

/**
 * Same origin-pinning as the OAuth callback above, but its own path and its
 * own route handler: a password-recovery code exchange must land the player
 * on "set a new password," not straight into the app the way a completed
 * sign-in does. See app/auth/reset-password/callback/route.ts.
 */
export function passwordResetCallbackUrl(origin: string = oauthSiteOrigin()): string {
  return new URL(PASSWORD_RESET_CALLBACK_PATH, normalizedHttpOrigin(origin)).toString();
}
