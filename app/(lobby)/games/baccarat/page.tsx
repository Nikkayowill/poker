import type { Metadata } from "next";
import { BaccaratTable } from "@/components/arcade/baccarat-table";

export const metadata: Metadata = {
  title: "Baccarat · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/baccarat -- the parens are not a path segment. */
export default function BaccaratPage() {
  return <BaccaratTable />;
}
