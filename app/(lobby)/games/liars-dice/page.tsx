import type { Metadata } from "next";
import { DuelShell } from "@/components/pvp/duel-shell";
import { LiarsDiceBoard } from "@/components/pvp/liars-dice-board";

export const metadata: Metadata = {
  title: "Liar's Dice · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/liars-dice. */
export default function LiarsDiceDuelPage() {
  return (
    <DuelShell
      game="liars-dice"
      title="Liar's Dice"
      rules="Bid on how many of one face sit across both hands, or call their bid a bluff. Whoever is wrong loses a die, and the last player holding dice takes the pot."
      Board={LiarsDiceBoard}
    />
  );
}
