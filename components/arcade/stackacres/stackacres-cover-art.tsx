"use client";

import { useEffect, useRef } from "react";
import { PAINTERS } from "./stackacres-art";
import { F, ell, lin, rad, type Ctx, type Painter } from "./art-kit";

/**
 * The tap-to-play splash's backdrop.
 *
 * There is no downloaded key art for this because there doesn't need to be
 * one: the game already draws its own barn, silo, trees and animals as
 * vector painters (see stackacres-art.ts), so this composes a farm-at-dusk
 * scene out of those same painters rather than commissioning or fetching a
 * new picture. A carrot in the seed strip is already the carrot in the
 * field; this makes the barn on the splash the same barn in the game.
 *
 * A fixed composition, not a live scene -- no clock, no input, no per-frame
 * work -- so it only redraws on resize, the same way paintIcon redraws an
 * icon when its `size` prop changes.
 */
export function StackAcresCoverArt() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    let frame = 0;
    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintScene(ctx, w, h);
    };

    draw();
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={ref} className="sa-play-cover" aria-hidden="true" />;
}

/** Places a painter's own anchor point at (x, y) in device px, `k` device px
 *  per world unit -- paintIcon's centring maths, generalised so several
 *  painters can share one canvas instead of one each. */
function place(c: Ctx, p: Painter, x: number, y: number, k: number): void {
  c.save();
  c.translate(x - p.ax * p.w * k, y - p.ay * p.h * k);
  c.scale(k, k);
  p(c);
  c.restore();
}

function paintScene(c: Ctx, w: number, h: number): void {
  c.clearRect(0, 0, w, h);

  // StackAcres is landscape-only (stackacres-farm.tsx gates everything,
  // this splash included, behind useLandscape -- it never renders in
  // portrait), so the frame is always wide and short, never tall. That rules
  // out a stacked sky-over-ground layout: the .sa-play-content column is
  // vertically centred and, on a short frame, its own height eats most of
  // it, leaving no band underneath tall enough to stand a barn in without
  // colliding with the text above it (this shipped once, on a portrait
  // build, before that got caught). Scenery flanks the text left and right
  // instead, sized off the frame's own short side.
  c.fillStyle = lin(c, 0, 0, 0, h, [
    [0, "#150a2b"],
    [1, "#26123f"],
  ]);
  c.fillRect(0, 0, w, h);

  // One warm glow, high and to the left -- the same "one sun, upper-left"
  // rule every painter in stackacres-art.ts is lit by, standing in here for a
  // low moon since the sky is a night violet, not a daylight blue. Sized off
  // the SHORT side (h): on a wide phone `max(w, h)` would blow the glow out
  // to cover most of the frame.
  const moonX = w * 0.1;
  const moonY = h * 0.26;
  const glowR = Math.min(w, h) * 1.5;
  c.fillStyle = rad(c, moonX, moonY, 0, glowR, [
    [0, "rgba(255,210,63,.4)"],
    [0.35, "rgba(255,210,63,.12)"],
    [1, "rgba(255,210,63,0)"],
  ]);
  c.fillRect(0, 0, w, h);
  const moonR = h * 0.08;
  ell(c, moonX, moonY, moonR, moonR);
  F(
    c,
    rad(c, moonX - moonR * 0.3, moonY - moonR * 0.3, 0, moonR * 1.4, [
      [0, "#fffae8"],
      [0.7, "#ffe9ab"],
      [1, "#e8c977"],
    ]),
  );

  // A thin grass strip along the very bottom -- just enough for the barn
  // and the animals to visibly stand on, not a full ground band (there
  // isn't the height to spare for one).
  const groundH = h * 0.16;
  c.fillStyle = lin(c, 0, h - groundH, 0, h, [
    [0, "#1b3a22"],
    [1, "#2e5a30"],
  ]);
  c.fillRect(0, h - groundH, w, groundH);

  // Every painter is sized by TWO independent budgets -- a target height as
  // a fraction of h (the frame's own short side) and a max width as a
  // fraction of w, so nothing grows wide enough to reach the centred text
  // column even on a very short, very wide window. The smaller of the two
  // wins.
  const fit = (p: Painter, targetPx: number, maxWidthPx: number) =>
    Math.min(targetPx / p.h, maxWidthPx / p.w);

  // Left cluster: back tree, silo, barn -- kept inside the left ~28% of the
  // frame so the widest of them (the barn) never reaches the centred text.
  place(c, PAINTERS.tree3, w * 0.04, h * 0.86, fit(PAINTERS.tree3, h * 0.3, w * 0.07));
  place(c, PAINTERS.silo, w * 0.1, h * 0.94, fit(PAINTERS.silo, h * 0.56, w * 0.08));
  place(c, PAINTERS.barn, w * 0.21, h * 0.97, fit(PAINTERS.barn, h * 0.42, w * 0.2));

  // Right cluster: a tree, then the animals closest to the frame's edge --
  // mirrors the left cluster's ~28%-of-width budget.
  place(c, PAINTERS.tree1, w * 0.96, h * 0.86, fit(PAINTERS.tree1, h * 0.3, w * 0.07));
  place(c, PAINTERS.cow, w * 0.88, h * 0.97, fit(PAINTERS.cow, h * 0.32, w * 0.11));
  place(c, PAINTERS.sheep, w * 0.78, h * 0.95, fit(PAINTERS.sheep, h * 0.28, w * 0.1));
  place(c, PAINTERS.hen, w * 0.72, h * 0.98, fit(PAINTERS.hen, h * 0.2, w * 0.06));

  // A scrim over the whole scene so the title and prompt sitting on top of
  // it stay legible regardless of what's underneath them.
  c.fillStyle = lin(c, 0, 0, 0, h, [
    [0, "rgba(13,6,32,.35)"],
    [0.5, "rgba(13,6,32,.1)"],
    [1, "rgba(13,6,32,.5)"],
  ]);
  c.fillRect(0, 0, w, h);
}
