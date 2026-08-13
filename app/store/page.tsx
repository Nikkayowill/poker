import type { Metadata } from "next";
import { SupportPanel } from "@/components/store/support-panel";

export const metadata: Metadata = {
  title: "Support StackChips",
};

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const { table } = await searchParams;
  return <SupportPanel gameId={table} />;
}
