import type { Metadata } from "next";
import { AnteUpWordFillIn } from "@/components/arcade/ante-up-word-fill-in";

export const metadata: Metadata = {
  title: "Word Fill-In · StackChips",
  description: "Fit every word from the list into the grid. No clues. Wager Gold, or play free.",
};

export default function WordFillInPage() {
  return <AnteUpWordFillIn />;
}
