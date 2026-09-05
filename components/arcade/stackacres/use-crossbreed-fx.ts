"use client";

import { useCallback } from "react";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import {
  evaluateMutationChance,
  rollCrossbreedMutation,
  seededRandomForPlot,
  type CrossbreedGridSnapshot,
} from "@/lib/stackacres/crossbreeding";
import type { GameJuiceManager } from "./game-juice-manager";

/**
 * Local-optimistic FX for a Crossbreeding Bed harvest tap.
 *
 * FIRES BEFORE THE SERVER ANSWERS, on purpose -- same posture every other
 * GameJuiceManager trigger takes (see its own header): a tap has to feel
 * answered the instant the finger lands, not after a round trip. What makes
 * that safe for a genuinely RANDOM event (a plain harvest pop or crit is
 * never in doubt the way a mutation roll is) is that this hook predicts with
 * `lib/stackacres/crossbreeding.ts`'s own `seededRandomForPlot` -- a
 * DETERMINISTIC stream keyed off the plot's own id, run through the IDENTICAL
 * pure `evaluateMutationChance`/`rollCrossbreedMutation` functions the real
 * settlement path uses. It is a prediction, not a guarantee: the server's
 * own authoritative roll (lib/server/stackacres-crossbreeding-service.ts's
 * `harvestCrossbreedBed`, seeded from `Math.random`, never from this) is the
 * only thing that ever actually credits a hybrid, and it can disagree with
 * this guess. A disagreement is cosmetic, never a money bug: this hook never
 * writes anything, so a predicted flash the server later declines to honor
 * is exactly the same shape as `triggerHarvestPop` firing for a collection
 * that later comes back muck -- purely visual anticipation, corrected by
 * whatever refusal/confirmation path the caller's own settlement response
 * already runs.
 *
 * Returns whether it fired, so a caller can decide whether to ALSO show its
 * own "nothing happened" feedback for a plain harvest.
 */
export function useCrossbreedHarvestFx(
  juiceManager: GameJuiceManager | null,
): (input: {
  plotId: string;
  grid: CrossbreedGridSnapshot;
  /** True WORLD position of the tapped plot -- the same space every other
   *  GameJuiceManager trigger takes, projected by the manager itself. */
  worldPoint: { x: number; y: number };
}) => boolean {
  return useCallback(
    (input) => {
      if (!juiceManager) return false;

      const evaluation = evaluateMutationChance(input.plotId, input.grid);
      if (!evaluation) return false;

      const predictedHit = rollCrossbreedMutation(evaluation, seededRandomForPlot(input.plotId));
      if (!predictedHit) return false;

      const plot = input.grid.find((p) => p.id === input.plotId);
      const neighbor = input.grid.find((p) => p.id === evaluation.neighborPlotId);
      // Both were required to be ripe and stocked for `evaluation` to exist
      // at all (evaluateMutationChance's own contract), so a missing stock
      // here means the caller's grid changed shape between reading it and
      // calling this hook -- treat that stale a snapshot as "don't guess".
      const parentA: StackAcresStock | undefined = plot?.stock ?? undefined;
      const parentB: StackAcresStock | undefined = neighbor?.stock ?? undefined;
      if (!parentA || !parentB) return false;

      juiceManager.triggerCrossbreedFlash(
        input.worldPoint.x,
        input.worldPoint.y,
        parentA,
        parentB,
        evaluation.hybrid,
      );
      return true;
    },
    [juiceManager],
  );
}
