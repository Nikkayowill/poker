import type { Metadata } from "next";
import { AchievementsFloor } from "@/components/achievements/achievements-floor";

export const metadata: Metadata = {
  title: "Achievements · StackChips",
  description: "Permanent Gold and cosmetic rewards for lifetime milestones.",
};

export default function AchievementsPage() {
  return <AchievementsFloor />;
}
