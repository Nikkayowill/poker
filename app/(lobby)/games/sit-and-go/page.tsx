import type { Metadata } from "next";
import { SitAndGoShell } from "@/components/sit-and-go/sit-and-go-shell";

export const metadata: Metadata = {
  title: "Sit & Go · StackChips",
};

/** `(lobby)` is a route group, so the URL is /games/sit-and-go -- the parens are not a path segment. */
export default function SitAndGoPage() {
  return <SitAndGoShell />;
}
