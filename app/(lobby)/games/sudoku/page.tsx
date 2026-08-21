import type { Metadata } from "next";
import { AnteUpSudoku } from "@/components/arcade/ante-up-sudoku";

export const metadata: Metadata = {
  title: "Sudoku · StackChips",
};

/**
 * `(lobby)` is a route group, so the URL is /games/sudoku -- the parens are
 * not a path segment.
 *
 * This used to render a separate free-only daily board with its own once-a-
 * day gate. As of 2026-08-21 Sudoku has no daily gate at all -- wager or play
 * free, any time -- so /games/sudoku IS the Ante Up Sudoku experience now
 * rather than a sibling of it. See CLAUDE.md's 2026-08-21 note.
 */
export default function SudokuPage() {
  return <AnteUpSudoku />;
}
