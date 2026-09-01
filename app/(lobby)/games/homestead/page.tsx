import type { Metadata } from "next";
import { cookies } from "next/headers";
import { HomesteadFarm } from "@/components/arcade/homestead/homestead-farm";
import { HomesteadLock } from "@/components/arcade/homestead/homestead-lock";
import { isHomesteadUnlocked } from "@/lib/server/homestead-access";

export const metadata: Metadata = {
  title: "StackChips Homestead",
  robots: { index: false, follow: false },
};

/**
 * On the floor, behind a code.
 *
 * The tile is visible to everyone now, so this page no longer answers 404 --
 * hiding a route the arcade openly advertises would only make a locked door
 * look like a bug. It renders the code prompt instead, and the API behind it
 * refuses independently, so the prompt is a courtesy rather than the lock.
 *
 * Reading the cookie here makes this page dynamic, which it needs to be
 * anyway: a cached "enter the code" page served to someone who already has
 * the pass would lock them out of their own farm.
 */
export default async function HomesteadPage() {
  const store = await cookies();
  const unlocked = isHomesteadUnlocked((name) => store.get(name)?.value);

  return unlocked ? <HomesteadFarm /> : <HomesteadLock />;
}
