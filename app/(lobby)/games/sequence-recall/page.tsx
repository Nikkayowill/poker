import type { Metadata } from "next";
import { BrainSequenceRecall } from "@/components/arcade/brain-sequence-recall";

export const metadata: Metadata = {
  title: "Sequence Recall · StackChips",
};

export default function SequenceRecallPage() {
  return <BrainSequenceRecall />;
}
