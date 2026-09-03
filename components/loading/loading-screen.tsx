"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { DEALER_ART_SRC } from "@/lib/scene/table-dealer";
import { useMinHoldFade } from "@/components/loading/use-min-hold-fade";

/**
 * The app-shell loading beat -- the cold-boot wait before a profile exists
 * to render the lobby from (lobby.tsx's `!profile` branch), and anywhere
 * else a genuine "nothing to show yet" gap needs more than bare text.
 *
 * Modeled on PlayPokerGO's own loading screen at Kayo's request: their own
 * character, subtly animating, under moodier lighting than live play -- not
 * a generic spinner. This app already has exactly one house character for
 * that job, Claira (the 2.5D table's dealer, `DEALER_ART_SRC`); she has no
 * rig (the WebGL avatar system is disabled), so "subtly animating" here is a
 * slow CSS sway on her existing static cutout, not new art or a new pipeline.
 * Shares TableLoadingSplash's brand mark and flavor-line rotation rather
 * than inventing a second visual language for the same kind of moment.
 */

const FLAVOR_LINES = [
  "Preparing your seat…",
  "Shuffling up…",
  "Racking your Gold…",
  "Setting the table…",
] as const;

const FLAVOR_INTERVAL_MS = 1800;
const MIN_VISIBLE_MS = 450;
const FADE_MS = 350;

export function LoadingScreen({ active = true, error }: { active?: boolean; error?: string | null }) {
  const phase = useMinHoldFade(active, { minMs: MIN_VISIBLE_MS, fadeMs: FADE_MS });
  const [flavorIndex, setFlavorIndex] = useState(0);

  useEffect(() => {
    if (phase === "hidden") return;
    const timer = setInterval(() => {
      setFlavorIndex((index) => (index + 1) % FLAVOR_LINES.length);
    }, FLAVOR_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div
      className={clsx("app-loading-screen", phase === "hiding" && "app-loading-screen-hiding")}
      role="status"
      aria-live="polite"
    >
      <div className="app-loading-dealer">
        {/* A plain <img>, not next/image: one small already-sized cutout
            reused from the table scene, not user content needing a CDN. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="app-loading-dealer-img" src={DEALER_ART_SRC} alt="" aria-hidden="true" draggable={false} />
      </div>
      <StackChipsMark size={56} />
      <p className="app-loading-flavor">{FLAVOR_LINES[flavorIndex]}</p>
      {error && <p className="app-loading-error"><X size={14} aria-hidden="true" /> {error}</p>}
    </div>
  );
}
