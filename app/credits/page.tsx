import type { Metadata } from "next";
import { CreditsPage } from "@/components/info/credits-page";

export const metadata: Metadata = {
  title: "Credits · StackChips",
  description: "Where StackAcres' generated, licensed, and unsourced art and audio came from.",
};

export default function Page() {
  return <CreditsPage />;
}
