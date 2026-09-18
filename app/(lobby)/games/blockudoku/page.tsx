import type { Metadata } from "next";
import { AnteUpBlockudoku } from "@/components/arcade/ante-up-blockudoku";

export const metadata: Metadata = {
  title: "Blockudoku — StackChips",
  description: "Drop shapes, clear rows, columns and boxes. Wager Gold, or play free.",
};

export default function BlockudokuPage() {
  return <AnteUpBlockudoku />;
}
