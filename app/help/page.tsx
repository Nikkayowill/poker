import type { Metadata } from "next";
import { HelpPage } from "@/components/info/help-page";

export const metadata: Metadata = {
  title: "Help · StackChips",
  description: "Frequently asked questions, and how to reach support.",
};

export default function Page() {
  return <HelpPage />;
}
