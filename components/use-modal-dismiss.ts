"use client";

import { useEffect, useRef, type MouseEvent } from "react";

/**
 * The three-part interaction every modal/drawer overlay in this app repeats:
 * focus the close button on mount (so a keyboard user lands somewhere
 * useful), close on Escape, and close on a raw mousedown of the backdrop
 * itself (not a bubbled event from inside the panel). Extracted from
 * room-created-modal.tsx, hand-history-drawer.tsx, rewarded-ad-modal.tsx and
 * friends-drawer.tsx, which all carried this block near-verbatim.
 *
 * `canDismiss` gates both the Escape listener and the backdrop click --
 * rewarded-ad-modal.tsx is the one caller that needs this, refusing to lose
 * a completed ad wait to a stray keypress or misplaced click while a claim
 * is in flight. Defaults to always-dismissible for every other caller.
 *
 * Returns the ref for the close button (`ref={closeButtonRef}`) and a ready
 * handler for the overlay's own `onMouseDown`. A caller that needs more than
 * this -- friends-drawer.tsx also traps Tab inside the panel and restores
 * focus to whatever opened it -- keeps that extra behavior in its own
 * effect, declared after this hook's call so the ordering (opener captured
 * before the close button steals focus) is unchanged.
 */
export function useModalDismiss(onClose: () => void, canDismiss = true) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canDismiss) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, canDismiss]);

  const onBackdropMouseDown = (event: MouseEvent) => {
    if (event.currentTarget === event.target && canDismiss) onClose();
  };

  return { closeButtonRef, onBackdropMouseDown };
}
