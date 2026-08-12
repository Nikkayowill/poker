import type { Metadata } from "next";
import { DuelShell } from "@/components/pvp/duel-shell";
import { ChessBoard } from "@/components/pvp/chess-board";

export const metadata: Metadata = {
  title: "Chess · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/chess -- the parens are not a path segment. */
export default function ChessDuelPage() {
  return (
    <DuelShell
      game="chess"
      title="Chess"
      rules="White moves first. Checkmate, or take the clock, and the whole pot is yours."
      Board={ChessBoard}
    />
  );
}
