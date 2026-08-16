import type { Metadata } from "next";
import { RewardsHub } from "@/components/rewards/rewards-hub";

export const metadata: Metadata = {
  title: "Rewards · StackChips",
  description: "Every way to earn or buy Gold, in one place.",
};

export default function Page() {
  return <RewardsHub />;
}
