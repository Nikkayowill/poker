import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy · StackChips",
  description: "What StackChips collects, why, and who else sees it.",
};

export default function PrivacyPage() {
  return <LegalPage slug="privacy_policy" />;
}
