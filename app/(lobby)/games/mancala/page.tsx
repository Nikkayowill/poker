import type { Metadata } from "next";
import { DuelShell } from "@/components/pvp/duel-shell";
import { MancalaBoard } from "@/components/pvp/mancala-board";

export const metadata: Metadata = {
  title: "Mancala · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/mancala. */
export default function MancalaDuelPage() {
  return (
    <DuelShell
      game="mancala"
      title="Mancala"
      rules="Pick up a pit and sow its seeds one by one toward your store. Land the last seed in your store to go again, or in an empty pit on your side to capture the pit across; most seeds in the store when a row runs dry takes the pot."
      Board={MancalaBoard}
    />
  );
}
