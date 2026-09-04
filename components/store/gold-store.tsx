"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins, ShieldCheck } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import { legalDocumentPath, type LegalDocument, type LegalDocumentSlug } from "@/lib/legal/documents";
import { selectSound } from "@/lib/audio/ui-sounds";

interface GoldTier {
  key: string;
  label: string;
  description: string;
  goldAmount: number;
  unitAmount: number;
  currency: string;
}

function formatPrice(unitAmount: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: currency.toUpperCase() }).format(unitAmount / 100);
}

/**
 * Buy Gold: two one-time tiers, any time. Reuses SupportPanel's CSS classes
 * (.support-panel-*): the layout is identical (header, legal gate, tier
 * cards, buy buttons), so a parallel stylesheet would add nothing but
 * upkeep. Distinct component and route from SupportPanel/`/store`
 * (`/store/gold`) so a Gold-purchase regression can never take the already-
 * shipped support flow down with it.
 */
export function GoldStore({ gameId }: { gameId?: string }) {
  const [tiers, setTiers] = useState<GoldTier[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<LegalDocument[]>([]);
  const [checked, setChecked] = useState<Record<LegalDocumentSlug, boolean>>(
    {} as Record<LegalDocumentSlug, boolean>,
  );
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tiersResponse, profileResponse] = await Promise.all([
        fetch("/api/stripe/gold-tiers", { cache: "no-store" }),
        fetch("/api/profile", { cache: "no-store" }),
      ]);
      // Read the profile before the tiers response can throw. A player's Gold
      // balance is real regardless of whether the store's own tiers loaded --
      // this used to sit behind the tiers check and a Stripe-side hiccup
      // there discarded an already-successful profile read, showing "0 Gold"
      // for a fully funded account.
      const profileData = await profileResponse.json().catch(() => null);
      if (profileResponse.ok && profileData?.profile) setProfile(profileData.profile);

      const tiersData = await tiersResponse.json();
      if (!tiersResponse.ok) throw new Error(tiersData.error ?? "Could not load the Gold store.");
      setTiers(tiersData.tiers);
      setPendingDocuments(tiersData.pendingDocuments);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the Gold store.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Payment recovery: a player landing back here from Stripe's hosted page.
  // Shares the same server-side idempotent fulfillment the webhook uses, so
  // a refresh of this exact URL is always safe; see the route's own
  // comment for why.
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
          if (data.profile) setProfile(data.profile);
          setNotice(data.paid ? "Payment received — your Gold is ready." : "Payment is still processing.");
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

  const buy = async (tierKey: string) => {
    if (pendingKey) return;
    setPendingKey(tierKey);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gameId ? { tierKey, gameId } : { tierKey }),
      });
      const data = await response.json();
      if (!response.ok) {
        // 412 means the accept step above did not actually clear server-side
        // (a second tab, a stale page); send them back through it rather
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

  const balance = profile?.goldBalance ?? 0;
  const unlimited = profile?.unlimitedGold ?? false;
  const backHref = gameId ? `/?table=${gameId}` : "/";

  return (
    <main className="support-panel-shell">
      <header className="support-panel-header">
        <div>
          <h1>Buy Gold</h1>
          <p>Entertainment currency only. Gold has no cash value and cannot be redeemed or exchanged for real money.</p>
        </div>
        <div className="gold-store-header-actions">
          <span className="gold-store-balance">
            <Coins size={15} />
            {/* A profile that never arrived is "we don't know yet," not "zero" --
                showing 0 here once meant a fully funded account read as broke. */}
            <strong>{unlimited ? "Unlimited" : profile ? balance.toLocaleString() : "—"}</strong>
          </span>
          <Link className="support-panel-back" href={backHref}>← Back</Link>
        </div>
      </header>

      {error && <p className="support-panel-error">{error}</p>}
      {notice && <p className="support-panel-notice">{notice}</p>}

      {!loading && pendingDocuments.length > 0 && (
        <div className="support-panel-legal">
          <h2><ShieldCheck size={16} /> Before you buy</h2>
          {pendingDocuments.map((doc) => (
            <div className="support-panel-legal-doc" key={doc.slug}>
              <h3>{doc.title}</h3>
              {/* One line up front, the rest tucked behind a toggle. Printing
                  all four documents' full paragraphs every time was the
                  "wall of text" a first-time buyer had to scroll past
                  before they could see a price. */}
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
            Continue to Gold packs
          </button>
        </div>
      )}

      {!loading && pendingDocuments.length === 0 && (
        <div className="support-panel-tiers">
          {tiers.map((tier) => (
            <div className="support-panel-tier" key={tier.key}>
              <h3>{tier.goldAmount.toLocaleString()} Gold</h3>
              <p>{tier.description}</p>
              <div className="support-panel-tier-buttons">
                <button
                  type="button"
                  className="support-panel-tier-buy"
                  disabled={pendingKey !== null}
                  onClick={() => { selectSound(); void buy(tier.key); }}
                >
                  {pendingKey === tier.key ? "Redirecting…" : formatPrice(tier.unitAmount, tier.currency)}
                </button>
              </div>
            </div>
          ))}
          {tiers.length === 0 && !loading && (
            <p className="support-panel-empty">Gold packs are not available right now.</p>
          )}
        </div>
      )}

      <footer className="support-panel-footer">
        Gold purchases aren&apos;t currently available to Washington State residents.{" "}
        <Link href={legalDocumentPath("gold_disclosure")}>Read the full disclosure</Link>
      </footer>
    </main>
  );
}
