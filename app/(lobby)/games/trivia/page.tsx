import type { Metadata } from "next";
import { DuelShell } from "@/components/pvp/duel-shell";
import { TriviaBoard } from "@/components/pvp/trivia-board";

export const metadata: Metadata = {
  title: "Trivia Showdown · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/trivia -- the parens are not a path segment. */
export default function TriviaDuelPage() {
  return (
    <DuelShell
      game="trivia"
      title="Trivia Showdown"
      rules="Same questions, both of you, at the same time. Most right answers takes the pot."
      Board={TriviaBoard}
    />
  );
}
