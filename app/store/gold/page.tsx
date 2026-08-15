import type { Metadata } from "next";
import { GoldStore } from "@/components/store/gold-store";

export const metadata: Metadata = {
  title: "Buy Gold",
};

export default async function GoldStorePage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const { table } = await searchParams;
  return <GoldStore gameId={table} />;
}
