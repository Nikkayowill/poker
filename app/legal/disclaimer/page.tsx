import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "App Disclaimer · StackChips",
  description: "StackChips app disclaimer and service limitations.",
};

export default function DisclaimerPage() {
  return <LegalPage slug="app_disclaimer" />;
}
