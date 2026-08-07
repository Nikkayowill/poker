"use client";

import { useEffect, useRef } from "react";
import {
  POCKET_ANGLE,
  SPIN_DURATION_MS,
  WHEEL_ORDER,
  pocketColour,
  restingRotation,
  wheelRotation,
} from "@/lib/arcade/roulette";

/**
 * The wheel, on a canvas.
 *
 * Canvas rather than 37 rotated DOM nodes, for the reason lib/scene made the
 * same choice for the poker room: this is one continuously-rotating painting,
 * and a transform on each of 37 elements is 37 chances for the browser to
 * decide it needs a layer.
 *
 * ## It does not decide anything
 *
 * The pocket arrives already drawn by the server. Everything here is a
 * function of that number and the elapsed time -- there is no randomness in
 * this file and there must never be, or the wheel a player watches and the
 * wheel their Gold was settled against would be two different wheels. All the
 * geometry lives in lib/arcade/roulette.ts where `npm test` can reach it;
 * `wheelRotation` is pinned to land exactly on the winning pocket, so the ball
 * cannot end up beside the number that was just paid.
 *
 * The loop terminates. `wheelRotation` returns the resting angle exactly at
 * the end of the spin rather than approaching it, so the last frame is the
 * last frame -- the same "a clocked animation must end, not asymptote"
 * contract the chip glide holds.
 */

/** Capped for the same reason lib/scene caps it: a 3x phone does not need 3x of this. */
const MAX_PIXEL_RATIO = 2;

const PALETTE = {
  red: "#a3232b",
  black: "#17191c",
  green: "#1c6b47",
  rim: "#c9a961",
  rimShade: "#7a6432",
  hub: "#1a1410",
  text: "#f4efe2",
} as const;

export function RouletteWheel({
  pocket,
  onSpinEnd,
  className,
}: {
  /** The winning pocket, or null while the bet is still on the layout. */
  pocket: number | null;
  /** Fired once, when the wheel comes to rest. */
  onSpinEnd?: () => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * The latest callback, without making it a dependency of the spin.
   *
   * A parent that re-renders mid-spin would otherwise restart the wheel,
   * because an inline `onSpinEnd` is a new function every render. Written in
   * its own effect rather than during render -- a ref assigned in the render
   * body is exactly what `react-hooks/refs` flags, and under a re-entrant
   * render it can be the stale one that survives.
   */
  const endRef = useRef(onSpinEnd);
  useEffect(() => {
    endRef.current = onSpinEnd;
  }, [onSpinEnd]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let stopped = false;

    const paint = (rotation: number) => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const size = canvas.clientWidth || 260;
      // Only resize when it actually changed: assigning width clears the
      // canvas, so doing it every frame would throw away the paint below.
      if (canvas.width !== Math.round(size * ratio)) {
        canvas.width = Math.round(size * ratio);
        canvas.height = Math.round(size * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);

      const centre = size / 2;
      const outer = centre - 2;
      const pocketOuter = outer * 0.9;
      const pocketInner = outer * 0.58;

      // Rim.
      const rim = context.createLinearGradient(0, 0, 0, size);
      rim.addColorStop(0, PALETTE.rim);
      rim.addColorStop(0.5, PALETTE.rimShade);
      rim.addColorStop(1, PALETTE.rim);
      context.beginPath();
      context.arc(centre, centre, outer, 0, Math.PI * 2);
      context.fillStyle = rim;
      context.fill();

      // Pockets. Drawn from the top (-PI/2) clockwise, which is the order
      // WHEEL_ORDER is written in and the order restingRotation assumes.
      WHEEL_ORDER.forEach((number, index) => {
        const middle = index * POCKET_ANGLE + rotation - Math.PI / 2;
        const from = middle - POCKET_ANGLE / 2;
        const to = middle + POCKET_ANGLE / 2;

        context.beginPath();
        context.moveTo(centre + Math.cos(from) * pocketInner, centre + Math.sin(from) * pocketInner);
        context.arc(centre, centre, pocketOuter, from, to);
        context.lineTo(centre + Math.cos(to) * pocketInner, centre + Math.sin(to) * pocketInner);
        context.arc(centre, centre, pocketInner, to, from, true);
        context.closePath();
        context.fillStyle = PALETTE[pocketColour(number)];
        context.fill();
        context.strokeStyle = "rgba(0,0,0,.45)";
        context.lineWidth = 0.5;
        context.stroke();

        // The number, standing up out of the ring. Below about 200px the
        // digits stop being digits and start being grain, so they are dropped
        // rather than smudged -- the same call the chip painter makes at
        // NUMERAL_MIN_RADIUS and the dealer avatar makes at 34px.
        if (size >= 200) {
          const radius = (pocketOuter + pocketInner) / 2;
          context.save();
          context.translate(centre + Math.cos(middle) * radius, centre + Math.sin(middle) * radius);
          context.rotate(middle + Math.PI / 2);
          context.fillStyle = PALETTE.text;
          context.font = `600 ${Math.round(size * 0.045)}px Georgia, serif`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(number), 0, 0);
          context.restore();
        }
      });

      // Hub.
      context.beginPath();
      context.arc(centre, centre, pocketInner, 0, Math.PI * 2);
      const hub = context.createRadialGradient(centre, centre * 0.7, 0, centre, centre, pocketInner);
      hub.addColorStop(0, "#2c2318");
      hub.addColorStop(1, PALETTE.hub);
      context.fillStyle = hub;
      context.fill();
      context.strokeStyle = PALETTE.rim;
      context.lineWidth = 1.5;
      context.stroke();

      // The marker and the ball, which do NOT rotate -- the wheel turns under
      // them, which is what puts the winning number under the ball at rest.
      context.beginPath();
      context.moveTo(centre, 3);
      context.lineTo(centre - 7, -9);
      context.lineTo(centre + 7, -9);
      context.closePath();
      context.fillStyle = PALETTE.rim;
      context.fill();

      context.beginPath();
      context.arc(centre, outer * 0.28 + 4, Math.max(3.5, size * 0.021), 0, Math.PI * 2);
      const ball = context.createRadialGradient(centre - 2, outer * 0.28, 0, centre, outer * 0.28 + 4, 8);
      ball.addColorStop(0, "#ffffff");
      ball.addColorStop(1, "#b9b2a2");
      context.fillStyle = ball;
      context.fill();
    };

    if (pocket === null) {
      paint(0);
      return;
    }

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Still lands on the right number -- only the journey is skipped.
      paint(restingRotation(pocket));
      endRef.current?.();
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      if (stopped) return;
      const elapsed = now - start;
      paint(wheelRotation(pocket, elapsed));
      if (elapsed < SPIN_DURATION_MS) {
        frame = requestAnimationFrame(tick);
      } else {
        endRef.current?.();
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [pocket]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // The canvas is decoration for a result that is also stated in text by
      // the verdict chip, so it is hidden from assistive tech rather than
      // given a label that would read the number out twice.
      aria-hidden="true"
    />
  );
}
