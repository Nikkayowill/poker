"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";

/**
 * A one-time PKCE code can end up processed more than once for the same
 * sign-in -- a browser's speculative preload of the redirect target, a
 * security extension probing the URL, or simply this effect re-running.
 * Whichever attempt loses that race gets back a real error
 * (flow_state_already_used) even though sign-in itself succeeded via the
 * other attempt. Reacting to onAuthStateChange rather than trusting a
 * single getSession() call means a session that lands moments after this
 * particular attempt errored is still caught, instead of showing a false
 * failure for something that actually worked.
 */
const SETTLE_TIMEOUT_MS = 6_000;

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let settled = false;

    const client = authClient();
    if (!client) {
      const timer = window.setTimeout(() => setError("Account sign-in is not configured."), 0);
      return () => window.clearTimeout(timer);
    }

    const succeed = () => {
      if (!active || settled) return;
      settled = true;
      router.replace("/");
      router.refresh();
    };

    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")) {
        succeed();
      }
    });

    // The fast path: a session may already be there (or arrive within a
    // normal exchange) well before the settle timeout below ever matters.
    void client.auth.getSession().then(({ data }) => {
      if (data.session) succeed();
    });

    const timeout = window.setTimeout(() => {
      if (!active || settled) return;
      settled = true;
      setError("Google sign-in could not be completed. Please start again.");
    }, SETTLE_TIMEOUT_MS);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <main className="account-entry-page">
      <section className="account-entry-card" aria-labelledby="auth-callback-title">
        <div className="account-entry-glow" aria-hidden="true" />
        <div className="account-entry-mark" aria-hidden="true"><span>R</span></div>
        <div className="account-entry-eyebrow">River Room · Secure sign-in</div>
        <h1 id="auth-callback-title">
          {error ? "Sign-in interrupted" : "Taking you to your seat"}
        </h1>

        {error ? (
          <>
            <p className="account-entry-error" role="alert">{error}</p>
            <button
              type="button"
              className="account-primary-action"
              onClick={() => router.replace("/")}
            >
              Return to sign-in <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <p className="account-entry-status" role="status">
            <LoaderCircle className="account-entry-spinner" size={17} />
            Verifying your Google account…
          </p>
        )}
      </section>
    </main>
  );
}
