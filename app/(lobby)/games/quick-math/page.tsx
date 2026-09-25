import type { Metadata } from "next";
import { BrainQuickMath } from "@/components/arcade/brain-quick-math";

export const metadata: Metadata = {
  title: "Quick Math Sprint · StackChips",
};

export default function QuickMathPage() {
  return <BrainQuickMath />;
}
