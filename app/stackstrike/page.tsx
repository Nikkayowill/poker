import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { StackStrikeGame } from "@/components/stackstrike/stackstrike-game";
import { tokenHasStackStrikeAccess } from "@/lib/server/stackstrike-access";
import { readSessionTokenFromCookies } from "@/lib/server/session";

/**
 * StackDead (the game at /stackstrike) is a private prototype. Only a profile an admin has opened it
 * for (the dashboard's "Open StackDead") gets in; everyone else gets a 404,
 * because nothing advertises it. Local dev always opens it so the game runs
 * without an admin grant. The Play tiles in components/lobby show only for the
 * same profiles. Nothing else links here and robots.ts keeps crawlers out.
 *
 * Reading the cookie makes this page dynamic, which it must be: a cached 404
 * served to someone who was just granted access would shut them out.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "StackDead (preview)",
  robots: { index: false, follow: false },
  icons: { icon: "/stackstrike/icon-512.png", apple: "/stackstrike/apple-touch-icon.png" },
  openGraph: {
    title: "StackDead",
    description: "Hold the line. Survive the waves.",
    images: [{ url: "/stackstrike/thumbnail.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/stackstrike/thumbnail.png"] },
};

export default async function StackStrikePage() {
  if (process.env.NODE_ENV === "production") {
    const store = await cookies();
    const token = readSessionTokenFromCookies((name) => store.get(name)?.value);
    if (!(await tokenHasStackStrikeAccess(token))) notFound();
  }
  return <StackStrikeGame />;
}
