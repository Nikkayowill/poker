"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { comboSound } from "@/lib/audio/ui-sounds";
import { tierByNumber, type RankTier } from "@/lib/progression/rank";
import type { ProgressionPayload } from "@/lib/progression/types";
import { RankJewel } from "./rank-jewel";

/**
 * The "you reached a new tier" popup, mounted once in poker-app so it fires in
 * the lobby, the arcade and at the table alike.
 *
 * The server pays tier Gold silently inside the settle, so the client finds
 * out by looking: it re-reads /api/progression when the Gold balance changes
 * (every settle moves it) and when the tab regains focus, and compares the tier
 * with the highest one this browser has shown a popup for. The highest, not the
 * last, so a rank that falls and climbs back does not celebrate a tier that
 * paid nothing the second time.
 *
 * The first read for a profile only records where they stand. Otherwise every
 * existing player would get a popup for their current tier on first load.
 * Storage can throw or be empty (private windows), and then the popup simply
 * does not show.
 */

const keyFor = (profileId: string) => `stackchips.rank-tier-seen:${profileId}`;

function readSeen(profileId: string): number | null {
  try {
    const raw = window.localStorage.getItem(keyFor(profileId));
    const value = raw === null ? NaN : Number(raw);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSeen(profileId: string, tier: number) {
  try {
    window.localStorage.setItem(keyFor(profileId), String(tier));
  } catch {
    // Nothing to do; the popup just will not remember.
  }
}

interface TierUp {
  tier: RankTier;
  gold: number;
}

export function TierUpPopup({ profileId, goldBalance }: { profileId: string | undefined; goldBalance: number | undefined }) {
  const [tierUp, setTierUp] = useState<TierUp | null>(null);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (!profileId || checking.current) return;
    checking.current = true;
    try {
      const response = await fetch("/api/progression", { cache: "no-store" });
      if (!response.ok) return;
      const { progression } = (await response.json()) as ProgressionPayload;
      const current = progression.tier.number;
      const seen = readSeen(profileId);
      if (seen === null || current <= seen) {
        if (seen === null) writeSeen(profileId, current);
        return;
      }
      writeSeen(profileId, current);
      let gold = 0;
      for (let number = seen + 1; number <= current; number += 1) gold += tierByNumber(number).rewardGold;
      setTierUp({ tier: progression.tier, gold });
      comboSound();
    } catch {
      // A readout, not a control: a failed check just means no popup this time.
    } finally {
      checking.current = false;
    }
  }, [profileId]);

  // Deferred through a timer, like useProgression: a fetch fired straight from
  // the effect body sets state during the same commit. The pause also lets a
  // settle's Gold credit land before the tier is read.
  useEffect(() => {
    if (!profileId) return;
    const timer = window.setTimeout(() => void check(), 700);
    return () => window.clearTimeout(timer);
  }, [profileId, goldBalance, check]);

  useEffect(() => {
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  useEffect(() => {
    if (!tierUp) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") setTierUp(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tierUp]);

  if (!tierUp) return null;
  const { tier, gold } = tierUp;

  return (
    <div className="tier-up-backdrop" onClick={() => setTierUp(null)}>
      <div
        className="tier-up"
        data-tier={tier.id}
        role="dialog"
        aria-modal="true"
        aria-label={`Tier up: ${tier.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <small className="tier-up-kicker">New tier</small>
        <div className="tier-up-jewel">
          <RankJewel tier={tier.id} size={150} />
        </div>
        <strong className="tier-up-name">{tier.name}</strong>
        {gold > 0 && <span className="tier-up-gold">+{gold.toLocaleString()} Gold</span>}
        <button type="button" className="tier-up-close" autoFocus onClick={() => setTierUp(null)}>
          Nice
        </button>
      </div>
    </div>
  );
}
