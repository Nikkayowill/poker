import type { Metadata } from "next";
import { AnteUpMemory } from "@/components/arcade/ante-up-memory";

export const metadata: Metadata = {
  title: "Ante Up: Memory Match · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/ante-up-memory -- the parens are not a path segment. */
export default function AnteUpMemoryPage() {
  return <AnteUpMemory />;
}
