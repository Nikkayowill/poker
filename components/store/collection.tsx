"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Coins } from "lucide-react";
import {
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

  if (item.image && !failed) {
    // next/image rather than a plain tag: the source artwork is high
    // resolution but displayed at ~120px here and ~40px at a seat, so
    // letting Next resize and re-encode it is the difference between a
    // few kilobytes and a few megabytes per avatar.
    return (
      <Image
        src={item.image}
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
                    <div className="cosmetic-art-frame">
                      <CosmeticArt item={item} />
                      {isEquipped && <span className="equipped-flag">Equipped</span>}
                    </div>
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
                            onClick={() => void act(item, "purchase")}
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
