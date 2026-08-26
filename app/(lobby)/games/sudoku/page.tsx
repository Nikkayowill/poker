import type { Metadata } from "next";
import { AnteUpSudoku } from "@/components/arcade/ante-up-sudoku";

export const metadata: Metadata = {
  title: "Sudoku · StackChips",
};

/**
 * `(lobby)` is a route group, so the URL is /games/sudoku; the parens are
 * not a path segment.
 *
 * Sudoku has no daily gate: wager or play free, any time. So /games/sudoku
 * IS the Ante Up Sudoku experience rather than a sibling of it. See
 * CLAUDE.md for the history.
 */
export default function SudokuPage() {
  return <AnteUpSudoku />;
}
