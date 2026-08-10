import { chipBreakdown, type ChipDenomination } from "./denominations";
import { betSpotPosition, seatPosition, type Vec3 } from "./seat-layout";

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
  from: Vec3;
  to: Vec3;
  slot: number;
}

/** Rebuild an airborne bet when WebGL mounts without a previous snapshot. */
export function resumedBetFlight(flight: RendererBetFlightHandoff): ResumedBetFlight {
  const seat = seatPosition(flight.slot);
  return {
    key: `resume-${flight.id}`,
    kind: "bet",
    amount: flight.amount,
    chips: chipBreakdown(flight.amount),
    // The same hand-height launch used by ordinary 3D bets.
    from: { x: seat.x * 0.82, y: 1.05, z: seat.z * 0.82 },
    to: betSpotPosition(flight.slot),
    slot: flight.slot,
  };
}
