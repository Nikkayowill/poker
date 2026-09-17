"use client";

import { useEffect, useRef } from "react";

/**
 * The Use key, beside the thumb stick: work the square under the farmer's feet
 * with whatever the belt is holding (components/arcade/stackacres/stackacres-toolbelt.tsx).
 *
 * Press it and the one square he is standing on is worked. HOLD it and walk,
 * and every bed he steps onto is worked as he reaches it, which is how a row
 * gets watered or hoed in one stroke -- the scene decides which bed and when
 * (scene.ts's `useSquare`), this only says whether the key is down.
 *
 * Same shape as the stick: a fixed key rather than one that appears under the
 * thumb, and a hold that survives the page being left mid-press.
 */

export function StackAcresUseKey({
  onHeld,
  label,
}: {
  onHeld: (down: boolean) => void;
  /** What the belt is holding, so the key announces the job rather than "Use". */
  label: string;
}) {
  const held = useRef(false);
  const onHeldRef = useRef(onHeld);
  useEffect(() => {
    onHeldRef.current = onHeld;
  });

  const release = () => {
    if (!held.current) return;
    held.current = false;
    onHeldRef.current(false);
  };

  // An app switch never sends the pointerup, so a held key would stroke forever.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onHidden);
      if (held.current) onHeldRef.current(false);
    };
    // `release` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = (event: { currentTarget: HTMLElement; pointerId: number; preventDefault: () => void }) => {
    if (held.current) return;
    event.preventDefault();
    held.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-held");
    onHeldRef.current(true);
  };

  const lift = (event: { currentTarget: HTMLElement }) => {
    event.currentTarget.classList.remove("is-held");
    release();
  };

  return (
    <button
      type="button"
      className="sa-use-key"
      aria-label={label}
      title={label}
      onPointerDown={press}
      onPointerUp={lift}
      onPointerCancel={lift}
      onLostPointerCapture={lift}
      // A keyboard reaches the same thing: hold to stroke, let go to stop.
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (held.current) return;
        held.current = true;
        onHeldRef.current(true);
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        release();
      }}
      onBlur={release}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="30" />
      </svg>
    </button>
  );
}
