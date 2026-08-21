import type { Metadata } from "next";
import { AnteUpWordStack } from "@/components/arcade/ante-up-word-stack";

export const metadata: Metadata = {
  title: "Ante Up: Word Stack · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/ante-up-word-stack -- the parens are not a path segment. */
export default function AnteUpWordStackPage() {
  return <AnteUpWordStack />;
}
