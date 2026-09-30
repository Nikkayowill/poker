import type { CSSProperties } from "react";
import clsx from "clsx";

/** The barn-paint icons in public/stackacres-td/ui/icons/ (art/stackacres-td/brand/icons.py). */
export type PixelIconName =
  | "back" | "close" | "more" | "plus" | "minus"
  | "coin" | "energy" | "water" | "map" | "journal" | "sound" | "mute"
  | "hand" | "hoe" | "can" | "pouch" | "fence" | "egg" | "sack"
  // The empire district's own resource HUD (Wood/Wheat/Workers). Placeholder
  // glyphs -- see scripts/gen-empire-hud-icons.py -- not a real art pass.
  | "wood" | "wheat" | "workers"
  // The Far Field's buildings: what they cost in Metal, and the Build button.
  | "metal" | "build";

/** Tools are drawn at 16 art pixels, the rest at 12. Both show at 2x. */
const LARGE: ReadonlySet<PixelIconName> = new Set(["hand", "hoe", "can", "pouch", "fence", "egg", "sack", "build"]);

export function StackAcresPixelIcon({ name, className }: { name: PixelIconName; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx("sa-px", LARGE.has(name) && "sa-px-lg", className)}
      style={{ "--sa-px": `url("/stackacres-td/ui/icons/${name}.png")` } as CSSProperties}
    />
  );
}
