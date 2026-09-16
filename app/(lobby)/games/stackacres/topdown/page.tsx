import type { Metadata } from "next";
import { cookies } from "next/headers";
import { stackAcresDisplay } from "@/components/arcade/stackacres/stackacres-font";
import { StackAcresLock } from "@/components/arcade/stackacres/stackacres-lock";
import { StackAcresTopdownFarmDynamic } from "@/components/arcade/stackacres-td/stackacres-td-dynamic";
import { tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { findProfileBySessionToken } from "@/lib/server/profile-store";
import { readSessionTokenFromCookies } from "@/lib/server/session";

/** Same dev-only opt-in as /games/stackacres; see that page. */
const STACKACRES_DEV_BYPASS_ACCESS =
  process.env.NODE_ENV !== "production" && process.env.STACKACRES_DEV_BYPASS_ACCESS === "1";

export const metadata: Metadata = {
  title: "StackAcres",
  robots: { index: false, follow: false },
};

/**
 * The top-down rewrite of StackAcres, on the player's real farm.
 *
 * Not linked from the arcade floor: a URL to test the new world at, beside
 * the live isometric one at /games/stackacres, until it replaces it. It is the
 * same farm shell (StackAcresFarm) with `worldView="topdown"`, so it reads and
 * writes the same farm through the same API, behind the same access list, and
 * locked visitors get the same "ask for access" card. See
 * art/stackacres-td/HANDOFF.md for what the top-down world draws so far.
 */
export default async function StackAcresTopdownPage() {
  const store = await cookies();
  const token = readSessionTokenFromCookies((name) => store.get(name)?.value);
  const allowed = STACKACRES_DEV_BYPASS_ACCESS ? true : await tokenHasStackAcresAccess(token);
  const profile = allowed ? null : token ? await findProfileBySessionToken(token) : null;

  return (
    <div className={`sa-theme ${stackAcresDisplay.variable}`}>
      {allowed ? <StackAcresTopdownFarmDynamic /> : <StackAcresLock playerId={profile?.id ?? null} />}
    </div>
  );
}
