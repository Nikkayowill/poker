import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Gold Purchase Disclosure · StackChips",
  description: "StackChips Gold purchase disclosure.",
};

export default function GoldDisclosurePage() {
  return <LegalPage slug="gold_disclosure" />;
}
