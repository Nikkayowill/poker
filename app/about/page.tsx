import type { Metadata } from "next";
import { AboutPage } from "@/components/info/about-page";

export const metadata: Metadata = {
  title: "About · StackChips",
  description: "What StackChips is, and who's behind it.",
};

export default function Page() {
  return <AboutPage />;
}
