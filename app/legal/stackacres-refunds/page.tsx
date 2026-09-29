import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "StackAcres Refund Policy · StackChips",
  description: "When you can get a StackAcres purchase refunded.",
};

export default function StackAcresRefundsPage() {
  return <LegalPage slug="stackacres_refund_policy" />;
}
