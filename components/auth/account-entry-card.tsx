"use client";

import { ArrowRight, LoaderCircle, LogOut } from "lucide-react";
import { FormEvent, useState } from "react";
import type { PlayerProfile } from "@/lib/profile/types";
import { StackChipsLogo } from "@/components/brand/stackchips-logo";

// Matches Supabase's password_min_length (Authentication -> Providers ->
// Email). NIST SP 800-63B and OWASP ASVS L1 both put the floor at 8.
const MIN_PASSWORD_LENGTH = 8;

/**
 * Google's mark, inline.
 *
 * Every other icon here comes from lucide, which has no Google glyph -- and
 * a generic mail/key icon on the Google button is the tell that a sign-in
 * page was assembled rather than designed. Four paths, official colours.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.9 41 15.3 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1A22 22 0 0 0 2 24c0 3.6.9 6.9 2.5 9.9l7-5.5z" />
      <path fill="#EA4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.3 2 7.9 7 4.5 14.1l7 5.5C13.3 14.3 18.2 10.5 24 10.5z" />
    </svg>
  );
}

/**
 * The signed-out entry surface.
 *
 * Two things about the shape here are load-bearing rather than aesthetic and
 * should survive the next redesign of it:
 *
 * 1. `.account-entry-page` (the wrapper, in lobby.tsx) and the accessible name
 *    "Play as guest" are both asserted by the e2e suite -- ten specs open the
 *    app by clicking that exact button. Restyle freely; rename neither.
 * 2. One stable surface stays mounted for every auth state. A remembered
 *    session restoring must not flash a different layout before replacing it,
 *    which is why `ready` swaps the *controls* in place rather than swapping
 *    the component out.
 *
 * The email form leads and Google follows, rather than the other way round:
 * a returning player's muscle memory is the field, and the previous ordering
 * hid email behind a text toggle two taps deep.
 */
