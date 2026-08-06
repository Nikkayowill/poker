import type { Metadata } from "next";
import { WordleBoard } from "@/components/arcade/wordle-board";

export const metadata: Metadata = {
  title: "Daily Wordle · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/wordle -- the parens are not a path segment. */
export default function WordlePage() {
  return <WordleBoard />;
}
