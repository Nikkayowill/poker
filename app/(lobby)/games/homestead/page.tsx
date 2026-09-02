import type { Metadata } from "next";
import { cookies } from "next/headers";
import { HomesteadFarm } from "@/components/arcade/homestead/homestead-farm";
import { HomesteadLock } from "@/components/arcade/homestead/homestead-lock";
import { tokenHasHomesteadAccess } from "@/lib/server/homestead-access";
import { findProfileBySessionToken } from "@/lib/server/profile-store";
import { readSessionTokenFromCookies } from "@/lib/server/session";

export const metadata: Metadata = {
  // The route stays /games/homestead (a plumbing rename is a separate,
  // deliberate pass) but the game's real name on the floor is StackAcres --
  // see components/brand/stackacres-logo.tsx.
  title: "StackAcres",
  robots: { index: false, follow: false },
};

/**
 * On the floor, open to whoever an admin has let in.
 *
 * The tile is visible to everyone, so this page does not answer 404 -- hiding
 * a route the arcade openly advertises would only make a locked door look like
 * a bug. It renders the "ask for access" card instead, and the API behind it
 * refuses independently, so this is a courtesy rather than the lock.
 *
 * Reading the cookie makes this page dynamic, which it needs to be anyway: a
 * cached locked page served to someone who has been granted access would shut
 * them out of their own farm.
 *
 * The locked card shows the visitor their own player id, because granting
 * access means finding them in the admin dashboard -- which searches on
 * exactly that id -- and "which of these thousand guests are you" is otherwise
 * an unanswerable question.
 */
export default async function HomesteadPage() {
  const store = await cookies();
  const token = readSessionTokenFromCookies((name) => store.get(name)?.value);
  const allowed = await tokenHasHomesteadAccess(token);
  if (allowed) return <HomesteadFarm />;

  const profile = token ? await findProfileBySessionToken(token) : null;
  return <HomesteadLock playerId={profile?.id ?? null} />;
}
