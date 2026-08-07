import type { Metadata } from "next";
import { CoinFlipTable } from "@/components/arcade/coin-flip-table";

export const metadata: Metadata = {
  title: "Coin Flip · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/coin-flip -- the parens are not a path segment. */
export default function CoinFlipPage() {
  return <CoinFlipTable />;
}
