import type { Metadata } from "next";
import { cookies } from "next/headers";
import { StackAcresFarm } from "@/components/arcade/stackacres/stackacres-farm";
import { stackAcresDisplay } from "@/components/arcade/stackacres/stackacres-font";
import { StackAcresLock } from "@/components/arcade/stackacres/stackacres-lock";
import { tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { findProfileBySessionToken } from "@/lib/server/profile-store";
import { readSessionTokenFromCookies } from "@/lib/server/session";

export const metadata: Metadata = {
  // Route, modules and name now all read StackAcres -- see
  // components/brand/stackacres-logo.tsx for the mark itself.
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
export default async function StackAcresPage() {
  const store = await cookies();
  const token = readSessionTokenFromCookies((name) => store.get(name)?.value);
  const allowed = await tokenHasStackAcresAccess(token);

  const profile = allowed ? null : token ? await findProfileBySessionToken(token) : null;

  /**
   * `.sa-theme` is where the farm's whole visual world is declared (the
   * material tokens, the radii, the lift depths -- see
   * app/styles/52-stackacres.css) and `stackAcresDisplay.variable` is what
   * puts Baloo 2 behind `--font-sa-display` for everything inside it.
   *
   * It wraps the page rather than living on `.sa-shell` because two of the
   * farm's own screens are not inside `.sa-shell`: the tap-to-play splash
   * replaces it outright, and the store sheet and Ray's welcome are
   * `position: fixed`. Custom properties and `font-family` both inherit
   * through `display: contents`, so this wrapper themes all of them while
   * adding no box of its own to a layout that is measured in dvh.
   */
  return (
    <div className={`sa-theme ${stackAcresDisplay.variable}`}>
      {allowed ? <StackAcresFarm /> : <StackAcresLock playerId={profile?.id ?? null} />}
    </div>
  );
}
