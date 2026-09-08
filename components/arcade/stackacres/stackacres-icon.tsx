"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { paintIcon, type PainterName } from "./stackacres-art";
import { isSpriteName, onSpriteReady, spriteImage } from "./stackacres-sprites";

/**
 * One of the StackAcres's vector painters, drawn into a small DOM canvas.
 *
 * This replaces every pixel-art `<img>` in the chrome (tool icons, seed
 * chips, the HUD purse/feed, the store's barn rows) now that the world
 * itself is vector art rather than a tile sheet -- an `<img>` here would be
 * the one place left where the old Kenney tiles still showed through.
 * `stackacres-art.ts` has no Phaser import, so this component never pulls the
 * game engine into a page that has not opened the map yet.
 *
 * Sized by CSS (`.sa-ico` and its per-context overrides in 52-stackacres.css),
 * the same contract the old `<img>` icons had -- the canvas's own width/height
 * attribute is in device pixels (via `paintIcon`'s own DPR handling), not the
 * CSS box, so the art stays sharp at any zoom the OS throws at it.
 */
export interface StackAcresIconProps {
  name: PainterName;
  /** CSS pixels, square. */
  size?: number;
  className?: string;
}

export function StackAcresIcon({ name, size = 24, className }: StackAcresIconProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paintIcon(canvas, name, size);
    // Some of the painters draw an image once it has arrived (the seed strip
    // reaches `cow` and `hen`), so paint again when it does -- otherwise the
    // strip keeps the drawn cow while the world shows the generated one,
    // which is exactly the kind of mismatch that gets noticed.
    //
    // Only for a painter that HAS a sprite, and only until that one sprite
    // lands. An `ico-` badge is drawn shapes the whole way down and has
    // nothing to wait for; subscribing it to every sprite in the game is what
    // used to drag the entire image cache into memory behind a gold coin.
    if (!isSpriteName(name) || spriteImage(name)) return;
    return onSpriteReady(() => paintIcon(canvas, name, size));
  }, [name, size]);

  return <canvas ref={ref} className={clsx("sa-ico", className)} aria-hidden="true" />;
}
