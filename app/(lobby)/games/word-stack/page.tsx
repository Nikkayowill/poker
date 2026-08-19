import type { Metadata } from "next";
import { WordStackBoard } from "@/components/arcade/word-stack-board";

export const metadata: Metadata = {
  title: "Daily Word Stack · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/word-stack -- the parens are not a path segment. */
export default function WordStackPage() {
  return <WordStackBoard />;
}
