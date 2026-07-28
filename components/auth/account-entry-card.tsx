"use client";

import { ArrowRight, LoaderCircle, LogOut } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";

export function AccountEntryCard({
  ready,
  accountsAvailable,
  pending,
  profile,
  remember,
  error,
  onRememberChange,
  onSignIn,
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
  onContinueAccount: () => void;
  onContinueAsGuest: () => void;
  onSignOut: () => void;
}) {
  const signedIn = Boolean(profile?.isRegistered);

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
