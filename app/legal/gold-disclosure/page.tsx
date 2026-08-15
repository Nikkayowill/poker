import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Gold Purchase Disclosure · StackChips",
  description: "What buying Gold does and doesn't do.",
};

export default function GoldDisclosurePage() {
  return <LegalPage slug="gold_disclosure" />;
}
