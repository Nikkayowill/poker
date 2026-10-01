import type { Metadata } from "next";
import { BrainPatternPredictor } from "@/components/arcade/brain-pattern-predictor";

export const metadata: Metadata = {
  title: "Pattern Predictor · StackChips",
};

export default function PatternPredictorPage() {
  return <BrainPatternPredictor />;
}
