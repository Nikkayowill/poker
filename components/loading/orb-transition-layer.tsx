"use client";

import { useEffect, useRef } from "react";
import {
  attachOrbLayer,
  BURST_MS,
  burstProgress,
  burstVeilAlpha,
  coverAlpha,
  gatherProgress,
  MIN_HOLD_MS,
  type OrbCommand,
  spherePoints,
  startOrb,
  STUCK_MS,
} from "@/lib/loading/orb-transition";

/**
 * Draws the page-change orb (timeline in lib/loading/orb-transition.ts).
 * Plain 2D canvas, a few hundred pre-rendered dots, and the frame loop only
 * runs while an orb is on screen, so an idle page pays nothing for it.
 *
 * Starts on any plain click of an in-app link, or when code calls startOrb
 * (router.push call sites use navigateWithOrb). Bursts once the URL changes
 * or releaseOrb is called. Players with reduced motion never get a layer.
 */

const DOTS = 320;
const HUES = 24;
const SPRITE_PX = 32;
const MAX_DPR = 1.5;
const VEIL = "21, 10, 43";

type Phase = "idle" | "forming" | "bursting";

function locationKey(): string {
  return window.location.pathname + window.location.search;
}

function dotSprites(): HTMLCanvasElement[] {
  return Array.from({ length: HUES }, (_, index) => {
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = SPRITE_PX;
    const g = sprite.getContext("2d");
    if (!g) return sprite;
    const half = SPRITE_PX / 2;
    const hue = (index / HUES) * 360;
    const fill = g.createRadialGradient(half, half, 0, half, half, half);
    fill.addColorStop(0, `hsla(${hue}, 100%, 92%, 1)`);
    fill.addColorStop(0.25, `hsla(${hue}, 100%, 66%, 0.9)`);
    fill.addColorStop(0.6, `hsla(${hue}, 100%, 55%, 0.22)`);
    fill.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
    g.fillStyle = fill;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    return sprite;
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

    const sprites = dotSprites();
    const home = spherePoints(DOTS);
    const seed = new Float32Array(DOTS);
    const startX = new Float32Array(DOTS);
    const startY = new Float32Array(DOTS);
    const hueBase = new Float32Array(DOTS);
    for (let i = 0; i < DOTS; i++) {
      seed[i] = Math.random();
      hueBase[i] = ((Math.atan2(home[i * 3 + 2], home[i * 3]) / (Math.PI * 2)) + 1) * 360 + home[i * 3 + 1] * 40;
    }

    let phase: Phase = "idle";
    let startedAt = 0;
    let burstAt = 0;
    let released = false;
    let veilAtBurst = 1;
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
    };

    const stop = () => {
      phase = "idle";
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, width, height);
      canvas.dataset.phase = "idle";
    };

    const draw = (now: number) => {
      const t = (now - startedAt) / 1000;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(88, Math.min(width, height) * 0.12);
      const reach = Math.hypot(width, height) / radius;

      if (phase === "forming") {
        const elapsed = now - startedAt;
        if (!released && (locationKey() !== fromKey || elapsed > STUCK_MS)) released = true;
        if (released && elapsed >= MIN_HOLD_MS) {
          phase = "bursting";
          burstAt = now;
          veilAtBurst = coverAlpha(elapsed);
          canvas.dataset.phase = "bursting";
        }
      }
      const bursting = phase === "bursting";
      const burstElapsed = now - burstAt;
      if (bursting && burstElapsed >= BURST_MS) {
        stop();
        return;
      }

      const veil = bursting ? burstVeilAlpha(burstElapsed, veilAtBurst) : coverAlpha(now - startedAt);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = `rgba(${VEIL}, ${veil})`;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "lighter";
      const spin = t * 2.6;
      const cosS = Math.cos(spin);
      const sinS = Math.sin(spin);
      const cosT = Math.cos(0.42);
      const sinT = Math.sin(0.42);
      const hueShift = t * 160;
      for (let i = 0; i < DOTS; i++) {
        const hx = home[i * 3];
        const hy = home[i * 3 + 1];
        const hz = home[i * 3 + 2];
        const wobble = 1 + 0.06 * Math.sin(hy * 5 + t * 7 + seed[i] * 6);
        const rx = (hx * cosS + hz * sinS) * wobble;
        const rz0 = (-hx * sinS + hz * cosS) * wobble;
        const ry = (hy * cosT - rz0 * sinT) * wobble;
        const rz = hy * sinT + rz0 * cosT;
        let x = cx + rx * radius;
        let y = cy + ry * radius;
        let alpha = 0.35 + 0.65 * ((rz + 1) / 2);
        let size = radius * (0.2 + 0.1 * rz);

        if (bursting) {
          const k = burstProgress(burstElapsed, seed[i]);
          const out = 1 + k * reach * (0.5 + seed[i] * 0.7);
          x = cx + rx * radius * out;
          y = cy + ry * radius * out;
          alpha *= 1 - k;
          size *= 1 + k * 0.6;
        } else {
          const k = gatherProgress(now - startedAt, seed[i]);
          if (k < 1) {
            const dx = x - startX[i];
            const dy = y - startY[i];
            const swirl = Math.sin(k * Math.PI) * 0.35;
            x = startX[i] + dx * k - dy * swirl;
            y = startY[i] + dy * k + dx * swirl;
            alpha *= 0.4 + 0.6 * k;
          }
        }
        if (alpha <= 0.01) continue;
        const hue = Math.floor((((hueBase[i] + hueShift) % 360) / 360) * HUES) % HUES;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[hue], x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (phase === "forming") return;
      resize();
      for (let i = 0; i < DOTS; i++) {
        startX[i] = Math.random() * width;
        startY[i] = Math.random() * height;
      }
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
