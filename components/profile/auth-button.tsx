"use client";

import type { PlayerProfile } from "@/lib/profile/types";
import { accountsEnabled } from "@/lib/auth/client";

export function AuthButton({
  profile,
  onSignIn,
  onSignOut,
}: {
  profile: PlayerProfile | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const available = accountsEnabled();
  if (profile?.isRegistered) {
    return (
      <button type="button" className="auth-button" onClick={onSignOut}>
        Sign out
      </button>
    );
  }
  return (
    <button
      type="button"
      className="auth-button auth-button-save"
      onClick={onSignIn}
      disabled={!available}
      title={available ? "Sign in with Google to save your progress" : "Sign-in is unavailable until Supabase is configured"}
    >
      Sign in
    </button>
  );
}
