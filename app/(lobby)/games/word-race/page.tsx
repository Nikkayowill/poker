import type { Metadata } from "next";
import { DuelShell } from "@/components/pvp/duel-shell";
import { WordRaceBoard } from "@/components/pvp/word-race-board";

export const metadata: Metadata = {
  title: "Word Race · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/word-race -- the parens are not a path segment. */
export default function WordRaceDuelPage() {
  return (
    <DuelShell
      game="word-race"
      title="Word Race"
      rules="Same scrambled word, both of you. First to solve it takes the round."
      Board={WordRaceBoard}
    />
  );
}
