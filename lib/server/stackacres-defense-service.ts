import "server-only";
import { ArcadeRequestError } from "./arcade-request";
import { ensureProfile } from "./profile-store";
import { FENCE_TIER_MAX_DURABILITY, nextFenceTier } from "@/lib/stackacres/wildlife";
import { ZONE_IDS, type ZoneId } from "@/lib/stackacres/zones";
import {
  getFenceSegment,
  writeFenceSegment,
  type StoredFenceSegment,
} from "./stackacres-defense-store";

/**
 * The fence-upgrade action: the one write the UI hook-up (see
 * stackacres-fence-upgrade-popup.tsx) actually calls. Everything else this
 * feature persists -- the predator wave, livestock health -- is written
 * directly through lib/server/stackacres-defense-store.ts's own functions by
 * whatever future route wires the live wave sync in (see
 * wildlife-manager.ts's own header for that stated scope cut); a fence
 * upgrade is the one player-initiated action this pass ships end to end.
 *
 * Takes a token, not a profile id, matching stackacres-service.ts's own
 * convention for every player-facing action -- `ensureProfile` is the same
 * resolver every other StackAcres action uses.
 */

export type StackAcresDefenseRefusalReason = "already-max-tier";

export class StackAcresDefenseRequestError extends ArcadeRequestError<
  StoredFenceSegment,
  StackAcresDefenseRefusalReason
> {
  readonly name = "StackAcresDefenseRequestError";
}

/** Read-only: what the fence-upgrade popup opens with. Never null -- a
 *  segment nobody has ever touched reads as Basic Wood, version 0, the
 *  same default the store itself returns. */
export async function getStackAcresFenceSegment(
  token: string,
  zoneInput: string,
  segmentIndex: number,
): Promise<StoredFenceSegment> {
  const zone = requireZone(zoneInput);
  const profile = await ensureProfile(token);
  return getFenceSegment(profile.id, zone, segmentIndex);
}

function requireZone(value: string): ZoneId {
  if (!(ZONE_IDS as readonly string[]).includes(value)) {
    throw new StackAcresDefenseRequestError("There is no such place.", 400);
  }
  return value as ZoneId;
}

/**
 * Upgrades one fence bay to the next tier up, guarded on the version the
 * caller last saw (0 for a bay nobody has ever touched, matching the
 * store's own default). A lost race (someone else's tap landed first, or
 * the segment moved between read and write) throws the same 409 shape
 * every other version-guarded StackAcres action does, carrying the segment
 * AS IT NOW STANDS so the popup can re-render from truth rather than retry
 * blind.
 */
export async function upgradeStackAcresFenceSegment(
  token: string,
  zoneInput: string,
  segmentIndex: number,
  expectedVersion: number,
): Promise<StoredFenceSegment> {
  const zone = requireZone(zoneInput);
  const profile = await ensureProfile(token);

  const current = await getFenceSegment(profile.id, zone, segmentIndex);
  const next = nextFenceTier(current.tier);
  if (!next) {
    throw new StackAcresDefenseRequestError("This fence line is already Steel Mesh.", 409, {
      reason: "already-max-tier",
      round: current,
    });
  }

  const written = await writeFenceSegment(profile.id, zone, segmentIndex, expectedVersion, next, FENCE_TIER_MAX_DURABILITY[next]);
  if (!written) {
    const fresh = await getFenceSegment(profile.id, zone, segmentIndex);
    throw new StackAcresDefenseRequestError("Someone already changed that fence line -- try again.", 409, {
      round: fresh,
    });
  }
  return written;
}
