"use client";

import { useEffect, useRef, useState } from "react";
import {
  goldSpecks,
  makeWinOrb,
  orbGlow,
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
const HALO_PX = 220;
const HUE_BANDS = 10;
/** Warm gold band -- these are coins, not the sign-in orb's full rainbow. */
const HUE_MIN = 32;
const HUE_MAX = 54;

/**
 * The gold dot and the orb's own halo, built once per session and reused by
 * every celebration -- a canvas gradient is a real cost to construct, and a
 * win can happen dozens of times in a sitting across every arcade game, duel
 * and Sit & Go this component covers.
 */
let cachedSprites: { dots: HTMLCanvasElement[]; halo: HTMLCanvasElement } | null = null;

function goldSprites(): { dots: HTMLCanvasElement[]; halo: HTMLCanvasElement } {
  if (cachedSprites) return cachedSprites;
  const dots = Array.from({ length: HUE_BANDS }, (_, i) => {
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = DOT_PX;
    const g = sprite.getContext("2d");
    if (!g) return sprite;
    const half = DOT_PX / 2;
    const hue = HUE_MIN + (i / (HUE_BANDS - 1)) * (HUE_MAX - HUE_MIN);
    const fill = g.createRadialGradient(half, half, 0, half, half, half);
    // A bright, near-white core before the hue takes over, and a crisper
    // falloff than a plain three-stop gradient -- what actually reads as a
    // polished coin catching light rather than a soft blob.
    fill.addColorStop(0, "rgba(255, 255, 255, 1)");
    fill.addColorStop(0.16, `hsla(${hue}, 100%, 94%, 0.98)`);
    fill.addColorStop(0.42, `hsla(${hue}, 100%, 70%, 0.85)`);
    fill.addColorStop(0.75, `hsla(${hue}, 100%, 55%, 0.22)`);
    fill.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
    g.fillStyle = fill;
    g.fillRect(0, 0, DOT_PX, DOT_PX);
    return sprite;
  });
  const halo = document.createElement("canvas");
  halo.width = halo.height = HALO_PX;
  const hg = halo.getContext("2d");
  if (hg) {
    const half = HALO_PX / 2;
    const fill = hg.createRadialGradient(half, half, 0, half, half, half);
    fill.addColorStop(0, "rgba(255, 244, 214, 0.55)");
    fill.addColorStop(0.35, "rgba(255, 210, 100, 0.28)");
    fill.addColorStop(0.7, "rgba(255, 180, 60, 0.08)");
    fill.addColorStop(1, "rgba(255, 180, 60, 0)");
    hg.fillStyle = fill;
    hg.fillRect(0, 0, HALO_PX, HALO_PX);
  }
  cachedSprites = { dots, halo };
  return cachedSprites;
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

    const { dots: dotSprites, halo: haloSprite } = goldSprites();
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

      // One soft light behind the swarm/hold/split, the single biggest
      // difference between "a scatter of dots" and "a glowing orb."
      const glow = orbGlow(ms);
      if (glow > 0.01) {
        const haloSize = burst.radius * 5.2;
        ctx.globalAlpha = glow;
        ctx.drawImage(haloSprite, burst.centre.x - haloSize / 2, burst.centre.y - haloSize / 2, haloSize, haloSize);
      }

      for (const point of burst.points) {
        const at = winOrbPointAt(burst, point, ms, target);
        if (at.alpha <= 0.02) continue;
        const size = DOT_PX * 0.34 * at.size;
        const band = Math.min(HUE_BANDS - 1, Math.max(0, Math.round(((at.hue - HUE_MIN) / (HUE_MAX - HUE_MIN)) * (HUE_BANDS - 1))));
        ctx.globalAlpha = at.alpha;
        ctx.drawImage(dotSprites[band], at.x - size / 2, at.y - size / 2, size, size);
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
