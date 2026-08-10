import { chipBreakdown, type ChipDenomination } from "./denominations";
import { pushStyleFor } from "./chip-push";
import type { PushStyle } from "./chip-trajectory";
import { handLaunchPosition, type Vec3 } from "./seat-layout";

export interface RendererBetFlightHandoff {
  id: string;
  slot: number;
  amount: number;
}

export interface ResumedBetFlight {
  key: string;
  kind: "bet";
  amount: number;
  chips: ChipDenomination[];
  style: PushStyle;
  /** Where the chips left from. The slots they are landing in are resolved
   * per render against whatever is already resting at the bet spot, exactly
   * as an ordinary bet's are — see chip-field.tsx. */
  hand: Vec3;
  slot: number;
}

/** Rebuild an airborne bet when WebGL mounts without a previous snapshot. */
export function resumedBetFlight(flight: RendererBetFlightHandoff): ResumedBetFlight {
  return {
    key: `resume-${flight.id}`,
    kind: "bet",
    amount: flight.amount,
    chips: chipBreakdown(flight.amount),
    // The handoff carries no action label — the snapshot that named it is
    // exactly what this bridge exists because the room did not receive — so
    // a resumed bet takes the neutral middle style rather than guessing a
    // raise's harder cadence.
    style: pushStyleFor("bet"),
    hand: handLaunchPosition(flight.slot),
    slot: flight.slot,
  };
}
