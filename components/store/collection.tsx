"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Coins } from "lucide-react";
import {
  avatarFigure,
  rarityLabels,
  CHIP_DESIGN_DENOMINATIONS,
  type ChipDesignDenomination,
  type Cosmetic,
  type CosmeticSlot,
  type EquippedCosmetics,
} from "@/lib/cosmetics/catalog";
import { seatArtCharacter, seatArtSrc } from "@/lib/scene/seat-art";
import type { PlayerProfile } from "@/lib/profile/types";
import { CardBackArt } from "@/components/card-back-art";
import { ChipDesignArt } from "@/components/store/chip-design-art";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";

/** Casino shorthand for a denomination -- "the 5s", "the 25s". */
const CHIP_DENOMINATION_LABELS: Record<ChipDesignDenomination, string> = {
  1: "1s",
  5: "5s",
  25: "25s",
  100: "100s",
};

interface UnlockStats {
  handsWon: number;
  totalChipsWon: number;
}

/** How close a player is to a progress-gated avatar, for display only. The server is the only place this is enforced. */
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
  {
    slot: "chipDesign",
    title: "Chip designs",
    blurb: "Own as many as you like, then assign one to each denomination below.",
  },
];

type AcquisitionGroup = "default" | "earned" | "bought";

// Avatars split three ways by how you get them -- rarity already lines up
// 1:1 with this for characters (standard = default, signature = earned,
// rare = bought), it's just never been the axis the page grouped on. Card
// backs have no earned tier today, so they stay one flat grid rather than
// forcing a two-way split that would just restate the rarity tag.
const ACQUISITION_GROUPS: { key: AcquisitionGroup; title: string; blurb: string }[] = [
  { key: "default", title: "Default", blurb: "Every account starts with these." },
  { key: "earned", title: "Earned", blurb: "Unlocked by playing -- no Gold spent." },
  { key: "bought", title: "Bought", blurb: "Purchased with Gold." },
];

/**
 * The single-equip slots' key on `EquippedCosmetics`, or null for
 * `chipDesign`, which isn't a single equip -- see that field's own comment.
 */
function equippedKeyFor(slot: CosmeticSlot): "cardBack" | "avatar2d" | null {
  if (slot === "avatar") return "avatar2d";
  if (slot === "cardBack") return "cardBack";
  return null;
}

function acquisitionGroup(item: Cosmetic): AcquisitionGroup {
  if (item.unlock) return "earned";
  if (typeof item.price === "number" && item.price > 0) return "bought";
  return "default";
}

/**
 * Artwork for one item. Avatars are supplied images; card backs are drawn.
 * A missing image file falls back rather than showing a broken icon, so
 * catalog entries can ship before their artwork.
 *
 * `angle` only matters for an avatar backed by the seat-art roster: the
 * preview dialog passes the angle its own switcher has selected so a buyer
 * can see the character turned before spending Gold on it. The grid card
 * never passes one and always shows the 0deg plate.
 */
