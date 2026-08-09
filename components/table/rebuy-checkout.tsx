"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { legalDocumentPath, type LegalDocument, type LegalDocumentSlug } from "@/lib/legal/documents";

/**
 * The real-money rebuy, launched from the table instead of from the store.
 *
 * Mounting this *is* the purchase intent: it posts for a Checkout Session
 * immediately and hands the browser to Stripe's hosted page. There is no
 * intermediate Gold modal and no catalog -- somebody who just busted wants
 * back in, and the pack is fixed.
 *
 * The one thing it will not skip is consent. /api/stripe/checkout-session
 * answers 412 with the documents still outstanding, and it does so *before*
 * a Checkout Session exists, deliberately not trusting a client-side
 * checkbox with anything that gates a charge. So a client cannot route
 * around it: skipping the prompt does not produce a checkout, it produces a
 * failed request. What this does instead is answer the 412 in place --
 * accept, then continue straight through to Stripe -- so a first-time buyer
 * at the table is one extra tap from playing rather than at a dead end.
 *
 * That dead end is what this replaces. The previous in-game path surfaced
 * the 412 as a bare error string with no way to accept without leaving the
 * table, which is why buying from the lobby worked and buying here did not.
 */
export function RebuyCheckout({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // Mirrors `busy` for the key handler, which is registered once and would
  // otherwise close over the value from its first render. Synced in an effect
  // rather than during render, which React forbids for refs.
  const busyRef = useRef(true);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  // React 18 mounts effects twice in development. Without this the component
  // asks Stripe for two Checkout Sessions on every open.
  const started = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  /**
   * Focus management for a dialog that takes money.
   *
   * It had none: focus stayed on whatever was behind it, so Tab walked
   * straight through the consent checkboxes into the table underneath, and a
   * screen reader was never told the dialog had opened. That matters more here
   * than on the other modals because the thing being tabbed past is the
   * agreement gating a charge.
   *
   * Escape closes only when not busy, matching the overlay's existing
   * click-outside guard -- there is a window where a Checkout Session is being
   * created and dismissing would strand it.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // The first control in the dialog, rather than the dialog itself, so the
    // first Tab continues from a real position in the order.
    dialog?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busyRef.current) onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (!dialog || dialog.contains(document.activeElement)) opener?.focus?.();
    };
    // Deliberately not keyed on `busy`: re-running would re-steal focus every
    // time the request state flips. The handler reads it through a ref instead.
  }, [onClose]);

  const startCheckout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      const data = await response.json();

      if (response.status === 412 && Array.isArray(data.pendingAcceptances)) {
        // Fetch the bodies to show. The 412 names the slugs still
        // outstanding; /api/legal/status carries the text that goes with
        // them, which is the same copy the storefront renders.
        const legal = await fetch("/api/legal/status", { cache: "no-store" });
        const legalData = await legal.json();
        if (!legal.ok) throw new Error(legalData.error ?? "Could not load the Terms.");
        setDocuments(legalData.documents ?? []);
        setBusy(false);
        return;
      }

      if (!response.ok) throw new Error(data.error ?? "Could not start checkout.");
      // Stripe's hosted page, same as the storefront. There is no in-app
      // card form anywhere in this product.
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start checkout.");
      setBusy(false);
    }
  }, [gameId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startCheckout();
  }, [startCheckout]);

  const allChecked = documents.length > 0 && documents.every((doc) => checked[doc.slug]);

  const acceptAndContinue = async () => {
    if (!allChecked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/legal/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: documents.map((doc) => doc.slug as LegalDocumentSlug) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not record your acceptance.");
      setDocuments([]);
      // Straight on to Stripe rather than making them press Buy again --
      // they already did, which is what opened this.
      await startCheckout();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record your acceptance.");
      setBusy(false);
    }
  };

  return (
    // Same overlay/panel shell every other modal in the app uses, so this
    // inherits the dismissal behaviour and the surface treatment rather
    // than restating them.
    <div className="profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section
        ref={dialogRef}
        className="profile-modal rebuy-checkout"
        role="dialog"
        aria-modal="true"
        aria-label="Buy Gold to rebuy"
      >
        {documents.length === 0 ? (
          <div className="rebuy-checkout-status">
            <h2>{error ? "Checkout unavailable" : "Opening checkout…"}</h2>
            {error
              ? <p className="rebuy-checkout-error">{error}</p>
              : <p>Taking you to our payment provider to buy Gold.</p>}
            <div className="rebuy-checkout-actions">
              <button type="button" className="secondary-action" onClick={onClose} disabled={busy && !error}>
                {error ? "Back to the table" : "Cancel"}
              </button>
              {error && (
                <button type="button" className="primary-action" onClick={() => void startCheckout()}>
                  Try again
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="rebuy-checkout-legal">
            <h2><ShieldCheck size={16} /> Before you buy</h2>
            {documents.map((doc) => (
              <div className="rebuy-checkout-doc" key={doc.slug}>
                <h3>
                  {doc.title}
                  <Link className="rebuy-checkout-legal-link" href={legalDocumentPath(doc.slug)}>
                    Read full text
                  </Link>
                </h3>
                {doc.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                <label className="rebuy-checkout-checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(checked[doc.slug])}
                    onChange={(event) =>
                      setChecked((current) => ({ ...current, [doc.slug]: event.target.checked }))}
                  />
                  <span>I have read and agree to the {doc.title}.</span>
                </label>
              </div>
            ))}
            {error && <p className="rebuy-checkout-error">{error}</p>}
            <small>Gold has no cash value and cannot be redeemed or withdrawn.</small>
            <div className="rebuy-checkout-actions">
              <button type="button" className="secondary-action" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={!allChecked || busy}
                onClick={() => void acceptAndContinue()}
              >
                {busy ? "Please wait…" : "Agree and continue"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
