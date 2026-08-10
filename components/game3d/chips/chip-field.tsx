"use client";

/**
 * Every chip on the felt: standing street bets in front of each bettor, the
 * centre pot, and the pushes between them.
 *
 * The choreography mirrors the 2D room's contract exactly:
 * - a bet is pushed from the bettor's hands to their own bet spot and rests there;
 * - when the street turns, standing bets sweep from their spots into the pot
 *   (transferred into flight from where they rested, never respawned);
 * - a winner is paid by a dealer sweep off the top of the pot;
 * - a hand boundary (new handNumber / new game) clears instantly — sweeping
 *   there would wipe the incoming blinds of the next hand.
 *
 * This file owns exactly that choreography state machine — which piles and
 * pushes exist, and when. It renders no chip itself: chip-instanced-layer.tsx
 * is the one place every chip's transform gets written into GPU buffers (see
 * that file's header for why a single writer is required once chips are
 * instanced).
 *
 * WHY A PUSH'S LEGS ARE BUILT IN THE RENDER BODY AND NOT AT LAUNCH. A chip
 * lands in a numbered slot of the pile it is joining, so its destination
 * depends on how many chips are already resting there — and that is
 * bookkeeping this component already does, once per render, to decide what
 * the resting piles are. Resolving legs in the same pass is what keeps a
 * landing and the pile it lands on derived from ONE count: computed at
 * launch instead, a second bet arriving at the same spot would aim its
 * chips at slots the first bet had already taken, and they would land
 * inside each other. The inputs are stable while a push is airborne, so the
 * legs are stable too.
 *
 * It also mounts scene/fake-shadows.tsx's chip-pile shadows here, alongside
 * the chip layer, because `piles` is already computed in this component and
 * a shadow decal's position IS a pile's position.
 */

import { useCallback, useRef, useState } from "react";
import type { SceneModel } from "@/lib/game3d/scene-model";
import { chipBreakdown, type ChipDenomination } from "@/lib/game3d/denominations";
import {
  POT_POSITION,
  betSpotPosition,
  handLaunchPosition,
  type Vec3,
} from "@/lib/game3d/seat-layout";
import {
  POT_PILE_SEED,
  buildPushLegs,
  pileChipCount,
  seatPileSeed,
} from "@/lib/game3d/chip-instance-model";
import { pushKindFromAction, pushStyleFor } from "@/lib/game3d/chip-push";
import type { PushStyle } from "@/lib/game3d/chip-trajectory";
import { useFrame } from "@react-three/fiber";
import {
  ChipInstancedLayer,
  POT_PILE_KEY,
  type ChipFlightInput,
  type RestingChipPile,
} from "./chip-instanced-layer";
import { publishFunnel } from "@/lib/game3d/scene-registry";
import {
  resumedBetFlight,
  type RendererBetFlightHandoff,
} from "@/lib/game3d/renderer-flight-handoff";
import { FakeShadows } from "../scene/fake-shadows";

type FlightKind = "bet" | "sweep" | "award";

interface Flight {
  key: string;
  kind: FlightKind;
  amount: number;
  chips: ChipDenomination[];
  style: PushStyle;
  /** Slot whose bet spot this push feeds (bet) or drains (sweep). Null for
   * an award, which is outbound from the pot — see `awardSlot`. */
  slot: number | null;
  /** Seat a payout is being pushed to. Deliberately separate from `slot`:
   * `slot` drives the resting-bet bookkeeping below, and a payout is not a
   * street bet. */
  awardSlot: number | null;
  /** Fixed launch point for a bet. Null when the chips depart from a pile
   * whose live top is resolved per render (a sweep, an award). */
  hand: Vec3 | null;
}

let flightSerial = 0;

