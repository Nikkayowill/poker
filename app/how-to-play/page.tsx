import type { Metadata } from "next";
import { HowToPlayPage } from "@/components/info/how-to-play-page";

export const metadata: Metadata = {
  title: "How to Play · StackChips",
  description:
    "Six-max Texas Hold'em rules and hand rankings, plus how duels, cribbage and the Ante Up puzzles are played.",
};

export default function Page() {
  return <HowToPlayPage />;
}
