import type { Metadata } from "next";
import { StackStrikeGate } from "@/components/stackstrike/stackstrike-gate";

/**
 * StackStrike is not public yet. In production only a signed-in admin gets
 * past components/stackstrike/stackstrike-gate.tsx; everyone else sees a 404
 * message. Local dev always opens it. Nothing links here, it is not in the
 * arcade catalogue, and robots.ts keeps crawlers out.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "StackStrike (preview)",
  robots: { index: false, follow: false },
};

export default function StackStrikePage() {
  return <StackStrikeGate requireAdmin={process.env.NODE_ENV === "production"} />;
}
