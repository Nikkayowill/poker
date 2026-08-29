"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";

type Status = "checking" | "ready" | "no-session" | "saved";

/**
 * Where a password-recovery link actually lands (see
 * app/auth/reset-password/callback/route.ts) -- the server route has
 * already exchanged the code and set the Supabase session cookie by the
 * time this page loads, so there is nothing left to do here except read
 * that session back and let the player pick a new password with it.
 *
 * A visit with no valid recovery session (the link expired, or someone
 * navigated here directly) bounces to `/` rather than showing a form with
 * nothing behind it to authorize the update.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const client = authClient();
    // No client is the same "nothing to check" outcome as no session --
    // resolved through a promise either way so this never sets state
    // synchronously from the effect body itself.
    void (client ? client.auth.getSession() : Promise.resolve({ data: { session: null } }))
      .then(({ data }) => {
        if (active) setStatus(data.session ? "ready" : "no-session");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "no-session") return;
    router.replace("/");
  }, [status, router]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Those two passwords don't match.");
      return;
    }
    const client = authClient();
    if (!client) return;
    selectSound();
    setSaving(true);
    void client.auth.updateUser({ password }).then(({ error: updateError }) => {
      setSaving(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setStatus("saved");
      // A brief confirmation beats an instant redirect -- the player just
      // typed a password with no other feedback that it took.
      window.setTimeout(() => router.replace("/"), 1_400);
    });
  };

  return (
    <div className="app-root">
      {/* No <EntryHero />/star-sky here on purpose -- this is a short,
          single-purpose utility screen (reached only via an emailed link),
          not the first-impression surface .account-entry-page's sky was
          built for. The room gradient still applies (app-shell.css's
          :has(.account-entry-page) selector), just without the drifting
          orbs. */}
      <main className="account-entry-page">
        <section className="account-entry-card" aria-labelledby="reset-password-title">
          <header className="entry-head">
            <h1 id="reset-password-title">Set a new password</h1>
            {status === "checking" && (
              <p className="account-entry-status" role="status">
                <LoaderCircle className="account-entry-spinner" size={15} />
                Checking your reset link…
              </p>
            )}
            {status === "ready" && (
              <p>Choose a new password for your StackChips account.</p>
            )}
            {status === "saved" && (
              <p>Password updated. Taking you back in…</p>
            )}
          </header>

          {status === "ready" && (
            <form className="account-email-form account-entry-actions" onSubmit={submit}>
              <label className="entry-field">
                <span>New password</span>
                <div className="entry-field-input">
                  <input
                    type={passwordVisible ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    value={password}
                    disabled={saving}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                  />
                  <button
                    type="button"
                    className="entry-field-toggle"
                    disabled={saving}
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                    onClick={() => { tapSound(); setPasswordVisible((visible) => !visible); }}
                  >
                    {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <label className="entry-field">
                <span>Confirm password</span>
                <input
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Type it again"
                  value={confirmPassword}
                  disabled={saving}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                />
              </label>
              <button type="submit" className="account-primary-action" disabled={saving}>
                {saving
                  ? <><LoaderCircle className="account-entry-spinner" size={17} /> Saving…</>
                  : <>Save new password <ArrowRight size={17} /></>}
              </button>
              {error && <p className="account-entry-error" role="alert">{error}</p>}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
