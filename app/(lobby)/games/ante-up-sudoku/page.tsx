import type { Metadata } from "next";
import { AnteUpSudoku } from "@/components/arcade/ante-up-sudoku";

export const metadata: Metadata = {
  title: "Ante Up: Sudoku · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/ante-up-sudoku -- the parens are not a path segment. */
export default function AnteUpSudokuPage() {
  return <AnteUpSudoku />;
}
