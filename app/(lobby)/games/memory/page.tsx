import type { Metadata } from "next";
import { AnteUpMemory } from "@/components/arcade/ante-up-memory";

export const metadata: Metadata = {
  title: "Memory Match · StackChips",
};

/**
 * `(lobby)` is a route group, so the URL is /games/memory -- the parens are
 * not a path segment.
 *
 * This used to render a separate free-only daily board with its own once-a-
 * day gate. As of 2026-08-21 Memory Match has no daily gate at all -- wager
 * or play free, any time -- so /games/memory IS the Ante Up Memory experience
 * now rather than a sibling of it. See CLAUDE.md's 2026-08-21 note.
 */
export default function MemoryPage() {
  return <AnteUpMemory />;
}
