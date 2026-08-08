"use client";

/**
 * Every chip on the felt: standing street bets in front of each bettor, the
 * centre pot, and the flights between them.
 *
 * The choreography mirrors the 2D room's contract exactly:
 * - a bet flies from the bettor's rail to their own bet spot and rests there;
 * - when the street turns, standing bets sweep from their spots into the pot
 *   (transferred into flight from where they rested, never respawned);
 * - winners' chips funnel from the pot toward the winner;
 * - a hand boundary (new handNumber / new game) clears instantly — sweeping
 *   there would wipe the incoming blinds of the next hand.
 *
 * This file owns exactly that choreography state machine — which piles and
 * flights exist, and when — same as it always has. It no longer renders
 * any chip itself: chip-instanced-layer.tsx is the one place every chip's
 * transform gets written into GPU buffers (see that file's header for why
 * a single writer is required once chips are instanced). What changed here
 * is only the last step, turning `flights`/resting amounts into the plain
 * `piles`/`flights` arrays that layer consumes — the flight-launch diff
 * logic below, and its "compare against the frame clock" trigger, are
 * unchanged, including why it deliberately runs in `useFrame` rather than
 * an effect (see the comment on the diff below). It also mounts
 * scene/fake-shadows.tsx's chip-pile shadows here, alongside the chip
 * layer, because `piles` is already computed in this component and a
 * shadow decal's position IS a pile's position — lifting that back up to
 * poker-scene.tsx just to hand it to a sibling would be the same number
 * duplicated in two places for no reason.
 */

import { useCallback, useRef, useState } from "react";
import type { SceneModel } from "@/lib/game3d/scene-model";
import { chipBreakdown, type ChipDenomination } from "@/lib/game3d/denominations";
import {
  POT_POSITION,
  betSpotPosition,
  seatPosition,
  type Vec3,
} from "@/lib/game3d/seat-layout";
import { useFrame } from "@react-three/fiber";
import { ChipInstancedLayer, type ChipFlightInput, type RestingChipPile } from "./chip-instanced-layer";
import { FakeShadows } from "../scene/fake-shadows";

type FlightKind = "bet" | "sweep" | "award";

interface Flight {
  key: string;
  kind: FlightKind;
  amount: number;
  chips: ChipDenomination[];
  from: Vec3;
  to: Vec3;
  /** Slot whose bet spot this flight feeds (bet) or drains (sweep). */
  slot: number | null;
}

let flightSerial = 0;

function raisedLaunchPoint(slot: number): Vec3 {
  // Chips leave from the bettor's hands: just inside their seat, hand height.
  const seat = seatPosition(slot);
  return { x: seat.x * 0.82, y: 1.05, z: seat.z * 0.82 };
}

export function ChipField({
  model,
  onSeatToss,
}: {
  model: SceneModel;
  /** Called with a slot the instant that seat launches chips, for the toss pose. */
  onSeatToss: (slot: number) => void;
}) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const prevRef = useRef<SceneModel | null>(null);

  const removeFlight = useCallback((key: string) => {
    setFlights((current) => current.filter((f) => f.key !== key));
  }, []);

  // The diff runs in the frame loop, not an effect: the scene clock is the
  // external system chip choreography synchronizes with, and launching from
  // here keeps setState out of the render/effect cycle. Each frame checks
  // whether a new model arrived; the launch work happens once per snapshot.
  // Unchanged under the room's demand-mode frameloop (poker-scene.tsx):
  // `model` changing is an ordinary React prop update, which R3F's own
  // reconciler already invalidates for one frame on its own — see
  // scene/demand-loop.ts's header — so this plain `useFrame` still gets a
  // tick the moment a new snapshot lands, with no `useDemandFrame` needed.
  useFrame(() => {
    if (prevRef.current === model) return;
    const prev = prevRef.current;
    prevRef.current = model;
    if (!prev) return;

    // Hand boundary: clear instantly, never sweep. A trailing sweep here
    // would wipe the next hand's just-posted blinds.
    if (prev.gameId !== model.gameId || prev.handNumber !== model.handNumber) {
      setFlights([]);
      return;
    }

    const launched: Flight[] = [];
    const streetTurned = prev.street !== model.street;

    if (streetTurned) {
      for (const seat of prev.seats) {
        if (seat.streetBet > 0) {
          launched.push({
            key: `sweep-${flightSerial++}`,
            kind: "sweep",
            amount: seat.streetBet,
            chips: chipBreakdown(seat.streetBet),
            from: betSpotPosition(seat.slot),
            to: POT_POSITION,
            slot: seat.slot,
          });
        }
      }
    }

    for (const seat of model.seats) {
      const before = streetTurned
        ? 0
        : prev.seats.find((s) => s.id === seat.id)?.streetBet ?? 0;
      const delta = seat.streetBet - before;
      if (delta > 0) {
        launched.push({
          key: `bet-${flightSerial++}`,
          kind: "bet",
          amount: delta,
          chips: chipBreakdown(delta),
          from: raisedLaunchPoint(seat.slot),
          to: betSpotPosition(seat.slot),
          slot: seat.slot,
        });
        onSeatToss(seat.slot);
      }
    }

    if (model.hasWinners && !prev.hasWinners) {
      for (const seat of model.seats) {
        if (seat.isWinner && seat.winAmount > 0) {
          launched.push({
            key: `award-${flightSerial++}`,
            kind: "award",
            amount: seat.winAmount,
            chips: chipBreakdown(seat.winAmount),
            from: POT_POSITION,
            to: betSpotPosition(seat.slot),
            slot: null,
          });
        }
      }
    }

    if (launched.length > 0) {
      setFlights((current) => [...current, ...launched]);
    }
  });

  // Resting piles are whatever is not currently airborne toward them.
  const inboundBet = new Map<number, number>();
  let inboundPot = 0;
  let outboundPot = 0;
  for (const flight of flights) {
    if (flight.kind === "bet" && flight.slot !== null) {
      inboundBet.set(flight.slot, (inboundBet.get(flight.slot) ?? 0) + flight.amount);
    } else if (flight.kind === "sweep") {
      inboundPot += flight.amount;
    } else if (flight.kind === "award") {
      outboundPot += flight.amount;
    }
  }

  const potAmount = Math.max(0, model.potResting - inboundPot - outboundPot);

  const piles: RestingChipPile[] = [];
  for (const seat of model.seats) {
    const resting = seat.streetBet - (inboundBet.get(seat.slot) ?? 0);
    if (resting > 0) {
      piles.push({
        key: `pile-seat-${seat.slot}`,
        amount: resting,
        position: betSpotPosition(seat.slot),
        seed: seat.slot * 7,
      });
    }
  }
  piles.push({ key: "pile-pot", amount: potAmount, position: POT_POSITION, seed: 101 });

  const flightInputs: ChipFlightInput[] = flights.map((flight) => ({
    key: flight.key,
    chips: flight.chips,
    from: flight.from,
    to: flight.to,
  }));

  return (
    <>
      <ChipInstancedLayer piles={piles} flights={flightInputs} onFlightDone={removeFlight} />
      <FakeShadows piles={piles} seats={model.seats} />
    </>
  );
}
