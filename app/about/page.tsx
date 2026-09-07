import type { Metadata } from "next";
import { AboutPage } from "@/components/info/about-page";

export const metadata: Metadata = {
  title: "About · StackChips",
  description:
    "What StackChips is — poker, 1v1 skill duels, cribbage and puzzles on one Gold wallet — and who's behind it.",
};

export default function Page() {
  return <AboutPage />;
}
