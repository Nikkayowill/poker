"use client";

import { useEffect, useRef } from "react";
import { RELIC_CATALOGUE, type RelicId, type StackAcresDevotionView } from "@/lib/stackacres/devotion";
import type { TapPoint } from "./stackacres-scene";

/**
 * The Pixel Pilgrim's dialogue: he speaks, then asks. Anchored at the tap
 * point the scene handed back, the same convention `StackAcresRadialMenu`
 * uses for its own screen-pinned popup -- real DOM, not a canvas overlay,
 * so it reads with a screen reader and the Escape key closes it exactly
 * like that menu's own.
 *
 * Two phases, matching stackacres-farm.tsx's own `MonkDialogueState`:
 *
 *   "greeting" -- one of his rotating opening lines, then "Will you pray
 *   with me?" with Yes/No. **No is a complete, costless answer** -- closing
 *   here sends nothing to the server and touches no state at all, which is
 *   the one thing this component exists to guarantee is easy to do.
 *
 *   "result" -- shown once a "yes" answers. Leads with what THIS prayer did
 *   (today's streak day, or "already prayed today" if a second tap landed
 *   here), then a relic-grant line only when one was just earned, then the
 *   ongoing state (progress to the next rung, relics held so far) so a
 *   repeat visit is never just a blank restatement of "yes/no".
 *
 * Dismissal is not this component's job, same posture the radial menu
 * documents: stackacres-farm.tsx closes it on the next world tap
 * (`onViewMoved`) and on its own explicit close button here.
 */

export interface StackAcresMonkDialogueProps {
  at: TapPoint;
  devotion: StackAcresDevotionView;
  result:
    | { phase: "greeting"; line: string }
    | { phase: "result"; streak: number; alreadyPrayedToday: boolean; grantedRelic: RelicId | null };
  busy: boolean;
  onPray: () => void;
  onClose: () => void;
}

function relicProgressLine(devotion: StackAcresDevotionView): string {
  if (!devotion.nextRelic) return "Every relic he keeps is now yours.";
  const def = RELIC_CATALOGUE[devotion.nextRelic];
  const remaining = Math.max(0, devotion.nextRungStreak! - devotion.streak);
  return remaining <= 0
    ? `He is ready to entrust you the ${def.label}.`
    : `${remaining} more unbroken ${remaining === 1 ? "day" : "days"} for the ${def.label}.`;
}

export function StackAcresMonkDialogue({ at, devotion, result, busy, onPray, onClose }: StackAcresMonkDialogueProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sa-monk-dialogue" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-monk-dialogue-pin" aria-hidden="true" />
      {/* role/aria-label live on this sized element, not the zero-size
          positioning wrapper above (width/height: 0, same as .sa-radial) --
          a zero-area element reports as not visible to accessibility and
          testing tools alike, the same convention StackAcresRadialMenu's
          own role="group" already follows on its sized ring rather than
          its own zero-size wrapper. */}
      <div className="sa-monk-dialogue-card" role="dialog" aria-label="The Pixel Pilgrim">
        <button type="button" className="sa-monk-dialogue-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {result.phase === "greeting" ? (
          <>
            <p className="sa-monk-dialogue-line">{result.line}</p>
            <p className="sa-monk-dialogue-prompt">Will you pray with me?</p>
            <div className="sa-monk-dialogue-actions">
              <button type="button" className="sa-monk-dialogue-yes" ref={firstRef} disabled={busy} onClick={onPray}>
                Pray with him
              </button>
              <button type="button" className="sa-monk-dialogue-no" onClick={onClose}>
                Not today
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sa-monk-dialogue-line">
              {result.alreadyPrayedToday
                ? "You have already prayed with him today. Come back tomorrow."
                : `Devotion, day ${result.streak}.`}
            </p>
            {result.grantedRelic && (
              <p className="sa-monk-dialogue-relic">
                {RELIC_CATALOGUE[result.grantedRelic].icon} He entrusts you the{" "}
                {RELIC_CATALOGUE[result.grantedRelic].label} -- {RELIC_CATALOGUE[result.grantedRelic].blurb}
              </p>
            )}
            <p className="sa-monk-dialogue-progress">{relicProgressLine(devotion)}</p>
            {devotion.relicsHeld.length > 0 && (
              <p className="sa-monk-dialogue-relics-held" aria-label="Relics held">
                {devotion.relicsHeld.map((id) => (
                  <span key={id} title={RELIC_CATALOGUE[id].label}>
                    {RELIC_CATALOGUE[id].icon}
                  </span>
                ))}
              </p>
            )}
            <div className="sa-monk-dialogue-actions">
              <button type="button" className="sa-monk-dialogue-no" ref={firstRef} onClick={onClose}>
                Amen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
