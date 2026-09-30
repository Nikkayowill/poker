"use client";

import Link from "next/link";
import { GamePreview } from "@/components/arcade/game-preview";
import { markEmbeddedFloorNav } from "@/components/arcade/floor-back-link";
import { arcadeBlockedReason, type ArcadeGame, type ArcadeWallet } from "@/lib/arcade/games";
import { gameOnSound } from "@/lib/audio/ui-sounds";

/**
 * One game on the Play tab's rails: its board preview on a dark screen, the
 * name, and whether it is a solo game or a duel.
 *
 * Opens the game's own page, where the stake or wager is chosen, the same as
 * the Ante Up floor's cards. The marker tells that page's back link to return
 * here with history rather than to /games. A game the player cannot afford
 * renders inert with the reason, so the rail never offers a tap that only
 * leads to a refusal.
 *
 * prefetch={false}: the rail is on screen from the moment the shell mounts,
 * and a default link would prefetch every game's route on that alone.
 */
export function RailGameCard({ game, wallet }: { game: ArcadeGame; wallet: ArcadeWallet }) {
  const blocked = arcadeBlockedReason(game, wallet);
  const isDuel = game.kind === "duel";
  const body = (
    <>
      <span className="mshell-game-screen">
        <GamePreview id={game.id} />
      </span>
      <strong>{game.name}</strong>
      <small className={isDuel ? "mshell-game-kind mshell-game-kind-duel" : "mshell-game-kind"}>
        {blocked === "insufficient-gold" ? "Low Gold" : isDuel ? "Duel" : "Solo"}
      </small>
    </>
  );

  if (blocked === null && game.href) {
    return (
      <Link
        className="mshell-card mshell-game-card"
        href={game.href}
        prefetch={false}
        onClick={() => {
          gameOnSound();
          markEmbeddedFloorNav();
        }}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="mshell-card mshell-game-card mshell-row-locked" aria-disabled="true">
      {body}
    </div>
  );
}
