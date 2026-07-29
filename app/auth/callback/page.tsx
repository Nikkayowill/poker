"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const finishSignIn = async () => {
      const client = authClient();
      if (!client) {
        if (active) setError("Account sign-in is not configured.");
        return;
      }

      // browserSupabase is configured for PKCE and begins exchanging the
      // one-time callback code during client initialization. getSession waits
      // for that initialization, so no token ever needs to be handled here.
      const { data, error: sessionError } = await client.auth.getSession();
      if (!active) return;

      if (sessionError || !data.session) {
        setError("Google sign-in could not be completed. Please start again.");
        return;
      }

      router.replace("/");
      router.refresh();
    };

    void finishSignIn();
    return () => {
      active = false;
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
