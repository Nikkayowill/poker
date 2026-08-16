"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";

/**
 * The one place "support StackChips" lives outside the Gold economy: a small
 * heart in the corner of the nav, not a row of text sitting next to Buy Gold.
 * The two used to read as two competing stores in the same dropdown -- Buy
 * Gold is the actual store (hub tile, player menu, in-game menu); this is a
 * separate, quieter ask, so it gets its own quiet affordance instead.
 */
export function DonateButton({ gameId }: { gameId?: string }) {
  const href = gameId ? `/store?table=${gameId}` : "/store";
  return (
    <Link className="donate-button" href={href} aria-label="Support StackChips" onClick={tapSound}>
      <Heart size={15} />
    </Link>
  );
}
