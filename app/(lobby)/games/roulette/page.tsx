import type { Metadata } from "next";
import { RouletteTable } from "@/components/arcade/roulette-table";

export const metadata: Metadata = {
  title: "Roulette · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/roulette -- the parens are not a path segment. */
export default function RoulettePage() {
  return <RouletteTable />;
}
