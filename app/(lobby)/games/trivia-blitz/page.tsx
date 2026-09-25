import type { Metadata } from "next";
import { BrainTriviaBlitz } from "@/components/arcade/brain-trivia-blitz";

export const metadata: Metadata = {
  title: "Trivia Blitz · StackChips",
};

export default function TriviaBlitzPage() {
  return <BrainTriviaBlitz />;
}
