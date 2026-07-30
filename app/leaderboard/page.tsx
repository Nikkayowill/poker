import type { Metadata } from "next";
import { Leaderboard } from "@/components/leaderboard/leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard · StackChips",
};

export default function LeaderboardPage() {
  return <Leaderboard />;
}
