import type { Metadata } from "next";
import { CribbageShell } from "@/components/cribbage/cribbage-shell";
import { CribbageBoard } from "@/components/cribbage/cribbage-board";

export const metadata: Metadata = {
  title: "Cribbage · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/cribbage -- the parens are not a path segment. */
export default function CribbagePage() {
  return <CribbageShell Board={CribbageBoard} />;
}
