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
 * Resting amounts are always derived as "model amount minus what is still in
 * the air toward that pile", so the felt never double-counts a flying chip
 * and always sums to the pot the HUD states.
 *
 * Flight motion is sampled closed-form from lib/game3d/chip-trajectory each
 * frame — positions are written straight onto the meshes, so a flight never
 * causes a React re-render mid-air; state changes only on launch and landing.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { SceneModel } from "@/lib/game3d/scene-model";
import {
  chipBreakdown,
  type ChipDenomination,
} from "@/lib/game3d/denominations";
import {
  landingOffset,
  sampleChipFlight,
} from "@/lib/game3d/chip-trajectory";
import {
  POT_POSITION,
  betSpotPosition,
  seatPosition,
  type Vec3,
} from "@/lib/game3d/seat-layout";
import { CHIP_THICKNESS, ChipStack, chipGeometry, chipMaterials } from "./chip-stack";

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

function FlightGroup({
  flight,
  onDone,
}: {
  flight: Flight;
  onDone: (key: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const doneRef = useRef(false);
  /** Filled from the scene clock on this flight's first frame. */
  const startedAtRef = useRef<number | null>(null);
  const targets = useMemo(
    () =>
      flight.chips.map((_, i) => {
        const off = landingOffset(i);
        return {
          x: flight.to.x + off.dx,
          y: flight.to.y,
          z: flight.to.z + off.dz,
        };
      }),
    [flight]
  );

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || doneRef.current) return;
    const nowMs = clock.elapsedTime * 1000;
    if (startedAtRef.current === null) startedAtRef.current = nowMs;
    const elapsed = nowMs - startedAtRef.current;

    let allDone = true;
    group.children.forEach((child, i) => {
      const sample = sampleChipFlight(flight.from, targets[i], elapsed, i);
      child.position.set(
        sample.position.x,
        sample.position.y + CHIP_THICKNESS / 2 + (i % 3) * CHIP_THICKNESS,
        sample.position.z
      );
      if (!sample.done) allDone = false;
    });

    if (allDone) {
      doneRef.current = true;
      onDone(flight.key);
    }
  });

  return (
    <group ref={groupRef}>
      {flight.chips.map((denom, i) => (
        <mesh
          key={i}
          geometry={chipGeometry}
          material={chipMaterials(denom)}
          position={[flight.from.x, flight.from.y, flight.from.z]}
          castShadow
        />
      ))}
    </group>
  );
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

  // Resting piles render whatever is not currently airborne toward them.
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

  return (
    <group>
      {model.seats.map((seat) => {
        const resting = seat.streetBet - (inboundBet.get(seat.slot) ?? 0);
        return resting > 0 ? (
          <ChipStack
            key={seat.slot}
            amount={resting}
            position={betSpotPosition(seat.slot)}
            seed={seat.slot * 7}
          />
        ) : null;
      })}
      <ChipStack amount={potAmount} position={POT_POSITION} seed={101} />
      {flights.map((flight) => (
        <FlightGroup key={flight.key} flight={flight} onDone={removeFlight} />
      ))}
    </group>
  );
}
