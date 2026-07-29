"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Coins } from "lucide-react";
import {
  avatarFigure,
  rarityLabels,
  type Cosmetic,
  type CosmeticSlot,
  type EquippedCosmetics,
} from "@/lib/cosmetics/catalog";
import type { PlayerProfile } from "@/lib/profile/types";
import { CardBackArt } from "./card-back-art";

const SLOTS: { slot: CosmeticSlot; title: string; blurb: string }[] = [
  { slot: "avatar", title: "Avatars", blurb: "Who you are at the table." },
  { slot: "cardBack", title: "Card backs", blurb: "Seen by the whole table, on every hidden hand." },
];

/**
 * Artwork for one item. Avatars are supplied images; card backs are drawn.
 * A missing image file falls back rather than showing a broken icon, so
 * catalog entries can ship before their artwork.
 */
function CosmeticArt({ item }: { item: Cosmetic }) {
  const [failed, setFailed] = useState(false);

  if (item.art) return <CardBackArt art={item.art} className="cosmetic-art" />;

  if (item.slot === "avatar" && !failed) {
    // The whole figure here, not the head crop the seat plate uses. This is
    // the card someone decides to spend Gold on, and what they are buying is
    // a person sitting at a table -- the jacket, the posture and the hands on
    // the rail are the product.
    return (
      <Image
        src={avatarFigure(item.id)}
        alt=""
        fill
        sizes="(max-width: 640px) 40vw, 160px"
        className="cosmetic-art-image"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="cosmetic-art cosmetic-art-pending" aria-hidden="true">
      <span>Artwork<br />coming soon</span>
    </div>
  );
}

export function Collection() {
  const [catalog, setCatalog] = useState<Cosmetic[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Cosmetic | null>(null);
  const [previewing, setPreviewing] = useState<Cosmetic | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/cosmetics", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the collection.");
      setCatalog(data.cosmetics);
      setOwned(data.owned);
      setEquipped(data.equipped);
      setProfile(data.profile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the collection.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (item: Cosmetic, path: "purchase" | "equip") => {
    // Spending Gold is irreversible, so a second click while one request is
    // already in flight must not start another.
    if (pendingId) return;
    setConfirming(null);
    setPendingId(item.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/cosmetics/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cosmeticId: item.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "That didn't work.");
      if (path === "purchase") {
        setOwned(data.owned);
        setProfile(data.profile);
        setNotice(`${item.name} is yours.`);
      } else {
        setEquipped(data.equipped);
        setNotice(`${item.name} equipped.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work.");
    } finally {
      setPendingId(null);
    }
  };

  const balance = profile?.goldBalance ?? 0;
  const unlimited = profile?.unlimitedGold ?? false;

  return (
    <main className="collection-shell">
      <header className="collection-header">
        <div>
          <h1>Collection</h1>
          <p>Everything here is cosmetic. Nothing you buy changes a card.</p>
        </div>
        <div className="collection-header-actions">
          <span className="collection-balance">
            <Coins size={15} />
            <strong>{unlimited ? "Unlimited" : balance.toLocaleString()}</strong>
          </span>
          <Link className="collection-back" href="/">← Back to the table</Link>
        </div>
      </header>

      {error && <p className="collection-error">{error}</p>}
      {notice && <p className="collection-notice">{notice}</p>}

      {confirming && (
        <div className="confirm-overlay" role="presentation" onClick={() => setConfirming(null)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-title">Buy {confirming.name}?</h2>
            <p>
              This spends <strong>{confirming.price!.toLocaleString()}</strong> Gold.
              {!unlimited && (
                <> You&rsquo;ll have <strong>{(balance - confirming.price!).toLocaleString()}</strong> left.</>
              )}
            </p>
            <div className="confirm-actions">
              <button type="button" className="cosmetic-action" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cosmetic-action cosmetic-buy"
                onClick={() => void act(confirming, "purchase")}
              >
                Buy it
              </button>
            </div>
          </div>
        </div>
      )}

      {previewing && (
        <div className="confirm-overlay" role="presentation" onClick={() => setPreviewing(null)}>
          <div
            className="confirm-dialog preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="preview-art-frame">
              <CosmeticArt item={previewing} />
            </div>
            <h2 id="preview-title">{previewing.name}</h2>
            <p>{previewing.description}</p>
            <div className="confirm-actions">
              <button type="button" className="cosmetic-action" onClick={() => setPreviewing(null)}>
                Close
              </button>
              {owned.includes(previewing.id) && equipped?.[previewing.slot] !== previewing.id && (
                <button
                  type="button"
                  className="cosmetic-action cosmetic-buy"
                  onClick={() => {
                    setPreviewing(null);
                    void act(previewing, "equip");
                  }}
                >
                  Equip
                </button>
              )}
              {!owned.includes(previewing.id) && typeof previewing.price === "number" && previewing.price > 0 && (
                <button
                  type="button"
                  className="cosmetic-action cosmetic-buy"
                  disabled={!unlimited && balance < previewing.price}
                  onClick={() => {
                    setPreviewing(null);
                    setConfirming(previewing);
                  }}
                >
                  <Coins size={13} /> {previewing.price.toLocaleString()}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {SLOTS.map(({ slot, title, blurb }) => {
        const items = catalog.filter((item) => item.slot === slot);
        if (items.length === 0) return null;
        return (
          <section key={slot} className="collection-section">
            <h2>{title}</h2>
            <p className="collection-blurb">{blurb}</p>
            <div className="cosmetic-grid">
              {items.map((item) => {
                const isOwned = owned.includes(item.id);
                const isEquipped = equipped?.[slot] === item.id;
                const forSale = typeof item.price === "number" && item.price > 0;
                const affordable = unlimited || balance >= (item.price ?? 0);
                const busy = pendingId === item.id;

                return (
                  <article
                    key={item.id}
                    className={`cosmetic-card rarity-${item.rarity}${isEquipped ? " is-equipped" : ""}`}
                  >
                    <button
                      type="button"
                      className="cosmetic-art-frame cosmetic-art-preview"
                      onClick={() => setPreviewing(item)}
                      aria-label={`Preview ${item.name}`}
                    >
                      <CosmeticArt item={item} />
                      {isEquipped && <span className="equipped-flag">Equipped</span>}
                      {!isOwned && <span className="preview-flag">Preview</span>}
                    </button>
                    <div className="cosmetic-meta">
                      <strong>{item.name}</strong>
                      <span className={`rarity-tag rarity-${item.rarity}`}>{rarityLabels[item.rarity]}</span>
                    </div>
                    <p className="cosmetic-desc">{item.description}</p>

                    {isOwned
                      ? (
                        <button
                          type="button"
                          className="cosmetic-action"
                          disabled={busy || isEquipped}
                          onClick={() => void act(item, "equip")}
                        >
                          {isEquipped ? "Equipped" : busy ? "…" : "Equip"}
                        </button>
                      )
                      : forSale
                        ? (
                          <button
                            type="button"
                            className="cosmetic-action cosmetic-buy"
                            disabled={busy || !affordable}
                            onClick={() => setConfirming(item)}
                            title={affordable ? undefined : "Not enough Gold"}
                          >
                            {busy ? "…" : <><Coins size={13} /> {item.price!.toLocaleString()}</>}
                          </button>
                        )
                        : (
                          // Signature items are earned. Saying so plainly beats
                          // a disabled price that implies a number would buy it.
                          <span className="cosmetic-locked">Earned, not sold</span>
                        )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}
