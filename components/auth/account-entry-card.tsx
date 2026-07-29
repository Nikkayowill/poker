"use client";

import { ArrowRight, LoaderCircle, LogOut, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import type { PlayerProfile } from "@/lib/profile/types";

const MIN_PASSWORD_LENGTH = 6;

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
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const [emailMode, setEmailMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

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
      <div className="account-entry-glow" aria-hidden="true" />
      <div className="account-entry-mark" aria-hidden="true"><span>R</span></div>
      <div className="account-entry-eyebrow">River Room · No-limit Hold’em</div>
      <h1 id="account-entry-title">River Room</h1>

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
        <p>
          Sign in to keep your progress on every device, or enter with a guest
          profile and secure it later.
        </p>
      )}

      <label className="account-remember">
        <input
          type="checkbox"
          checked={remember}
          disabled={!ready || pending}
          onChange={(event) => onRememberChange(event.target.checked)}
        />
        <span>
          <strong>Stay signed in</strong>
          <small>Remember this player on this device</small>
        </span>
      </label>

      <div className="account-entry-actions">
        {signedIn ? (
          <>
            <button
              type="button"
              className="account-primary-action"
              disabled={!ready || pending}
              onClick={onContinueAccount}
            >
              {pending
                ? <><LoaderCircle className="account-entry-spinner" size={17} /> Preparing your seat…</>
                : <>Enter River Room <ArrowRight size={17} /></>}
            </button>
            <button
              type="button"
              className="account-guest-action"
              disabled={!ready || pending || !accountsAvailable}
              onClick={onSignOut}
            >
              <LogOut size={15} /> Not you? Sign out
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="account-primary-action"
              disabled={!ready || pending}
              onClick={onSignIn}
            >
              {pending
                ? <><LoaderCircle className="account-entry-spinner" size={17} /> Opening Google…</>
                : accountsAvailable
                  ? <>Continue with Google <ArrowRight size={17} /></>
                  : "Account sign-in unavailable"}
            </button>
            <button
              type="button"
              className="account-guest-action"
              disabled={!ready || pending}
              onClick={onContinueAsGuest}
            >
              Play as guest
            </button>

            {accountsAvailable && (
              emailFormOpen ? (
                <form className="account-email-form" onSubmit={submitEmailForm}>
                  <div className="account-email-fields">
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="Email"
                      value={email}
                      disabled={!ready || pending}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                    <input
                      type="password"
                      autoComplete={emailMode === "sign-in" ? "current-password" : "new-password"}
                      placeholder="Password"
                      value={password}
                      disabled={!ready || pending}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={MIN_PASSWORD_LENGTH}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="account-primary-action"
                    disabled={!ready || pending}
                  >
                    {pending
                      ? <><LoaderCircle className="account-entry-spinner" size={17} /> {emailMode === "sign-in" ? "Signing in…" : "Creating account…"}</>
                      : emailMode === "sign-in" ? <>Sign in <ArrowRight size={17} /></> : <>Create account <ArrowRight size={17} /></>}
                  </button>
                  <button
                    type="button"
                    className="account-email-toggle"
                    disabled={!ready || pending}
                    onClick={() => {
                      setEmailMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
                      setFormError(null);
                    }}
                  >
                    {emailMode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
                  </button>
                  {formError && <p className="account-entry-error" role="alert">{formError}</p>}
                </form>
              ) : (
                <button
                  type="button"
                  className="account-email-toggle"
                  disabled={!ready || pending}
                  onClick={() => setEmailFormOpen(true)}
                >
                  <Mail size={14} /> Continue with email
                </button>
              )
            )}
          </>
        )}
      </div>

      {error && <p className="account-entry-error" role="alert">{error}</p>}
      <p className="account-entry-footnote">
        Guest progress stays in this browser. River Room Gold has no cash value
        and cannot be redeemed or withdrawn.
      </p>
    </section>
  );
}
