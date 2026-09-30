import type { Metadata } from "next";
import { BrainLightsOut } from "@/components/arcade/brain-lights-out";

export const metadata: Metadata = {
  title: "Lights Out · StackChips",
};

export default function LightsOutPage() {
  return <BrainLightsOut />;
}
