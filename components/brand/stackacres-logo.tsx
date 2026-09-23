/**
 * StackAcres' logo, drawn as pixel art by art/stackacres-td/brand/: "Stack" in
 * white and "Acres" in harvest gold (the same two-tone split as the StackChips
 * wordmark), and a mark of poker chips with a field growing on top. Show it at
 * a whole multiple of its size so the pixels stay square.
 */
import type { ImgHTMLAttributes } from "react";
import clsx from "clsx";

const ART = {
  wordmark: { src: "/brand/stackacres/wordmark.png", width: 186, height: 36 },
  stacked: { src: "/brand/stackacres/lockup-stacked.png", width: 186, height: 67 },
  row: { src: "/brand/stackacres/lockup-row.png", width: 231, height: 37 },
  badge: { src: "/brand/stackacres/badge.png", width: 72, height: 72 },
} as const;

export type StackAcresLogoVariant = keyof typeof ART;

export function StackAcresLogo({
  variant = "wordmark",
  className,
  alt = "StackAcres",
  ...rest
}: { variant?: StackAcresLogoVariant } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height">) {
  const art = ART[variant];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a few KB of pixel art; next/image would resample it
    <img
      src={art.src}
      width={art.width}
      height={art.height}
      alt={alt}
      decoding="async"
      className={clsx("stackacres-logo", className)}
      {...rest}
    />
  );
}
