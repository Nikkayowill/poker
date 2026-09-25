"use client";

import { useEffect, useRef, useState } from "react";
import {
  goldSpecks,
  makeWinOrb,
  winOrbCoinsLanded,
  winOrbPointAt,
  WIN_ORB_MS,
  type WinOrbBurst,
} from "@/lib/celebration/win-orb";

const BASE_ORB_RADIUS = 28;
/** A bigger payout reads as a slightly bigger orb -- capped well short of
 * anything that would crowd the result panel around it. */
const MAX_ORB_RADIUS = 44;
const MAX_DPR = 1.5;
const DOT_PX = 28;
const HUE_BANDS = 10;
/** Warm gold band -- these are coins, not the sign-in orb's full rainbow. */
const HUE_MIN = 32;
const HUE_MAX = 54;

function goldSprites(): HTMLCanvasElement[] {
  return Array.from({ length: HUE_BANDS }, (_, i) => {
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = DOT_PX;
    const g = sprite.getContext("2d");
    if (!g) return sprite;
    const half = DOT_PX / 2;
    const hue = HUE_MIN + (i / (HUE_BANDS - 1)) * (HUE_MAX - HUE_MIN);
    const fill = g.createRadialGradient(half, half, 0, half, half, half);
    fill.addColorStop(0, `hsla(${hue}, 100%, 92%, 1)`);
    fill.addColorStop(0.3, `hsla(${hue}, 100%, 68%, 0.9)`);
    fill.addColorStop(0.65, `hsla(${hue}, 100%, 55%, 0.25)`);
    fill.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
    g.fillStyle = fill;
    g.fillRect(0, 0, DOT_PX, DOT_PX);
    return sprite;
  });
}

/**
 * A one-shot win celebration: a small cluster of gold specks swarms into a
 * spinning orb, holds, then splits into a handful of coins that fly to
 * wherever the header's Gold badge actually sits on screen right now (found
 * live via `[data-win-target="gold-badge"]`; falls back to a fixed
 * top-right point on a screen with no visible badge, e.g. a phone route
 * whose tab bar carries no balance). The badge gets a short pulse as each
 * coin lands.
 *
 * Draws no text of its own. Every caller already states the win in its own
 * copy right where the result panel sits -- action-bar.tsx's "You won the
 * match!", cribbage-shell.tsx's "You win", each arcade game's own result
 * label -- so this used to also centre its own "You win! +N" over the same
 * spot, which is what actually read as one payout overlapping another. This
 * is purely the visual effect now; the amount only shapes the orb's size,
 * a bigger payout reading as a slightly bigger orb.
 *
 * Same three-beat shape as StackAcres' own particle orb
 * (lib/celebration/win-orb.ts has the math this shares with
 * lib/stackacres-td/orb-burst.ts), reworked for plain viewport pixels since
 * a poker table, a duel and an arcade result screen share no renderer.
 *
 * Mount once per result screen, gated on `active` (pass `won && amount >
 * 0`) -- the caller's result panel mounts fresh exactly when the outcome is
 * decided, so `active` is read once, lazily, at that mount rather than
 * watched afterward: a later re-render with `active` still true must not
 * replay it. Renders nothing under prefers-reduced-motion.
 */
export function WinCelebration({ active, amount }: { active: boolean; amount: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(() => {
    if (!active) return false;
    return !(
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  });

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setPlaying(false), WIN_ORB_MS);
    return () => window.clearTimeout(timer);
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const sprites = goldSprites();
    let width = window.innerWidth;
    let height = window.innerHeight;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const centre = { x: width / 2, y: height / 2 };
    // The header's own Gold balance, read live every frame so the coins
    // still land correctly through a resize or orientation change. Some
    // routes carry no visible balance at all (a phone's non-/ tab bar has no
    // Gold badge) -- a fixed point near the top-right stands in there, the
    // same corner the previous, DOM-free version always aimed at.
    const targetEl = document.querySelector<HTMLElement>('[data-win-target="gold-badge"]');
    const liveTarget = () => {
      const rect = targetEl?.getBoundingClientRect();
      return rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: width - 46, y: 34 };
    };

    const orbRadius = Math.min(MAX_ORB_RADIUS, BASE_ORB_RADIUS + Math.log10(Math.max(1, amount)) * 4);
    const specks = goldSpecks(centre, orbRadius * 0.85, Math.random);
    const burst: WinOrbBurst = makeWinOrb(specks, centre, liveTarget(), orbRadius, Math.random);

    const started = performance.now();
    let frame = 0;
    let landed = 0;

    const draw = (now: number) => {
      const ms = now - started;
      const target = liveTarget();
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (const point of burst.points) {
        const at = winOrbPointAt(burst, point, ms, target);
        if (at.alpha <= 0.02) continue;
        const size = DOT_PX * 0.32 * at.size;
        const band = Math.min(HUE_BANDS - 1, Math.max(0, Math.round(((at.hue - HUE_MIN) / (HUE_MAX - HUE_MIN)) * (HUE_BANDS - 1))));
        ctx.globalAlpha = at.alpha;
        ctx.drawImage(sprites[band], at.x - size / 2, at.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      const nowLanded = winOrbCoinsLanded(burst, ms);
      if (nowLanded > landed) {
        landed = nowLanded;
        targetEl?.classList.add("gold-badge-won");
        window.setTimeout(() => targetEl?.classList.remove("gold-badge-won"), 500);
      }
      if (ms < WIN_ORB_MS) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [playing, amount]);

  if (!playing) return null;

  return (
    <div className="win-celebration" aria-hidden="true">
      <canvas ref={canvasRef} className="win-celebration-canvas" />
    </div>
  );
}
