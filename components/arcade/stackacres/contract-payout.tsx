"use client";

import { useEffect, useRef, useState } from "react";
import { Coins, Sparkles } from "lucide-react";
import { GOLD_TICKER_DURATION_MS, goldTickerValue } from "@/lib/stackacres/juice";

/**
 * What a delivered Town Contract looks like when it lands.
 *
 * WHY THIS IS DOM AND NOT THE CANVAS. Every other Gold payout on this farm is
 * answered in the world, because every other one is EARNED in the world: a
 * harvest tap has a finger position, so `stackacres-farm.tsx` floats the reward
 * out of the thing that was tapped (`floatAt`). A contract is settled from
 * inside a sheet, over a scrim, with the map hidden behind it -- the tap anchor
 * is null by construction and the scene has nothing to anchor to. A world-space
 * effect fired from here would play behind the modal that fired it.
 *
 * So the effect comes to where the press was: the burst rises out of the
 * contract row the player just filled, and the count-up sits on top of it. The
 * arithmetic is `lib/stackacres/juice.ts`'s `goldTickerValue`, the same module
 * the canvas effects take their curves from, so a payout counts the same way
 * wherever it is shown.
 *
 * FIRE-AND-FORGET, like every GameJuiceManager trigger (see its own header).
 * This mounts on a CONFIRMED settlement -- the caller renders it only once the
 * server has said yes and named the figure -- and nothing here ever rolls back.
 * The sheet's own note carries the wording; this carries the feeling.
 *
 * MOUNTED PER PAYOUT. `TownContractsModal` keys this on its payout nonce, so a
 * second delivery is a fresh instance rather than a live one asked to replay:
 * the scatter and the ticker's starting figure are both decided once, at mount,
 * and never have to be reset mid-flight.
 */

/** Motes thrown by one delivery. Enough to read as a handful without turning a
 *  modal row into a fireworks display -- the same restraint `critShakeIntensity`
 *  is sized with, and for the same reason: this runs in a tab next to a live
 *  poker table. */
const BURST_MOTES = 14;

export interface ContractPayoutProps {
  /** Gold the settlement actually paid. Zero renders no ticker -- a delivery
   *  that paid nothing has no figure to count. */
  gold: number;
  /** Town Influence the same settlement paid, shown beside the Gold rather
   *  than counted: it is a standing, not a balance, and racing two numbers
   *  against each other reads as noise. */
  influence: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** One mote's own flight. Random per mote, decided once at mount: recomputing
 *  per render would deal every mote a new direction mid-flight the moment
 *  anything else on the sheet re-rendered. */
interface Mote {
  readonly id: number;
  /** Where it starts across the row, as a percentage. */
  readonly left: number;
  /** How far it drifts sideways on the way up, in pixels. */
  readonly drift: number;
  /** How high it climbs, in pixels. */
  readonly rise: number;
  readonly delayMs: number;
  readonly durationMs: number;
}

function scatter(): readonly Mote[] {
  return Array.from({ length: BURST_MOTES }, (_unused, id) => ({
    id,
    left: 12 + Math.random() * 76,
    drift: (Math.random() - 0.5) * 46,
    rise: 54 + Math.random() * 46,
    delayMs: Math.round(Math.random() * 160),
    durationMs: 620 + Math.round(Math.random() * 320),
  }));
}

export function ContractPayout({ gold, influence }: ContractPayoutProps) {
  // Read once, at mount, through lazy initialisers -- this component only ever
  // exists for the length of one payout, so none of the three can change
  // underneath it and none needs an effect to establish.
  const [reduced] = useState(prefersReducedMotion);
  const [motes] = useState<readonly Mote[]>(() => (reduced ? [] : scatter()));
  const [shown, setShown] = useState(() => (reduced || gold <= 0 ? gold : 0));
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (reduced || gold <= 0) return;
    // A plain rAF count rather than a CSS animation: the value being animated
    // is the TEXT, and CSS cannot interpolate a number into a formatted string.
    // Driven off `performance.now` rather than a frame count, so the count
    // takes the same time on a 60Hz phone as on a 120Hz one.
    const started = performance.now();
    const step = (now: number) => {
      const t = (now - started) / GOLD_TICKER_DURATION_MS;
      setShown(goldTickerValue(gold, t));
      if (t >= 1) {
        frame.current = null;
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [gold, reduced]);

  if (gold <= 0 && influence <= 0) return null;

  return (
    // Decorative in full: the figures here are a second telling of what the
    // sheet's own `sa-contracts-note` already says in a live region, and
    // announcing a number that changes sixty times a second would be hostile.
    <div className="sa-contract-payout" aria-hidden="true">
      <span className="sa-contract-payout-burst">
        {motes.map((mote) => (
          <span
            key={mote.id}
            className="sa-contract-mote"
            style={{
              left: `${mote.left}%`,
              animationDelay: `${mote.delayMs}ms`,
              animationDuration: `${mote.durationMs}ms`,
              // Read by the keyframes in 52-stackacres.css, so all fourteen
              // motes run one animation and only their own numbers differ.
              ["--sa-mote-drift" as string]: `${mote.drift}px`,
              ["--sa-mote-rise" as string]: `${mote.rise}px`,
            }}
          />
        ))}
      </span>
      <span className="sa-contract-ticker">
        {gold > 0 && (
          <strong className="is-gold">
            <Coins size={16} aria-hidden="true" />+{shown.toLocaleString()}
          </strong>
        )}
        {influence > 0 && (
          <strong className="is-influence">
            <Sparkles size={14} aria-hidden="true" />+{influence.toLocaleString()}
          </strong>
        )}
      </span>
    </div>
  );
}
