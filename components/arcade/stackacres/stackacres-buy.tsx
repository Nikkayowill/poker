"use client";

import { Capacitor } from "@capacitor/core";
import Link from "next/link";
import { useEffect, useState } from "react";

export interface StackAcresOffer {
  unitAmount: number;
  currency: string;
}

/**
 * The buy button on the locked StackAcres page: one confirmation, then Stripe
 * Checkout. Also settles the return trip (?payment=success&session_id=...) so
 * a player lands in the farm even if the webhook is a beat behind.
 *
 * The native shell never sells it. The stores take a cut of, and have rules
 * about, in-app sales, so the app only points at the website.
 */
export function StackAcresBuy({ offer, registered }: { offer: StackAcresOffer; registered: boolean }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState(false);

  useEffect(() => {
    // Capacitor and the URL are only known after mount.
    const timer = window.setTimeout(() => {
      setNative(Capacitor.isNativePlatform());
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("session_id");
      if (params.get("payment") !== "success" || !sessionId) return;
      setBusy(true);
      void fetch(`/api/stripe/checkout-session/verify?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json()) as { paid?: boolean; error?: string };
          if (!response.ok) throw new Error(data.error ?? "Could not verify the payment.");
          if (data.paid) {
            window.location.replace("/games/stackacres");
            return;
          }
          setError("Your payment is still processing. Refresh in a minute.");
          setBusy(false);
        })
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : "Could not verify the payment.");
          setBusy(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (native) {
    return <p>StackAcres is bought on the website at stackchips.app.</p>;
  }

  const price = new Intl.NumberFormat("en-US", { style: "currency", currency: offer.currency.toUpperCase() }).format(
    offer.unitAmount / 100,
  );

  if (!registered) {
    return (
      <p>
        StackAcres is {price}, once. Save your progress with an account first, so your purchase is always yours.{" "}
        <Link href="/">Back to the lobby</Link>
      </p>
    );
  }

  const buy = async () => {
    if (!agreed || busy) return;
    setBusy(true);
    setError(null);
    try {
      let response = await purchase();
      if (response.status === 412) {
        const pending = ((await response.json()) as { pendingAcceptances?: string[] }).pendingAcceptances ?? [];
        // The box below is the acceptance: it names the Terms and Privacy Policy.
        await fetch("/api/legal/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documents: pending }),
        });
        response = await purchase();
      }
      const data = (await response.json()) as { url?: string; error?: string; owned?: boolean };
      // Already theirs (bought before, or another tab finished first): go straight in.
      if (data.owned) {
        window.location.replace("/games/stackacres");
        return;
      }
      if (!response.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start checkout.");
      setBusy(false);
    }
  };

  return (
    <div className="sa-gate-buy">
      <label>
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />{" "}
        I am 18 or older, and I agree to the <Link href="/legal/terms">Terms</Link> and{" "}
        <Link href="/legal/privacy">Privacy Policy</Link>. See the <Link href="/legal/stackacres-refunds">refund policy</Link>.
      </label>
      <button type="button" className="sa-cta" disabled={!agreed || busy} onClick={() => void buy()}>
        {busy ? "One moment..." : `Buy StackAcres for ${price}`}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function purchase(): Promise<Response> {
  return fetch("/api/stripe/stackacres", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ over18: true }),
  });
}
