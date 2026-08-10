"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Coins } from "lucide-react";
import {
  avatarFigure,
  characterThumbnail,
  rarityLabels,
  type Cosmetic,
  type CosmeticSlot,
  type EquippedCosmetics,
} from "@/lib/cosmetics/catalog";
import { characterById } from "@/lib/game3d/characters";
import type { PlayerProfile } from "@/lib/profile/types";
import { CardBackArt } from "@/components/card-back-art";
import { Character3DPreview } from "./character-3d-preview";

interface UnlockStats {
  handsWon: number;
  totalChipsWon: number;
}

/** How close a player is to a progress-gated avatar, for display only -- the server is the only place this is enforced. */
function unlockProgress(item: Cosmetic, stats: UnlockStats | null): { current: number; goal: number; label: string } | null {
  if (!item.unlock || !stats) return null;
  if ("handsWon" in item.unlock) {
    return { current: stats.handsWon, goal: item.unlock.handsWon, label: "hands won" };
  }
  return { current: stats.totalChipsWon, goal: item.unlock.chipsWon, label: "Gold won" };
}

const SLOTS: { slot: CosmeticSlot; title: string; blurb: string }[] = [
  { slot: "avatar", title: "Avatars", blurb: "Who you are at the table." },
  { slot: "cardBack", title: "Card backs", blurb: "Seen by the whole table, on every hidden hand." },
];

/**
 * Artwork for one item. Avatars are supplied images; card backs are drawn.
 * A missing image file falls back rather than showing a broken icon, so
 * catalog entries can ship before their artwork.
 */
function CosmeticArt({ item, show3D = false }: { item: Cosmetic; show3D?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (item.art) return <CardBackArt art={item.art} className="cosmetic-art" />;

  if (item.renderMode === "3d") {
    const character = characterById(item.id);
    if (show3D && character) return <Character3DPreview character={character} />;
    return (
      <Image
        src={characterThumbnail(item.id)}
        alt=""
        fill
        sizes="(max-width: 640px) 40vw, 160px"
        className="cosmetic-art-image"
      />
    );
  }

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
    <div className="cosmetic-art cosmetic-art-fallback" aria-hidden="true">
      <span>{item.name.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

export function Collection() {
  const [catalog, setCatalog] = useState<Cosmetic[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [stats, setStats] = useState<UnlockStats | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Cosmetic | null>(null);
  const [previewing, setPreviewing] = useState<Cosmetic | null>(null);
  const [avatarView, setAvatarView] = useState<"2d" | "3d">("2d");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/cosmetics", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the collection.");
      setCatalog(data.cosmetics);
      setOwned(data.owned);
      setEquipped(data.equipped);
      setProfile(data.profile);
      setStats(data.stats);
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
          {/* .lobby-kicker is the chrome's one micro-label (10px, .25em) --
              the same class the hub head and the landing eyebrow use. Its
              name is from where it first appeared, not from where it is
              allowed to appear. */}
          <div className="lobby-kicker">Cosmetics</div>
          <h1>Your collection.</h1>
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
              <CosmeticArt item={previewing} show3D />
            </div>
            <h2 id="preview-title">{previewing.name}</h2>
            <p>{previewing.description}</p>
            {!owned.includes(previewing.id) && (() => {
              const progress = unlockProgress(previewing, stats);
              if (!progress) return null;
              const pct = Math.min(100, Math.round((progress.current / progress.goal) * 100));
              return (
                <div className="cosmetic-unlock-progress">
                  <div className="cosmetic-unlock-bar">
                    <div className="cosmetic-unlock-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span>{progress.current.toLocaleString()} / {progress.goal.toLocaleString()} {progress.label}</span>
                </div>
              );
            })()}
            <div className="confirm-actions">
              <button type="button" className="cosmetic-action" onClick={() => setPreviewing(null)}>
                Close
              </button>
              {owned.includes(previewing.id) && equipped?.[
                previewing.slot === "avatar"
                  ? previewing.renderMode === "3d" ? "avatar3d" : "avatar2d"
                  : previewing.slot
              ] !== previewing.id && (
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
        const items = catalog.filter((item) =>
          item.slot === slot &&
          (slot !== "avatar" || (item.renderMode ?? "2d") === avatarView),
        );
        if (items.length === 0) return null;
        return (
          <section key={slot} className="collection-section">
            <h2>{title}</h2>
            <p className="collection-blurb">{blurb}</p>
            {slot === "avatar" && (
              <div className="collection-view-switch" role="tablist" aria-label="Character style">
                <button
                  type="button"
                  role="tab"
                  aria-selected={avatarView === "2d"}
                  className={avatarView === "2d" ? "is-active" : ""}
                  onClick={() => setAvatarView("2d")}
                >
                  2D characters
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={avatarView === "3d"}
                  className={avatarView === "3d" ? "is-active" : ""}
                  onClick={() => setAvatarView("3d")}
                >
                  3D characters
                </button>
              </div>
            )}
            <div className="cosmetic-grid">
              {items.map((item) => {
                const isOwned = owned.includes(item.id);
                const equipmentKey = item.slot === "avatar"
                  ? item.renderMode === "3d" ? "avatar3d" : "avatar2d"
                  : item.slot;
                const isEquipped = equipped?.[equipmentKey] === item.id;
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
                        : (() => {
                          const progress = unlockProgress(item, stats);
                          // Signature items are earned with no visible progress
                          // bar (a specific moment, not a grind). Premium-tier
                          // avatars carry a real threshold, so show how close
                          // this profile actually is to it.
                          if (!progress) {
                            return <span className="cosmetic-locked">Earned, not sold</span>;
                          }
                          const pct = Math.min(100, Math.round((progress.current / progress.goal) * 100));
                          return (
                            <div className="cosmetic-unlock-progress" title={`${progress.current.toLocaleString()} / ${progress.goal.toLocaleString()} ${progress.label}`}>
                              <div className="cosmetic-unlock-bar">
                                <div className="cosmetic-unlock-fill" style={{ width: `${pct}%` }} />
                              </div>
                              <span>{progress.current.toLocaleString()} / {progress.goal.toLocaleString()} {progress.label}</span>
                            </div>
                          );
                        })()}
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
