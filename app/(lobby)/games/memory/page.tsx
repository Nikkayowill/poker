import type { Metadata } from "next";
import { AnteUpMemory } from "@/components/arcade/ante-up-memory";

export const metadata: Metadata = {
  title: "Memory Match · StackChips",
};

/**
 * `(lobby)` is a route group, so the URL is /games/memory; the parens are
 * not a path segment.
 *
 * Memory Match has no daily gate: wager or play free, any time. So
 * /games/memory IS the Ante Up Memory experience rather than a sibling of
 * it. See CLAUDE.md for the history.
 */
export default function MemoryPage() {
  return <AnteUpMemory />;
}
