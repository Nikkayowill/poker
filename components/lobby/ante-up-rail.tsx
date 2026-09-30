"use client";

import { ArrowRight } from "lucide-react";
import type { ArcadeGame, ArcadeWallet } from "@/lib/arcade/games";
import { tapSound } from "@/lib/audio/ui-sounds";
import { RailGameCard } from "./rail-game-card";

/**
 * A short sideways row of the arcade on the Play tab, so the games are
 * visible without a tab change. The full catalogue is still the Ante Up tab,
 * which "All N games" switches to.
 *
 * The games and the count come from `playRailGames`, never written down here,
 * for the reason lib/arcade/games.ts gives about counts.
 */
export function AnteUpRail({
  cards,
  total,
  wallet,
  onSeeAll,
}: {
  cards: ArcadeGame[];
  total: number;
  wallet: ArcadeWallet;
  onSeeAll: () => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="mshell-section" aria-labelledby="mshell-anteup-heading">
      <div className="mshell-section-head">
        <h2 id="mshell-anteup-heading" className="lobby-kicker">Ante Up</h2>
        <button type="button" className="mshell-section-link" onClick={() => { tapSound(); onSeeAll(); }}>
          All {total} games
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="mshell-rail">
        {cards.map((game) => (
          <RailGameCard key={game.id} game={game} wallet={wallet} />
        ))}
      </div>
    </section>
  );
}
