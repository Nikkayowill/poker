import type { Metadata } from "next";
import { BlackjackTable } from "@/components/arcade/blackjack-table";

export const metadata: Metadata = {
  title: "Blackjack 21 · StackChips",
};

/**
 * `(lobby)` is a route group, so the URL is /games/blackjack -- the parens
 * are not a path segment. It exists to give the arcade games somewhere to
 * sit together without nesting them under the lobby's own URL.
 */
export default function BlackjackPage() {
  return <BlackjackTable />;
}
