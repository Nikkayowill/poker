"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { HeartHandshake, ShieldCheck } from "lucide-react";
import { LEGAL_DOCUMENTS, legalDocumentPath, type LegalDocument, type LegalDocumentSlug } from "@/lib/legal/documents";
import type { ResolvedSupportTier, SupportBilling } from "@/lib/server/stripe";
import type { StoredStripeSubscription } from "@/lib/server/stripe-store";
import { selectSound } from "@/lib/audio/ui-sounds";

function formatPrice(unitAmount: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: currency.toUpperCase() }).format(unitAmount / 100);
}

/**
 * Voluntary support: one-time or monthly, any tier, any time. No tier here
 * ever grants Gold, a gameplay advantage, or anything with in-game economic
 * effect -- see lib/legal/documents.ts's support_disclosure, which this
 * panel's copy is written to match exactly, not just gesture at.
 */
export function SupportPanel({ gameId }: { gameId?: string }) {
  const [options, setOptions] = useState<ResolvedSupportTier[]>([]);
  const [membership, setMembership] = useState<StoredStripeSubscription | null>(null);
  const [pendingDocuments, setPendingDocuments] = useState<LegalDocument[]>([]);
  const [checked, setChecked] = useState<Record<LegalDocumentSlug, boolean>>(
    {} as Record<LegalDocumentSlug, boolean>,
  );
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [portalPending, setPortalPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const tiersResponse = await fetch("/api/stripe/tiers", { cache: "no-store" });
      const tiersData = await tiersResponse.json();
      if (!tiersResponse.ok) throw new Error(tiersData.error ?? "Could not load support options.");
      setOptions(tiersData.options);
      setMembership(tiersData.membership ?? null);
      setPendingDocuments(tiersData.pendingDocuments);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load support options.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Payment recovery: a player landing back here from Stripe's hosted page.
  // Shares the same server-side idempotent fulfillment/sync the webhook
  // uses, so a refresh of this exact URL is always safe.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");
    if (payment !== "success" || !sessionId) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/stripe/checkout-session/verify?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not verify the payment.");
          if (data.membership) setMembership(data.membership);
          setNotice(data.paid ? "Thank you for supporting StackChips." : "Your payment is still processing.");
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not verify the payment."))
        .finally(() => {
          params.delete("payment");
          params.delete("session_id");
          const query = params.toString();
          window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const allChecked = pendingDocuments.length > 0 && pendingDocuments.every((doc) => checked[doc.slug]);

  const acceptAndContinue = async () => {
    if (!allChecked) return;
    setError(null);
    try {
      const response = await fetch("/api/legal/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: pendingDocuments.map((doc) => doc.slug) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not record your acceptance.");
      setPendingDocuments([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record your acceptance.");
    }
  };

  const support = async (tierKey: string, billing: SupportBilling) => {
    if (pendingKey) return;
    const key = `${tierKey}:${billing}`;
    setPendingKey(key);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gameId ? { tierKey, billing, gameId } : { tierKey, billing }),
      });
      const data = await response.json();
      if (!response.ok) {
        // 412 means the accept step above did not actually clear server-side
        // (a second tab, a stale page) -- send them back through it rather
        // than showing a bare error for something they thought they did.
        if (response.status === 412 && data.pendingAcceptances) {
          await load();
          throw new Error(data.error ?? "Please accept the Terms first.");
        }
        throw new Error(data.error ?? "Could not start checkout.");
      }
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start checkout.");
      setPendingKey(null);
    }
  };

  const manageMembership = async () => {
    if (portalPending) return;
    setPortalPending(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/portal-session", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not open the membership portal.");
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the membership portal.");
      setPortalPending(false);
    }
  };

  const backHref = gameId ? `/?table=${gameId}` : "/";
  const disclosure = LEGAL_DOCUMENTS.support_disclosure;
  const activeMembership = membership && membership.status !== "canceled" ? membership : null;
  const membershipTier = activeMembership ? options.find((tier) => tier.key === activeMembership.tierKey) : undefined;

  return (
    <main className="support-panel-shell">
      <header className="support-panel-header">
        <div>
          <h1>Support StackChips</h1>
          <p>{disclosure.body[0]}</p>
        </div>
        <Link className="support-panel-back" href={backHref}>← Back</Link>
      </header>

      {error && <p className="support-panel-error">{error}</p>}
      {notice && <p className="support-panel-notice">{notice}</p>}

      {!loading && pendingDocuments.length > 0 && (
        <div className="support-panel-legal">
          <h2><ShieldCheck size={16} /> Before you continue</h2>
          {pendingDocuments.map((doc) => (
            <div className="support-panel-legal-doc" key={doc.slug}>
              <h3>{doc.title}</h3>
              {/* One line up front, the rest tucked behind a toggle -- see
                  GoldStore's identical block for why. */}
              <p className="support-panel-legal-summary">{doc.body[0]}</p>
              {doc.body.length > 1 && (
                <details className="support-panel-legal-details">
                  <summary>Read the rest</summary>
                  {doc.body.slice(1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                </details>
              )}
              <label className="support-panel-legal-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(checked[doc.slug])}
                  onChange={(event) => setChecked((current) => ({ ...current, [doc.slug]: event.target.checked }))}
                />
                <span>I have read and agree to the {doc.title}.</span>
              </label>
            </div>
          ))}
          <button
            type="button"
            className="primary-action"
            disabled={!allChecked}
            onClick={() => { selectSound(); void acceptAndContinue(); }}
          >
            Continue
          </button>
        </div>
      )}

      {!loading && pendingDocuments.length === 0 && (
        <>
          {activeMembership && (
            <div className="support-panel-membership">
              <div className={`support-panel-membership-body${activeMembership.status === "past_due" ? " is-past-due" : ""}`}>
                <strong>{membershipTier?.label ?? activeMembership.tierKey} member</strong>
                <span>
                  {activeMembership.status === "past_due"
                    ? "Payment failed — update your card to keep your membership."
                    : activeMembership.cancelAtPeriodEnd && activeMembership.currentPeriodEnd
                      ? `Ends ${new Date(activeMembership.currentPeriodEnd).toLocaleDateString()}`
                      : activeMembership.currentPeriodEnd
                        ? `Renews ${new Date(activeMembership.currentPeriodEnd).toLocaleDateString()}`
                        : "Active"}
                </span>
              </div>
              <button
                type="button"
                className="support-panel-membership-manage"
                disabled={portalPending}
                onClick={() => { selectSound(); void manageMembership(); }}
              >
                {portalPending ? "Opening…" : "Manage membership"}
              </button>
            </div>
          )}

          <div className="support-panel-tiers">
            {options.map((tier) => (
              <div className="support-panel-tier" key={tier.key}>
                <h3>{tier.label}</h3>
                <p>{tier.description}</p>
                <div className="support-panel-tier-buttons">
                  <button
                    type="button"
                    className="support-panel-tier-buy"
                    disabled={pendingKey !== null || !tier.oneTime}
                    onClick={() => { selectSound(); void support(tier.key, "one_time"); }}
                  >
                    {pendingKey === `${tier.key}:one_time`
                      ? "Redirecting…"
                      : tier.oneTime
                        ? `One-time · ${formatPrice(tier.oneTime.unitAmount, tier.oneTime.currency)}`
                        : "One-time unavailable"}
                  </button>
                  <button
                    type="button"
                    className="support-panel-tier-monthly"
                    disabled={pendingKey !== null || !tier.monthly}
                    onClick={() => { selectSound(); void support(tier.key, "monthly"); }}
                  >
                    {pendingKey === `${tier.key}:monthly`
                      ? "Redirecting…"
                      : tier.monthly
                        ? `Monthly · ${formatPrice(tier.monthly.unitAmount, tier.monthly.currency)}/mo`
                        : "Monthly unavailable"}
                  </button>
                </div>
              </div>
            ))}
            {options.length === 0 && !loading && (
              <p className="support-panel-empty">Support options are not available right now.</p>
            )}
          </div>

          <footer className="support-panel-footer">
            <HeartHandshake size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {disclosure.body[1]}{" "}
            <Link href={legalDocumentPath("support_disclosure")}>Read the full disclosure</Link>
          </footer>
        </>
      )}
    </main>
  );
}
