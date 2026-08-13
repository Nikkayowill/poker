"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { REACTIONS, type ReactionId } from "@/lib/game/reaction-channel";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";

/**
 * The trigger and picker for sending a table reaction.
 *
 * One component, not three, even though the spec wants a floating panel on
 * desktop, a bottom sheet on mobile portrait, and a compact popover on
 * mobile landscape -- all three are the same eight buttons, just laid out
 * differently, so 41-table-reactions.css reflows one `.reaction-panel` per
 * breakpoint instead.
 *
 * The open/close behaviour (click-away, Escape, close on rotate) mirrors
 * components/nav/menu.tsx, the app's other dropdown, but isn't built on top
 * of it directly -- Menu's items are a vertical list of labelled rows, and
 * this is a fixed emoji grid with its own bottom-sheet layout.
 */
export function ReactionButton({
  onSend,
  disabled,
}: {
  onSend: (reactionId: ReactionId) => void;
  /** True while on cooldown -- see lib/game/use-table-reactions.ts. */
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Rotating between the popover and sheet layouts leaves an open panel
    // positioned for a layout it's no longer in, so just close it.
    window.addEventListener("orientationchange", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("orientationchange", close);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const pick = (reactionId: ReactionId) => {
    selectSound();
    onSend(reactionId);
    close();
  };

  return (
    <div className="reaction-launcher" ref={rootRef}>
      <button
        type="button"
        className="reaction-trigger"
        aria-label="Send a reaction"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => { tapSound(); setOpen((current) => !current); }}
      >
        <SmilePlus size={15} />
      </button>
      {open && (
        <>
          {/* Mobile portrait only (see the CSS) -- tapping outside a bottom
              sheet dismisses it via the same scrim every sheet in the app
              uses. Desktop/landscape have no scrim; the pointerdown listener
              above already covers those. */}
          <div className="reaction-scrim" onClick={close} aria-hidden="true" />
          <div id={panelId} role="menu" aria-label="Reactions" className="reaction-panel">
            {REACTIONS.map((reaction) => (
              <button
                key={reaction.id}
                type="button"
                role="menuitem"
                className="reaction-option"
                aria-label={reaction.label}
                title={reaction.label}
                onClick={() => pick(reaction.id)}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
