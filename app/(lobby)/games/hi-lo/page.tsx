import type { Metadata } from "next";
import { HiLoTable } from "@/components/arcade/hi-lo-table";

export const metadata: Metadata = {
  title: "Hi-Lo · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/hi-lo -- the parens are not a path segment. */
export default function HiLoPage() {
  return <HiLoTable />;
}
