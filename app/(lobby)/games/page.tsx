import type { Metadata } from "next";
import { ArcadeFloor } from "@/components/arcade/arcade-floor";

export const metadata: Metadata = {
  title: "Ante Up · StackChips",
  // No count. This said "Ten games" and was already wrong twice over by the
  // time anyone read it -- the 2026-08-12 retirement removed five and the
  // duels added four. The page itself counts the catalogue every render
  // (arcadeFloorSummary); a number written down here cannot follow it, which
  // is the exact failure lib/arcade/games.ts's header records three times.
  description: "Solo boards, head-to-head duels and Blackjack, beside the tables.",
};

/**
 * The arcade index. `(lobby)` is a route group, so the URL is /games -- the
 * parens are not a path segment, which is also why this file is a sibling of
 * the individual machines rather than a layout above them.
 */
export default function ArcadeFloorPage() {
  return <ArcadeFloor />;
}
