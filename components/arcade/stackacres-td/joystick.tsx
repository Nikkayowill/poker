"use client";

import { useEffect, useRef } from "react";
import { stickVector, type Point } from "@/lib/stackacres-td/movement";

/**
 * The thumb stick in the bottom-right corner, for phones. Tap-to-move still works everywhere else on the map.
 *
 * A fixed base rather than one that appears under the thumb: young players need to see it before
 * they'll use it. A touch anywhere on the base walks at once in that direction, so a thumb that lands
 * off-centre doesn't have to find the knob first. Hidden on a mouse (52-stackacres.css).
 *
 * The knob moves by CSS variables written from a ref, never React state, so a drag re-renders nothing.
 */

/** How far the knob's centre travels from the base's centre, in css px. */
const REACH = 38;

export function StackAcresJoystick({ onStick }: { onStick: (push: Point | null) => void }) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const held = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const frame = useRef(0);
  const onStickRef = useRef(onStick);
  useEffect(() => {
    onStickRef.current = onStick;
  });

  const placeKnob = (x: number, y: number) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      baseRef.current?.style.setProperty("--kx", `${x}px`);
      baseRef.current?.style.setProperty("--ky", `${y}px`);
    });
  };

  const follow = (clientX: number, clientY: number) => {
    const grip = held.current;
    if (!grip) return;
    const dx = clientX - grip.cx;
    const dy = clientY - grip.cy;
    const reach = Math.hypot(dx, dy);
    const clamp = reach > REACH ? REACH / reach : 1;
    placeKnob(dx * clamp, dy * clamp);
    onStickRef.current(stickVector(dx, dy, REACH));
  };

  const release = () => {
    if (!held.current) return;
    held.current = null;
    baseRef.current?.classList.remove("is-held");
    placeKnob(0, 0);
    onStickRef.current(null);
  };

  // Let go if the page is left mid-push (an app switch never sends the pointerup), and on unmount.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onHidden);
      cancelAnimationFrame(frame.current);
      if (held.current) onStickRef.current(null);
    };
    // `release` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={baseRef}
      className="sa-joystick"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (held.current) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        held.current = { id: event.pointerId, cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add("is-held");
        follow(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (held.current?.id === event.pointerId) follow(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (held.current?.id === event.pointerId) release();
      }}
      onPointerCancel={(event) => {
        if (held.current?.id === event.pointerId) release();
      }}
      onLostPointerCapture={(event) => {
        if (held.current?.id === event.pointerId) release();
      }}
    >
      <svg className="sa-joystick-arrows" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M50 9 L57 17 H43 Z" />
        <path d="M50 91 L57 83 H43 Z" />
        <path d="M9 50 L17 43 V57 Z" />
        <path d="M91 50 L83 43 V57 Z" />
      </svg>
      <span className="sa-joystick-knob" />
    </div>
  );
}
