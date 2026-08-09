import type { Metadata } from "next";
import { ArcadeFloor } from "@/components/arcade/arcade-floor";

export const metadata: Metadata = {
  title: "Arcade & Puzzles · StackChips",
  description: "Ten games beside the tables — four free every day, the rest staked in Gold.",
};

/**
 * The arcade index. `(lobby)` is a route group, so the URL is /games -- the
 * parens are not a path segment, which is also why this file is a sibling of
 * the individual machines rather than a layout above them.
 */
export default function ArcadeFloorPage() {
  return <ArcadeFloor />;
}
