import type { Metadata } from "next";
import { BrainWordGuess } from "@/components/arcade/brain-word-guess";

export const metadata: Metadata = {
  title: "Word Guess · StackChips",
};

export default function WordGuessPage() {
  return <BrainWordGuess />;
}
