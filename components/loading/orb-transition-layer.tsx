"use client";

import { useEffect, useRef } from "react";
import {
  attachOrbLayer,
  COIN_COUNT,
  coinEnterProgress,
  coinExitProgress,
  coverAlpha,
  EXIT_MS,
  exitVeilAlpha,
  MIN_HOLD_MS,
  type OrbCommand,
  startOrb,
  STUCK_MS,
} from "@/lib/loading/orb-transition";
import { coinSprites, drawCoin, sprite } from "@/lib/loading/coin-sprites";

/**
 * Draws the page-change orb (timeline in lib/loading/orb-transition.ts).
 * Plain 2D canvas and a handful of pre-rendered sprites, and the frame loop
 * only runs while the orb is on screen, so an idle page pays nothing for it.
 *
 * Starts on any plain click of an in-app link, or when code calls startOrb
 * (router.push call sites use navigateWithOrb). Leaves once the URL changes
 * or releaseOrb is called. Players with reduced motion never get a layer.
 */

const MAX_DPR = 2;
/** Radians per second the ring turns, and each coin flips. */
const ORBIT_SPEED = 1.1;
const SPIN_SPEED = 6.5;
/** How flat the ring sits: 1 is face-on, 0 is edge-on. */
const RING_TILT = 0.36;

type Phase = "idle" | "forming" | "leaving";

function locationKey(): string {
  return window.location.pathname + window.location.search;
}

/**
 * The arcade's own ground (DESIGN.md "Neon Marquee"): violet-black with a
 * violet glow from the top left and a faint gold one from the bottom right.
 * Painted small, since it's all soft light, and stretched to the screen.
 */
function groundSprite(width: number, height: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width / 4));
  const h = Math.max(1, Math.round(height / 4));
  return sprite(w, h, (g) => {
    const reach = Math.hypot(w, h);
    g.fillStyle = "#150a2b";
    g.fillRect(0, 0, w, h);
    const violet = g.createRadialGradient(0, 0, 0, 0, 0, reach * 0.75);
    violet.addColorStop(0, "rgba(155, 63, 240, 0.32)");
    violet.addColorStop(1, "rgba(155, 63, 240, 0)");
    g.fillStyle = violet;
    g.fillRect(0, 0, w, h);
    const gold = g.createRadialGradient(w, h, 0, w, h, reach * 0.6);
    gold.addColorStop(0, "rgba(255, 210, 63, 0.12)");
    gold.addColorStop(1, "rgba(255, 210, 63, 0)");
    g.fillStyle = gold;
    g.fillRect(0, 0, w, h);
  });
}

/** A plain left click on a link to another page of this app. */
function isInAppNavigation(event: MouseEvent): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  if (anchor.hasAttribute("download") || anchor.dataset.orb === "off") return false;
  if (anchor.target && anchor.target !== "_self") return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  return url.pathname + url.search !== locationKey();
}

