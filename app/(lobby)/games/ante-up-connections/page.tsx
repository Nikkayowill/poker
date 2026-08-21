import type { Metadata } from "next";
import { AnteUpConnections } from "@/components/arcade/ante-up-connections";

export const metadata: Metadata = {
  title: "Ante Up: Connections · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/ante-up-connections -- the parens are not a path segment. */
export default function AnteUpConnectionsPage() {
  return <AnteUpConnections />;
}
