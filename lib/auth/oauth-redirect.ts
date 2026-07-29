export const OAUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Keep the PKCE callback on the origin that initiated sign-in. The verifier
 * lives in origin-scoped browser storage, so changing hosts mid-flow would
 * make an otherwise valid Google callback impossible to exchange.
 */
export function oauthCallbackUrl(origin: string): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    throw new Error("OAuth callbacks require an HTTP(S) origin.");
  }

  return new URL(OAUTH_CALLBACK_PATH, parsedOrigin.origin).toString();
}
