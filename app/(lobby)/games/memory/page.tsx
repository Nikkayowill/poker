import type { Metadata } from "next";
import { MemoryBoard } from "@/components/arcade/memory-board";

export const metadata: Metadata = {
  title: "Memory Match · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/memory -- the parens are not a path segment. */
export default function MemoryPage() {
  return <MemoryBoard />;
}