function CosmeticArt({ item, angle }: { item: Cosmetic; angle?: number }) {
  const [failed, setFailed] = useState(false);

  if (item.art) return <CardBackArt art={item.art} className="cosmetic-art" />;

  if (item.slot === "chipDesign" && item.chip) {
    return <ChipDesignArt material={item.chip} className="cosmetic-art cosmetic-art-chip" />;
  }

  if (item.slot === "avatar" && !failed) {
    // The same plate the seat-art bucket draws at the table, not a
    // separately-sized "figure" derivative. This is the card someone
    // decides to spend Gold on, and what they are buying is the exact
    // character who'll sit at their seat.
    return (
      <Image
        src={angle !== undefined ? seatArtSrc(item.id, angle) : avatarFigure(item.id)}
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
  const [previewAngle, setPreviewAngle] = useState(0);
  const [assigningDenomination, setAssigningDenomination] = useState<ChipDesignDenomination | null>(null);
  // Which of the three slots is on screen. The page used to stack all three
  // full sections top to bottom, which made "just look at chip designs" a
  // scroll past however many avatars and card backs a profile has amassed.
  const [activeSlot, setActiveSlot] = useState<CosmeticSlot>(SLOTS[0].slot);

  const ownedSet = useMemo(() => new Set(owned), [owned]);

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

  const assign = async (denomination: ChipDesignDenomination, cosmeticId: string | null) => {
    if (assigningDenomination !== null) return;
    setAssigningDenomination(denomination);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/cosmetics/chip-designs/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ denomination, cosmeticId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "That didn't work.");
      setEquipped(data.equipped);
      setNotice(cosmeticId ? "Chip design assigned." : "Back to the house default.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work.");
    } finally {
      setAssigningDenomination(null);
    }
  };

  const balance = profile?.goldBalance ?? 0;
  const unlimited = profile?.unlimitedGold ?? false;

  return (
    <main className="collection-shell">
      <header className="collection-header">
        <div>
          {/* .lobby-kicker is the chrome's one micro-label (10px, .25em),
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

      <div className="collection-tabs" role="tablist" aria-label="Cosmetic category">
        {SLOTS.map(({ slot, title }) => (
          <button
            key={slot}
            type="button"
            role="tab"
            aria-selected={activeSlot === slot}
            className={activeSlot === slot ? "is-active" : undefined}
            onClick={() => { tapSound(); setActiveSlot(slot); }}
          >
            {title}
          </button>
        ))}
      </div>

      {confirming && (
        <div className="confirm-overlay" role="presentation" onClick={() => { tapSound(); setConfirming(null); }}>
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
              <button type="button" className="cosmetic-action" onClick={() => { tapSound(); setConfirming(null); }}>
                Cancel
              </button>
              <button
                type="button"
                className="cosmetic-action cosmetic-buy"
                onClick={() => { selectSound(); void act(confirming, "purchase"); }}
              >
                Buy it
              </button>
            </div>
          </div>
        </div>
      )}

      {previewing && (
        <div className="confirm-overlay" role="presentation" onClick={() => { tapSound(); setPreviewing(null); }}>
          <div
            className="confirm-dialog preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="preview-art-frame">
              <CosmeticArt item={previewing} angle={previewing.slot === "avatar" ? previewAngle : undefined} />
            </div>
            {(() => {
              // Only avatars backed by the seat-art roster have more than one
              // angle to switch between; a single-angle character (today,
              // every one of character6-11) gets no row at all rather than a
              // button with nothing to switch to. It grows in on its own
              // the moment a wider turn ships, no code change here needed.
              if (previewing.slot !== "avatar") return null;
              const angles = seatArtCharacter(previewing.id)?.angles;
              if (!angles || angles.length < 2) return null;
              return (
                <div className="preview-angle-switch" role="group" aria-label="Preview angle">
                  {[...angles].sort((a, b) => a - b).map((angle) => (
                    <button
                      key={angle}
                      type="button"
                      className={`preview-angle-button${angle === previewAngle ? " is-active" : ""}`}
                      aria-pressed={angle === previewAngle}
                      onClick={() => { tapSound(); setPreviewAngle(angle); }}
                    >
                      {angle}°
                    </button>
                  ))}
                </div>
              );
            })()}
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
              <button type="button" className="cosmetic-action" onClick={() => { tapSound(); setPreviewing(null); }}>
                Close
              </button>
              {owned.includes(previewing.id) && equippedKeyFor(previewing.slot) !== null && equipped?.[
                equippedKeyFor(previewing.slot)!
              ] !== previewing.id && (
                <button
                  type="button"
                  className="cosmetic-action cosmetic-buy"
                  onClick={() => {
                    selectSound();
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
                    selectSound();
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

      {SLOTS.filter(({ slot }) => slot === activeSlot).map(({ slot, title, blurb }) => {
        const items = catalog
          .filter((item) => item.slot === slot)
          // Owned items first so a player sees what's theirs before the
          // store pitch; a stable sort keeps each group in its original
          // rarity order rather than reshuffling within owned/unowned.
          .sort((a, b) => Number(ownedSet.has(b.id)) - Number(ownedSet.has(a.id)));
        if (items.length === 0) return null;

        const groups: { key: string; title: string | null; blurb: string | null; items: Cosmetic[] }[] =
          slot === "avatar"
            ? ACQUISITION_GROUPS
                .map((group) => ({ ...group, items: items.filter((item) => acquisitionGroup(item) === group.key) }))
                .filter((group) => group.items.length > 0)
            : [{ key: slot, title: null, blurb: null, items }];

        return (
          <section key={slot} className="collection-section">
            <h2>{title}</h2>
            <p className="collection-blurb">{blurb}</p>
            {groups.map((group) => (
              <div key={group.key} className={group.title ? "collection-subsection" : undefined}>
                {group.title && (
                  <h3 className="collection-subsection-head">
                    {group.title}
                    <span className="collection-subsection-blurb">{group.blurb}</span>
                  </h3>
                )}
                <div className="cosmetic-grid">
                  {group.items.map((item) => {
                const isOwned = owned.includes(item.id);
                const equipmentKey = equippedKeyFor(item.slot);
                const isEquipped = equipmentKey !== null && equipped?.[equipmentKey] === item.id;
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
                      onClick={() => { tapSound(); setPreviewAngle(0); setPreviewing(item); }}
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
                      ? item.slot === "chipDesign"
                        ? <span className="cosmetic-locked">Owned -- assign it below</span>
                        : (
                          <button
                            type="button"
                            className="cosmetic-action"
                            disabled={busy || isEquipped}
                            onClick={() => { selectSound(); void act(item, "equip"); }}
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
                            onClick={() => { selectSound(); setConfirming(item); }}
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
              </div>
            ))}
          </section>
        );
      })}

      {activeSlot === "chipDesign" && catalog.some((item) => item.slot === "chipDesign") && (
        <section className="collection-section">
          <h2>Assign chip designs</h2>
          <p className="collection-blurb">
            Pick which owned design shows on your own bet and stack chips at each denomination.
            An unassigned denomination stays the house look -- everyone at the table sees your choices.
          </p>
          <div className="chip-assign-grid">
            {CHIP_DESIGN_DENOMINATIONS.map((denomination) => {
              const ownedDesigns = catalog.filter(
                (item) => item.slot === "chipDesign" && owned.includes(item.id),
              );
              const current = equipped?.chipDesigns?.[denomination] ?? "";
              return (
                <div key={denomination} className="chip-assign-row">
                  <span className="chip-assign-label">{CHIP_DENOMINATION_LABELS[denomination]}</span>
                  <select
                    className="chip-assign-select"
                    value={current}
                    disabled={assigningDenomination === denomination}
                    onChange={(event) => {
                      selectSound();
                      void assign(denomination, event.target.value || null);
                    }}
                  >
                    <option value="">House default</option>
                    {ownedDesigns.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
