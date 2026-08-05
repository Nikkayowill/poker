"use client";

import { useState } from "react";
import clsx from "clsx";
import { Coins } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";

function isSameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

export function GoldBadge({
  profile,
  onClaimed,
}: {
  profile: PlayerProfile;
  onClaimed: (profile: PlayerProfile) => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);
  const canClaim = !profile.lastDailyClaimAt || !isSameUtcDay(new Date(profile.lastDailyClaimAt), new Date());

  const claim = async () => {
    if (claiming || !canClaim) return;
    setClaiming(true);
    try {
      const response = await fetch("/api/profile/gold/claim", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not claim your daily Gold.");
      onClaimed(data.profile);
      setJustClaimed(true);
      window.setTimeout(() => setJustClaimed(false), 900);
    } catch {
      // Best-effort: the button simply stays available so they can try again.
    } finally {
      setClaiming(false);
    }
  };

  // An unlimited profile is never charged and never credited, so a running
  // total would be a number that never means anything -- and a daily claim
  // would top up a balance that is already irrelevant.
  if (profile.unlimitedGold) {
    return (
      <div className="gold-badge">
        <span className="gold-balance">
          <Coins size={14} />
          <strong title="This profile plays for free">Unlimited</strong>
        </span>
      </div>
    );
  }

  return (
    <div className={clsx("gold-badge", justClaimed && "gold-badge-claimed")}>
      <span className="gold-balance">
        <Coins size={14} />
        <strong>{(profile.goldBalance ?? 0).toLocaleString()}</strong>
      </span>
      <button
        type="button"
        className="gold-claim-button"
        disabled={!profile.isRegistered || !canClaim || claiming}
        title={profile.isRegistered ? undefined : "Save your progress to unlock the daily reward"}
        onClick={claim}
      >
        {!profile.isRegistered
          ? "Save to claim"
          : canClaim ? "Claim daily Gold" : "Claimed today"}
      </button>
    </div>
  );
}
