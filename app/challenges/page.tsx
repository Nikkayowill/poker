import type { Metadata } from "next";
import { ChallengesFloor } from "@/components/missions/challenges-floor";

export const metadata: Metadata = {
  title: "Challenges · StackChips",
  description: "Daily and weekly objectives -- Gold credits itself the moment one completes.",
};

export default function ChallengesPage() {
  return <ChallengesFloor />;
}