export function AccountEntryCard({
  ready,
  accountsAvailable,
  pending,
  profile,
  remember,
  error,
  onRememberChange,
  onSignIn,
  onEmailSignIn,
  onEmailSignUp,
  onContinueAccount,
  onContinueAsGuest,
  onSignOut,
}: {
  ready: boolean;
  accountsAvailable: boolean;
  pending: boolean;
  profile: PlayerProfile | null;
  remember: boolean;
  error: string | null;
  onRememberChange: (remember: boolean) => void;
  onSignIn: () => void;
  onEmailSignIn: (email: string, password: string) => void;
  onEmailSignUp: (email: string, password: string) => void;
  onContinueAccount: () => void;
  onContinueAsGuest: () => void;
  onSignOut: () => void;
}) {
  const signedIn = Boolean(profile?.isRegistered);
  const [emailMode, setEmailMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const busy = !ready || pending;

  const submitEmailForm = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (emailMode === "sign-in") onEmailSignIn(email.trim(), password);
    else onEmailSignUp(email.trim(), password);
  };

  return (
    <section className="account-entry-card" aria-labelledby="account-entry-title">
      <div className="entry-aurora" aria-hidden="true" />

      <header className="entry-head">
        <StackChipsLogo size={148} priority className="entry-logo" />
        <h1 id="account-entry-title">Play free. Stack chips.</h1>

        {!ready ? (
          <p className="account-entry-status" role="status">
            <LoaderCircle className="account-entry-spinner" size={15} />
            Checking your player session…
          </p>
        ) : signedIn ? (
          <p>
            Welcome back, <strong>{profile?.displayName}</strong>. Your Gold,
            avatar, and collection are ready.
          </p>
        ) : (
          // One sentence. The second half used to explain the two buttons
          // directly underneath it -- "sign in to keep it on every device, or
          // walk in as a guest" -- which is a paragraph describing the
          // controls a player can already see and read in less time.
          <p>
            Poker, blackjack, Hi-Lo and the daily puzzles — one wallet across
            the whole arcade.
          </p>
        )}
      </header>

      <div className="account-entry-actions">
        {signedIn ? (
          <>
            <button
              type="button"
              className="account-primary-action"
              disabled={busy}
              onClick={onContinueAccount}
            >
              {pending
                ? <><LoaderCircle className="account-entry-spinner" size={17} /> Preparing your seat…</>
                : <>Enter StackChips <ArrowRight size={17} /></>}
            </button>
            <button
              type="button"
              className="account-guest-action"
              disabled={busy || !accountsAvailable}
              onClick={onSignOut}
            >
              <LogOut size={15} /> Not you? Sign out
            </button>
          </>
        ) : (
          <>
            {accountsAvailable && (
              <>
                {/* A two-way segmented control, not a text link: which of the
                    two things the form is about to do is the single most
                    consequential fact on this screen, so it gets a control
                    that shows its state rather than one that describes it. */}
                <div className="entry-segment" role="group" aria-label="Account action">
                  <button
                    type="button"
                    className={emailMode === "sign-in" ? "is-active" : undefined}
                    aria-pressed={emailMode === "sign-in"}
                    disabled={busy}
                    onClick={() => { setEmailMode("sign-in"); setFormError(null); }}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={emailMode === "sign-up" ? "is-active" : undefined}
                    aria-pressed={emailMode === "sign-up"}
                    disabled={busy}
                    onClick={() => { setEmailMode("sign-up"); setFormError(null); }}
                  >
                    Create account
                  </button>
                </div>

                <form className="account-email-form" onSubmit={submitEmailForm}>
                  <div className="account-email-fields">
                    <label className="entry-field">
                      <span>Email</span>
                      <input
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={email}
                        disabled={busy}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                      />
                    </label>
                    <label className="entry-field">
                      <span>Password</span>
                      <input
                        type="password"
                        autoComplete={emailMode === "sign-in" ? "current-password" : "new-password"}
                        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                        value={password}
                        disabled={busy}
                        onChange={(event) => setPassword(event.target.value)}
                        minLength={MIN_PASSWORD_LENGTH}
                        required
                      />
                    </label>
                  </div>

                  <label className="account-remember">
                    <input
                      type="checkbox"
                      checked={remember}
                      disabled={busy}
                      onChange={(event) => onRememberChange(event.target.checked)}
                    />
                    <span className="entry-switch" aria-hidden="true" />
                    <span className="entry-remember-copy">
                      <strong>Stay signed in</strong>
                      <small>Remember this player on this device</small>
                    </span>
                  </label>

                  <button type="submit" className="account-primary-action" disabled={busy}>
                    {pending
                      ? <><LoaderCircle className="account-entry-spinner" size={17} /> {emailMode === "sign-in" ? "Signing in…" : "Creating account…"}</>
                      : emailMode === "sign-in"
                        ? <>Sign in <ArrowRight size={17} /></>
                        : <>Create account <ArrowRight size={17} /></>}
                  </button>
                  {formError && <p className="account-entry-error" role="alert">{formError}</p>}
                </form>

                <div className="entry-divider"><span>or</span></div>

                <button
                  type="button"
                  className="account-oauth-action"
                  disabled={busy}
                  onClick={onSignIn}
                >
                  <GoogleMark />
                  {pending ? "Opening Google…" : "Continue with Google"}
                </button>
              </>
            )}

            <button
              type="button"
              className="account-guest-action"
              disabled={busy}
              onClick={onContinueAsGuest}
            >
              Play as guest
            </button>

            {!accountsAvailable && (
              <p className="account-entry-error" role="status">
                Account sign-in is unavailable right now — guest play still works.
              </p>
            )}
          </>
        )}
      </div>

      {error && <p className="account-entry-error" role="alert">{error}</p>}
      <p className="account-entry-footnote">
        Guest progress stays in this browser. StackChips Gold has no cash value
        and cannot be redeemed or withdrawn.
      </p>
    </section>
  );
}
