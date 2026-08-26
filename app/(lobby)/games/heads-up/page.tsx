import type { Metadata } from "next";
import { HeadsUpShell } from "@/components/heads-up/heads-up-shell";

export const metadata: Metadata = {
  title: "Heads-Up Poker · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/heads-up -- the parens are not a path segment. */
export default function HeadsUpPage() {
  return <HeadsUpShell />;
}
