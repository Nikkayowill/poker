import type { Metadata } from "next";
import { DuelShell } from "@/components/pvp/duel-shell";
import { OthelloBoard } from "@/components/pvp/othello-board";

export const metadata: Metadata = {
  title: "Othello · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/othello -- the parens are not a path segment. */
export default function OthelloDuelPage() {
  return (
    <DuelShell
      game="othello"
      title="Othello"
      rules="Every disc you place has to trap a line of theirs. Hold the most when neither of you can move, and the pot is yours."
      Board={OthelloBoard}
    />
  );
}
