import type { Metadata } from "next";
import { SudokuBoard } from "@/components/arcade/sudoku-board";

export const metadata: Metadata = {
  title: "Daily Sudoku · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/sudoku -- the parens are not a path segment. */
export default function SudokuPage() {
  return <SudokuBoard />;
}
