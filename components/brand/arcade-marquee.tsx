import type { CSSProperties } from "react";
import { StackChipsLogo } from "@/components/brand/stackchips-logo";

/**
 * The sign-in wordmark as a lit arcade marquee: the wordmark inside a sign
 * box with gold bulbs chasing round its edge and "Online arcade" under it.
 *
 * The bulbs are laid out by CSS alone (a flex row or column per side), so
 * there's nothing to measure and it renders the same on the server. They are
 * numbered clockwise from the top-left corner and each gets its number as
 * `--bulb`, which the CSS turns into a staggered start so the light runs
 * round the frame. The CSS lap length assumes 36 bulbs; change both together.
 */
const TOP = 15;
const SIDE = 3;
// 15 + 3 + 15 + 3 = 36 bulbs.

type Side = "top" | "right" | "bottom" | "left";
const SIDES: { side: Side; count: number }[] = [
  { side: "top", count: TOP },
  { side: "right", count: SIDE },
  { side: "bottom", count: TOP },
  { side: "left", count: SIDE },
];

export function ArcadeMarquee() {
  let index = 0;
  return (
    <div className="arcade-marquee">
      {SIDES.map(({ side, count }) => (
        <span key={side} className={`arcade-marquee-bulbs arcade-marquee-bulbs-${side}`} aria-hidden="true">
          {Array.from({ length: count }, () => {
            const bulb = index++;
            return <span key={bulb} className="arcade-marquee-bulb" style={{ "--bulb": bulb } as CSSProperties} />;
          })}
        </span>
      ))}
      <StackChipsLogo className="entry-logo arcade-marquee-logo" />
      <span className="arcade-marquee-sub" aria-hidden="true">★ Online arcade ★</span>
    </div>
  );
}
