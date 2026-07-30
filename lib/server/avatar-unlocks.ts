import "server-only";
import { avatarCosmetics } from "@/lib/cosmetics/catalog";
import { awardCosmetic, listOwnedCosmetics } from "./cosmetics-store";
import { getPlayerStanding } from "./stats-store";

const unlockable = avatarCosmetics.filter((item) => item.unlock);

/**
 * Awards any avatar whose lifetime hands-won or chips-won threshold a
 * profile has just crossed. Called after recordHandStats persists a hand's
 * result, for the specific profiles that hand touched -- not a sweep of
 * every player, since only their own stats could have changed.
 *
 * Best-effort in the same sense as recordHandStats itself: an unlock that
 * lands a moment late because this failed is invisible to the player, so a
 * failure here must never surface as a broken poker action. Callers wrap
 * this in a catch that only logs, same as they do for recordHandStats.
 */
export async function checkAvatarUnlocks(profileIds: string[]): Promise<void> {
  if (unlockable.length === 0) return;
  for (const profileId of profileIds) {
    const standing = await getPlayerStanding(profileId, "lifetime");
    if (!standing) continue;
    const owned = await listOwnedCosmetics(profileId);
    for (const item of unlockable) {
      if (owned.includes(item.id)) continue;
      const unlock = item.unlock!;
      const met = "handsWon" in unlock
        ? standing.stats.handsWon >= unlock.handsWon
        : standing.stats.totalChipsWon >= unlock.chipsWon;
      if (met) await awardCosmetic(profileId, item.id);
    }
  }
}
