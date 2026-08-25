import type { Metadata } from "next";
import { AnteUpMinesweeper } from "@/components/arcade/ante-up-minesweeper";

export const metadata: Metadata = {
  title: "Minesweeper — StackChips",
  description: "Clear the board before the clock runs out. Wager Gold, or play free.",
};

export default function MinesweeperPage() {
  return <AnteUpMinesweeper />;
}