export function ChipField({
  model,
  resumeBetFlights = [],
}: {
  model: SceneModel;
  /** Parent-owned events used only when a renderer switch remounts this room mid-flight. */
  resumeBetFlights?: RendererBetFlightHandoff[];
}) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const prevRef = useRef<SceneModel | null>(null);
  const resumedRef = useRef(new Set<string>());
  // Capture the mount-time handoff. Character GLBs may suspend the first
  // frame long enough for the parent's short event queue to clear; reading
  // the latest prop there would lose exactly the switch-in-progress flight
  // this bridge exists to preserve.
  const mountFlightsRef = useRef(resumeBetFlights);

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
    if (!prev) {
      const resumed = mountFlightsRef.current
        .filter((flight) => !resumedRef.current.has(flight.id))
        .map((flight) => {
          resumedRef.current.add(flight.id);
          const bet = resumedBetFlight(flight);
          return { ...bet, awardSlot: null } satisfies Flight;
        });
      if (resumed.length > 0) setFlights(resumed);
      return;
    }

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
            style: pushStyleFor("sweep"),
            slot: seat.slot,
            awardSlot: null,
            hand: null,
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
          // The label is the only thing in the snapshot that separates a
          // call from a raise — the delta says a bet happened, not how.
          style: pushStyleFor(pushKindFromAction(seat.lastAction)),
          slot: seat.slot,
          awardSlot: null,
          hand: handLaunchPosition(seat.slot),
        });
      }
    }

    if (model.hasWinners && !prev.hasWinners) {
      const funnelled: number[] = [];
      for (const seat of model.seats) {
        if (seat.isWinner && seat.winAmount > 0) {
          launched.push({
            key: `award-${flightSerial++}`,
            kind: "award",
            amount: seat.winAmount,
            chips: chipBreakdown(seat.winAmount),
            style: pushStyleFor("award"),
            slot: null,
            awardSlot: seat.slot,
            hand: null,
          });
          funnelled.push(seat.slot);
        }
      }
      // Recorded for the e2e seam. The slots a payout was aimed at exist
      // nowhere else once these pushes land.
      publishFunnel(funnelled);
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
  const restingChips = new Map<number, number>();
  for (const seat of model.seats) {
    const resting = seat.streetBet - (inboundBet.get(seat.slot) ?? 0);
    const chipCount = resting > 0 ? pileChipCount(resting) : 0;
    restingChips.set(seat.slot, chipCount);
    if (resting > 0) {
      piles.push({
        key: `pile-seat-${seat.slot}`,
        amount: resting,
        position: betSpotPosition(seat.slot),
        seed: seatPileSeed(seat.slot),
      });
    }
  }
  piles.push({
    key: POT_PILE_KEY,
    amount: potAmount,
    position: POT_POSITION,
    seed: POT_PILE_SEED,
  });

  // Slot bookkeeping, in flight order so it is stable frame to frame: each
  // push's chips take the next free slots of the pile they are joining, and
  // a push leaving a pile takes the slots directly above what still rests
  // there — which is where those chips were sitting the frame before they
  // left.
  // A plain loop rather than `flights.map`: the running counters below are
  // reassigned as it goes, and a callback that closes over them reads to the
  // compiler as work that could outlive the render.
  const seatNext = new Map(restingChips);
  const flightInputs: ChipFlightInput[] = [];
  let potNext = pileChipCount(potAmount);

  for (const flight of flights) {
    const count = flight.chips.length;
    let legs;

    if (flight.kind === "bet" && flight.slot !== null && flight.hand) {
      const start = seatNext.get(flight.slot) ?? 0;
      seatNext.set(flight.slot, start + count);
      legs = buildPushLegs(
        count,
        // A held stack: the chips come off the top, one at a time.
        { position: flight.hand, seed: seatPileSeed(flight.slot), startIndex: 0, topFirst: true },
        { position: betSpotPosition(flight.slot), seed: seatPileSeed(flight.slot), startIndex: start },
      );
    } else if (flight.kind === "sweep" && flight.slot !== null) {
      const start = potNext;
      potNext += count;
      legs = buildPushLegs(
        count,
        // Straight off the spot they were resting on — the whole standing
        // bet leaves, so it starts at that pile's own bottom slot.
        {
          position: betSpotPosition(flight.slot),
          seed: seatPileSeed(flight.slot),
          startIndex: 0,
          topFirst: true,
        },
        { position: POT_POSITION, seed: POT_PILE_SEED, startIndex: start },
      );
    } else {
      // An award. Chips come off the TOP of the pot, in distinct slots that
      // are exactly where they were sitting — the dealer scraping a pile,
      // not a payout spraying out of a point.
      const slot = flight.awardSlot ?? 0;
      const start = potNext;
      potNext += count;
      const landing = seatNext.get(slot) ?? 0;
      seatNext.set(slot, landing + count);
      legs = buildPushLegs(
        count,
        { position: POT_POSITION, seed: POT_PILE_SEED, startIndex: start, topFirst: true },
        { position: betSpotPosition(slot), seed: seatPileSeed(slot), startIndex: landing },
      );
    }

    flightInputs.push({ key: flight.key, chips: flight.chips, legs, style: flight.style });
  }

  return (
    <>
      <ChipInstancedLayer piles={piles} flights={flightInputs} onFlightDone={removeFlight} />
      <FakeShadows piles={piles} seats={model.seats} />
    </>
  );
}
