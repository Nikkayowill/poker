import type { Metadata } from "next";
import { ConnectionsBoard } from "@/components/arcade/connections-board";

export const metadata: Metadata = {
  title: "Connections · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/connections -- the parens are not a path segment. */
export default function ConnectionsPage() {
  return <ConnectionsBoard />;
}
