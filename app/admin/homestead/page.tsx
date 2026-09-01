import type { Metadata } from "next";
import { HomesteadFarm } from "@/components/arcade/homestead/homestead-farm";

export const metadata: Metadata = {
  title: "Homestead (unreleased) — StackChips admin",
  robots: { index: false, follow: false },
};

/**
 * The Homestead lives under /admin while it is finished but not being
 * offered, and it lives there for a concrete reason rather than a tidiness
 * one: the admin session cookie is scoped `path=/api/admin`, so it is only
 * ever sent to routes under that path. A staff-only game mounted at
 * /api/homestead could not read the cookie that authorises it, which means
 * the gate would refuse staff as well as everyone else -- verified by curl
 * before this moved.
 *
 * Widening the cookie to `/` was the other way to fix that, and it is the
 * wrong one: the narrow path is what keeps the admin credential off ordinary
 * traffic, which is the same reasoning that moved admin auth off a request
 * header in the first place (see lib/server/admin-auth.ts).
 *
 * This page is not itself gated, and does not need to be. It matches how
 * /admin already behaves: the page renders for anyone, and the API behind it
 * refuses without a session, so a stranger gets the locked state and nothing
 * else. Every route that moves Gold is gated; see lib/server/staff-gate.ts.
 */
export default function AdminHomesteadPage() {
  return <HomesteadFarm />;
}
