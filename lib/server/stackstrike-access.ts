import "server-only";
import { hasStackStrikeAccess } from "./profile-store";

/**
 * Who may open StackStrike while it is a private prototype.
 *
 * A LIST OF PEOPLE, KEPT IN THE ADMIN DASHBOARD, exactly like the StackAcres
 * list (lib/server/stackacres-access.ts): `profiles.stackstrike_access`,
 * default false, written only by /api/admin/stackstrike-access. Shipping it
 * admits nobody until somebody is granted, including whoever deployed it.
 *
 * Unlike the StackAcres this is not advertised: the Play tile only shows for
 * a profile that has the flag, and the page answers 404 to everyone else.
 *
 * This costs a database read, so a route that calls it must rate limit first.
 */
export async function tokenHasStackStrikeAccess(token: string | null): Promise<boolean> {
  if (!token) return false;
  return hasStackStrikeAccess(token);
}
