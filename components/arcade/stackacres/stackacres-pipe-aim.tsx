"use client";

import clsx from "clsx";
import { useEffect } from "react";
import { PIPE_FACINGS, type PipeFacing } from "@/lib/stackacres/irrigation";

/**
 * The four-way aim for a lone pipe stub, dropped at the finger the same way
 * the seed ring is (see StackAcresRadialMenu) -- one arrow per neighbour
 * direction, in the same screen positions the connector's own arms take
 * (art-irrigation.ts's ARM_DIR: N up-right, E down-right, S down-left, W
 * up-left), so the button you press sits where the stub will point.
 *
 * Cosmetic only, and only offered while the tile is lone -- see
 * lib/stackacres/irrigation.ts's `PipeFacing`. Opens on its own after a
 * ring "Lay Pipe" lands somewhere with no pipe beside it, and from a ring
 * "Aim Pipe" on a stub already down; closes on a pick, the scrim, Escape,
 * the camera moving, or the stub joining a neighbour (stackacres-farm.tsx).
 */

export interface StackAcresPipeAimProps {
  /** Pixels inside .sa-field, the same box the scene reported the tap in. */
  at: { x: number; y: number };
  /** The stub's current aim, so the pressed one reads as held. */
  facing: PipeFacing | null;
  busy: boolean;
  onAim: (facing: PipeFacing) => void;
  onClose: () => void;
}

const AIM_SLOTS: Readonly<
  Record<PipeFacing, { readonly dx: number; readonly dy: number; readonly glyph: string; readonly label: string }>
> = {
  1: { dx: 40, dy: -30, glyph: "↗", label: "Aim up and to the right" },
  2: { dx: 40, dy: 30, glyph: "↘", label: "Aim down and to the right" },
  4: { dx: -40, dy: 30, glyph: "↙", label: "Aim down and to the left" },
  8: { dx: -40, dy: -30, glyph: "↖", label: "Aim up and to the left" },
};

export function StackAcresPipeAim({ at, facing, busy, onAim, onClose }: StackAcresPipeAimProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Same scrim the ring uses: the next tap anywhere closes this rather
          than doing whatever it would otherwise have done. */}
      <button type="button" className="sa-radial-scrim" aria-label="Close the pipe aim" onClick={onClose} />
      <div className="sa-radial sa-pipe-aim" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
        <span className="sa-radial-pin" aria-hidden="true" />
        <div className="sa-radial-ring" role="group" aria-label="Aim the pipe">
          {PIPE_FACINGS.map((slot) => {
            const def = AIM_SLOTS[slot];
            const held = facing === slot;
            return (
              <button
                key={slot}
                type="button"
                className={clsx("sa-radial-btn sa-pipe-aim-btn", { "is-held": held })}
                style={{ left: `${def.dx}px`, top: `${def.dy}px` }}
                aria-label={def.label}
                aria-pressed={held}
                disabled={busy}
                onClick={() => onAim(slot)}
              >
                <span className="sa-pipe-aim-glyph" aria-hidden="true">
                  {def.glyph}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
