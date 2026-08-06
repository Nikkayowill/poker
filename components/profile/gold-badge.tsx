"use client";

import clsx from "clsx";
import { Coins } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * The navbar's Gold: a coin, a number, and nothing else.
 *
 * It used to carry the daily-claim button beside the balance, which meant the
 * header's right-hand side was a number, a yellow button reading "Claim daily
 * Gold" / "Claimed today" / "Save to claim", and an avatar. Two of those three
 * labels were a control that could not do anything -- "Save to claim" in
 * particular was a disabled button whose entire job was to advertise a signup,
 * next to a player menu that already offers "Save progress" in words.
 *
 * The claim moved into that menu (see components/poker-app.tsx), where it is a
 * labelled row rather than a permanent fixture, and what stays here is a dot:
 * the balance is the thing worth reading at a glance, and a dot is enough to
 * say there is more of it waiting.
 */
export function GoldBadge({
  profile,
  claimable = false,
  justClaimed = false,
}: {
  profile: PlayerProfile;
  /** Daily Gold is waiting. The action itself lives in the player menu. */
  claimable?: boolean;
  /** Flashes the number once, right after a claim lands. */
  justClaimed?: boolean;
}) {
  // An unlimited profile is never charged and never credited, so a running
  // total would be a number that never means anything.
  const balance = profile.unlimitedGold
    ? <strong title="This profile plays for free">Unlimited</strong>
    : <strong>{(profile.goldBalance ?? 0).toLocaleString()}</strong>;

  return (
    <div className={clsx("gold-badge", justClaimed && "gold-badge-claimed")}>
      <span className="gold-balance">
        <Coins size={14} />
        {balance}
      </span>
      {claimable && (
        <span
          className="gold-badge-dot"
          title="Your daily Gold is ready -- claim it from the player menu"
          aria-label="Daily Gold is ready to claim"
          role="status"
        />
      )}
    </div>
  );
}
