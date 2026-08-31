import type { Metadata } from "next";
import { WordStackArchive } from "@/components/arcade/word-stack-archive";

export const metadata: Metadata = {
  title: "Word Stack Archive · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/word-stack/archive -- the parens are not a path segment. */
export default function WordStackArchivePage() {
  return <WordStackArchive />;
}
