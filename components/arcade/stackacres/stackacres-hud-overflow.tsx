"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { MoreHorizontal } from "lucide-react";

/**
 * The HUD's overflow drawer, gated on `compactNav` (`useTightLandscape`,
 * <=500px landscape *height*) in stackacres-farm.tsx -- not a width check.
 * The farm only ever renders in landscape, where every phone's width is
 * 700px+, so a width breakpoint (what shipped first) never actually fires;
 * height is what separates a phone on its side from a tablet or a desktop
 * window here.
 *
 * Gold and land-upkeep-owed stay in `.sa-hud` itself -- what a player needs
 * every glance -- while Feed, the Synergy badge, the Prestige badge, the
 * Sunlight Forge badge and the music toggle move in here behind one "More"
 * button. Six-plus pills in one row was the whole complaint; this is the fix,
 * not a resize of the same six pills.
 *
 * Built like `components/nav/menu.tsx`'s dropdown (pointerdown-outside,
 * Escape, close-on-rotate) rather than reusing that component directly: its
 * `MenuItem` model is a flat label+icon+onSelect list, and what needs to live
 * in here are whole existing controls -- SynergyOverlay owns its own sheet
 * and internal state, the music toggle is a real on/off, neither of which is
 * "pick a row and go".
 */
export function StackAcresHudOverflow({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Pointer-down rather than click, same reasoning as the nav menu: a click
  // listener fires after whatever was pressed outside has already acted.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // The popover is anchored under the button with plain CSS, not a projected
  // position -- a rotation can leave it pointing at nothing until the layout
  // settles, so closing is the honest fix, same call the nav menu makes.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("orientationchange", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("orientationchange", close);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  return (
    <div className="sa-hud-more" ref={rootRef}>
      <button
        type="button"
        className={clsx("sa-music-toggle", "sa-hud-more-btn", { "is-open": open })}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More"
        title="More"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        // Any tap inside -- the Feed readout, a badge that opens its own
        // sheet, the music toggle -- closes this too, same as the nav menu
        // closing on a row select. Nothing in here needs to stay open once
        // the player has acted on it or looked at it.
        <div className="sa-hud-more-popover" role="menu" onClick={close}>
          {children}
        </div>
      )}
    </div>
  );
}
