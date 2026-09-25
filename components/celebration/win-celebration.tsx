"use client";

import { useEffect, useRef, useState } from "react";
import { coinSprites, drawCoin, type CoinSprites } from "@/lib/loading/coin-sprites";
import {
  coinFrameAt,
  coinsLanded,
  makeCoinRing,
  RING_ENTER_MS,
  RING_HOLD_MS,
  WIN_COINS_MS,
  type CoinRing,
} from "@/lib/celebration/win-coins";

/** Where the ring forms, as a share of viewport height -- well above the
 * vertical middle, where every caller's own "You win"/"You won the match!"
 * copy sits. An earlier version spawned dead centre, right on top of that
 * text; this keeps the two from ever sharing the same spot. */
const RING_CENTRE_Y_SHARE = 0.28;
const BASE_RING_RADIUS = 28;
/** A bigger payout reads as a slightly bigger ring -- capped well short of
 * anything that would crowd the result panel around it. */
const MAX_RING_RADIUS = 44;
const MAX_DPR = 1.5;

/** Built once per session and reused by every celebration -- these canvas
 * sprites are a real cost to construct, and a win can happen dozens of
 * times in a sitting across every arcade game, duel and Sit & Go this
 * component covers. Shared with the page-change orb (lib/loading/
 * coin-sprites.ts), so it's the same art either way. */
let cachedArt: CoinSprites | null = null;

function art(): CoinSprites {
  if (!cachedArt) cachedArt = coinSprites();
  return cachedArt;
}

/**
 * A one-shot win celebration: the same spinning gold coin ring the
 * page-change orb shows between pages (lib/loading/orb-transition.ts,
 * lib/loading/coin-sprites.ts) forms over the result panel, holds and
 * turns, then its coins peel off one at a time and fly to wherever the
 * header's Gold badge actually sits on screen right now (found live via
 * `[data-win-target="gold-badge"]`; falls back to a fixed top-right point
 * on a screen with no visible badge, e.g. a phone route whose tab bar
 * carries no balance). The badge gets a short pulse as each coin lands.
 *
 * Draws no text of its own. Every caller already states the win in its own
 * copy right where the result panel sits -- action-bar.tsx's "You won the
 * match!", cribbage-shell.tsx's "You win", each arcade game's own result
 * label -- so an earlier version also centred its own "You win! +N" over
 * the same spot, which read as one payout overlapping another. This is
 * purely the visual effect; the amount only shapes the ring's size, a
 * bigger payout reading as a slightly bigger ring.
 *
 * This used to be a custom particle "orb" with its own look. Reusing the
 * page-change ring instead means a payout reads as the same Gold players
 * already watch spin between pages, not a second, different effect.
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
    const timer = window.setTimeout(() => setPlaying(false), WIN_COINS_MS);
    return () => window.clearTimeout(timer);
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const coinArt = art();
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

    const centre = { x: width / 2, y: height * RING_CENTRE_Y_SHARE };
    // The header's own Gold balance, read live every frame so the coins
    // still land correctly through a resize or orientation change. Some
    // routes carry no visible balance at all (a phone's non-/ tab bar has no
    // Gold badge) -- a fixed point near the top-right stands in there, the
    // same corner an earlier, DOM-free version always aimed at.
    const targetEl = document.querySelector<HTMLElement>('[data-win-target="gold-badge"]');
    const liveTarget = () => {
      const rect = targetEl?.getBoundingClientRect();
      return rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: width - 46, y: 34 };
    };

    const ringRadius = Math.min(MAX_RING_RADIUS, BASE_RING_RADIUS + Math.log10(Math.max(1, amount)) * 4);
    const coinRadius = ringRadius * 0.55;
    const ring: CoinRing = makeCoinRing(centre, ringRadius, liveTarget());

    const started = performance.now();
    let frame = 0;
    let landed = 0;
    const order = Array.from({ length: ring.order.length }, (_, i) => i);
    const depths = new Array<number>(ring.order.length).fill(0);

    const draw = (now: number) => {
      const ms = now - started;
      const target = liveTarget();
      ctx.clearRect(0, 0, width, height);

      // A soft warm glow behind the ring while it's still forming/holding --
      // gone once every coin has left, since there's nothing left to glow.
      if (ms < RING_ENTER_MS + RING_HOLD_MS) {
        const k = Math.min(1, ms / RING_ENTER_MS);
        const glowSize = ringRadius * 4.2;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.5 * k;
        ctx.drawImage(coinArt.goldGlow, centre.x - glowSize / 2, centre.y - glowSize / 2, glowSize, glowSize);
        ctx.globalAlpha = 1;
      }

      const frames = order.map((i) => coinFrameAt(ring, i, ms, target));
      frames.forEach((f, i) => { depths[i] = f.depth; });
      order.sort((a, b) => depths[a] - depths[b]);

      ctx.globalCompositeOperation = "source-over";
      for (const i of order) {
        const f = frames[i];
        if (f.alpha <= 0.01 || f.scale <= 0.01) continue;
        const r = coinRadius * f.scale;
        const shade = f.alpha * (0.6 + 0.4 * (f.depth + 1) / 2);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = shade * 0.45;
        ctx.drawImage(coinArt.goldGlow, f.x - r * 1.8, f.y - r * 1.8, r * 3.6, r * 3.6);
        ctx.globalCompositeOperation = "source-over";
        drawCoin(ctx, coinArt, f.x, f.y, r, f.angle, shade);
      }
      ctx.globalAlpha = 1;

      const nowLanded = coinsLanded(ring, ms);
      if (nowLanded > landed) {
        landed = nowLanded;
        targetEl?.classList.remove("gold-badge-won");
        void targetEl?.offsetWidth;
        targetEl?.classList.add("gold-badge-won");
        window.setTimeout(() => targetEl?.classList.remove("gold-badge-won"), 500);
      }
      if (ms < WIN_COINS_MS) frame = requestAnimationFrame(draw);
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
