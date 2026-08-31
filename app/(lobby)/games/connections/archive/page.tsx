import type { Metadata } from "next";
import { ConnectionsArchive } from "@/components/arcade/connections-archive";

export const metadata: Metadata = {
  title: "Connections Archive · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/connections/archive -- the parens are not a path segment. */
export default function ConnectionsArchivePage() {
  return <ConnectionsArchive />;
}
