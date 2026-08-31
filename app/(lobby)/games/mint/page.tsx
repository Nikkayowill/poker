import type { Metadata } from "next";
import { MintTreasury } from "@/components/arcade/mint/mint-treasury";

export const metadata: Metadata = {
  title: "Sovereign Mint — StackChips",
  description: "Stake Gold into timed nodes and come back to harvest more.",
};

export default function MintPage() {
  return <MintTreasury />;
}
