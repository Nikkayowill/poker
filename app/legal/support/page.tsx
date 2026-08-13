import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Supporting StackChips · StackChips",
  description: "What a StackChips support payment does and doesn't do.",
};

export default function SupportPage() {
  return <LegalPage slug="support_disclosure" />;
}
