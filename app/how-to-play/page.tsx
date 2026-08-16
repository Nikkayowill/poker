import type { Metadata } from "next";
import { HowToPlayPage } from "@/components/info/how-to-play-page";

export const metadata: Metadata = {
  title: "How to Play · StackChips",
  description: "Six-max Texas Hold'em rules, hand rankings, and how duels work.",
};

export default function Page() {
  return <HowToPlayPage />;
}
