import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service · StackChips",
  description: "StackChips Terms of Service.",
};

export default function TermsPage() {
  return <LegalPage slug="terms_of_service" />;
}
