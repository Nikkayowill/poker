import type { Metadata } from "next";
import { DuelShell } from "@/components/pvp/duel-shell";
import { CheckersBoard } from "@/components/pvp/checkers-board";

export const metadata: Metadata = {
  title: "Checkers · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/checkers -- the parens are not a path segment. */
export default function CheckersDuelPage() {
  return (
    <DuelShell
      game="checkers"
      title="Checkers"
      rules="Jumps are forced. Take every piece or leave them nothing to move, and the pot is yours."
      Board={CheckersBoard}
    />
  );
}
