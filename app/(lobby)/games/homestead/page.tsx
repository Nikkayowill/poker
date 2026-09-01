import type { Metadata } from "next";
import { HomesteadFarm } from "@/components/arcade/homestead/homestead-farm";

export const metadata: Metadata = {
  title: "StackChips Homestead — StackChips",
  description: "Plant crops, raise livestock, and sell what they make for Gold.",
};

export default function HomesteadPage() {
  return <HomesteadFarm />;
}
