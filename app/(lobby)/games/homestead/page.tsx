import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { HomesteadFarm } from "@/components/arcade/homestead/homestead-farm";
import { isHomesteadAllowed } from "@/lib/server/homestead-access";
import { readSessionTokenFromCookies } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "StackChips Homestead",
  robots: { index: false, follow: false },
};

/**
 * On production, but only for the accounts named in HOMESTEAD_ALLOWED_USER_IDS.
 *
 * The PAGE is gated here, which the admin-session version of this could not
 * do: ADMIN_SESSION_COOKIE is scoped `path=/api/admin`, so a page never
 * received it and the best that version could manage was rendering a locked
 * state for strangers. The player session cookie is `path=/`, so a server
 * component sees it and can answer a real 404 instead -- same answer as the
 * routes, so the page and the API can never disagree about who is allowed.
 *
 * The API gate is still the one that matters. This is the courtesy half: it
 * stops a stranger loading a farm UI that would only fail on every call.
 */
export default async function HomesteadPage() {
  const store = await cookies();
  const token = readSessionTokenFromCookies((name) => store.get(name)?.value);
  if (!(await isHomesteadAllowed(token))) notFound();

  return <HomesteadFarm />;
}
