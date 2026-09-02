import type { Metadata } from "next";
import { AnteUpNonogram } from "@/components/arcade/ante-up-nonogram";

export const metadata: Metadata = {
  title: "Nonogram — StackChips",
  description: "Read the numbers, draw the picture. Wager Gold, or play free.",
};

export default function NonogramPage() {
  return <AnteUpNonogram />;
}