export function OrbTransitionLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const art = coinSprites();
    const order = Array.from({ length: COIN_COUNT }, (_, index) => index);
    const depth = new Float32Array(COIN_COUNT);
    let ground = art.edge;

    let phase: Phase = "idle";
    let startedAt = 0;
    let leftAt = 0;
    let released = false;
    let veilAtExit = 1;
    let fromKey = "";
    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingQuality = "high";
      ground = groundSprite(width, height);
    };

    const stop = () => {
      phase = "idle";
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, width, height);
      canvas.dataset.phase = "idle";
    };

    const drawArcadeCoin = (x: number, y: number, r: number, angle: number, alpha: number) =>
      drawCoin(ctx, art, x, y, r, angle, alpha);

    const draw = (now: number) => {
      const elapsed = now - startedAt;
      if (phase === "forming") {
        if (!released && (locationKey() !== fromKey || elapsed > STUCK_MS)) released = true;
        if (released && elapsed >= MIN_HOLD_MS) {
          phase = "leaving";
          leftAt = now;
          veilAtExit = coverAlpha(elapsed);
          canvas.dataset.phase = "leaving";
        }
      }
      const leaving = phase === "leaving";
      const exitElapsed = now - leftAt;
      if (leaving && exitElapsed >= EXIT_MS) {
        stop();
        return;
      }

      const t = elapsed / 1000;
      const cx = width / 2;
      const cy = height / 2;
      const ring = Math.min(92, Math.max(52, Math.min(width, height) * 0.12));
      const coin = ring * 0.3;
      const veil = leaving ? exitVeilAlpha(exitElapsed, veilAtExit) : coverAlpha(elapsed);

      let presence = 0;
      for (let i = 0; i < COIN_COUNT; i++) {
        presence += leaving ? 1 - coinExitProgress(exitElapsed, i) : Math.min(1, coinEnterProgress(elapsed, i));
      }
      presence /= COIN_COUNT;

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = veil;
      ctx.drawImage(ground, 0, 0, width, height);

      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = presence * 0.8;
      ctx.drawImage(art.violetGlow, cx - ring * 2.4, cy - ring * 2.4, ring * 4.8, ring * 4.8);
      // The coins gather into a warm core on the way out.
      const gathered = leaving ? Math.sin((1 - presence) * Math.PI) : 0;
      ctx.globalAlpha = 0.25 * presence + 0.6 * gathered;
      ctx.drawImage(art.goldGlow, cx - ring, cy - ring, ring * 2, ring * 2);

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = presence * 0.22;
      ctx.strokeStyle = "#c07bff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy + coin * 0.15, ring, ring * RING_TILT, 0, 0, Math.PI * 2);
      ctx.stroke();

      const orbit = t * ORBIT_SPEED;
      for (let i = 0; i < COIN_COUNT; i++) {
        depth[i] = Math.sin(orbit + (i / COIN_COUNT) * Math.PI * 2);
      }
      order.sort((a, b) => depth[a] - depth[b]);

      for (const i of order) {
        const theta = orbit + (i / COIN_COUNT) * Math.PI * 2;
        const near = (depth[i] + 1) / 2;
        let spread: number;
        let scale: number;
        let alpha: number;
        if (leaving) {
          const k = coinExitProgress(exitElapsed, i);
          spread = 1 - k * 0.9;
          scale = 1 - k * 0.75;
          alpha = 1 - k;
        } else {
          const k = coinEnterProgress(elapsed, i);
          spread = 0.3 + 0.7 * k;
          scale = Math.max(0, k);
          alpha = Math.min(1, k * 1.6);
        }
        if (alpha <= 0.01 || scale <= 0.01) continue;
        const bob = Math.sin(t * 3 + i * 0.9) * coin * 0.12;
        const x = cx + Math.cos(theta) * ring * spread;
        const y = cy + depth[i] * ring * RING_TILT * spread + bob;
        const r = coin * scale * (0.82 + 0.18 * near);
        const shade = alpha * (0.6 + 0.4 * near);

        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = shade * 0.45;
        ctx.drawImage(art.goldGlow, x - r * 1.8, y - r * 1.8, r * 3.6, r * 3.6);
        ctx.globalCompositeOperation = "source-over";
        drawArcadeCoin(x, y, r, t * SPIN_SPEED + (i / COIN_COUNT) * Math.PI * 2, shade);
      }

      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (phase === "forming") return;
      resize();
      phase = "forming";
      released = false;
      startedAt = performance.now();
      fromKey = locationKey();
      canvas.dataset.phase = "forming";
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };

    const command = (next: OrbCommand) => {
      if (next === "start") start();
      else if (phase === "forming") released = true;
    };

    const onClick = (event: MouseEvent) => {
      if (isInAppNavigation(event)) startOrb();
    };

    const detach = attachOrbLayer(command);
    document.addEventListener("click", onClick, true);
    window.addEventListener("resize", resize);
    return () => {
      detach();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="orb-transition" data-phase="idle" aria-hidden="true" />;
}
