import { useId } from "react";
import { cardBackArt, type CardBackArtwork } from "@/lib/cosmetics/catalog";

/**
 * Card-back artwork, drawn rather than shipped as files: an SVG stays crisp
 * at every size a card renders at (26px on a crowded opponent seat up to
 * 116px on your own hole cards), and the whole set is still only a few KB.
 *
 * Every pattern shares one frame: a double border, a corner flourish at each
 * corner, and a soft foil sheen over the stock colour. What used to
 * distinguish a back was just its field pattern -- a few crossed lines with
 * nothing to anchor the eye -- which reads as a texture, not a design. The
 * frame plus a real medallion at the centre of each pattern is what makes it
 * read as a *card back*, the same way a real deck always has a printed
 * border and a centrepiece rather than an edge-to-edge tile.
 *
 * `useId()` backs every `id` used inside a `url(#...)`/`href="#...")`
 * reference -- five to eight opponents can have this same pattern on screen
 * at once, and without a per-instance id every one of those SVGs would
 * resolve to whichever instance's `<defs>` happened to land first in the
 * DOM, borrowing that seat's ink colour instead of its own.
 *
 * Lives here, above both callers, rather than under components/store where it
 * started. The store's preview and the card on the felt have to be the same
 * drawing -- two implementations of "the Brass back" is two things to keep in
 * step, and the one that drifts is the one nobody is looking at, which would
 * mean a player buying a swatch that is not what lands on the table.
 */
export function CardBackArt({ art, className }: { art: CardBackArtwork; className?: string }) {
  const { base, ink, pattern } = art;
  const uid = useId().replace(/:/g, "");
  const clipId = `cb-clip-${uid}`;
  const sheenId = `cb-sheen-${uid}`;
  const shadeId = `cb-shade-${uid}`;
  const ornId = `cb-orn-${uid}`;

  return (
    <svg viewBox="0 0 60 84" className={className} role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <clipPath id={clipId}>
          <rect x="6" y="6" width="48" height="72" rx="3" />
        </clipPath>
        {/* A gentle highlight toward the top-left, like light catching foil
            stock, plus a matching vignette darkening the edges -- together
            these are what separate "flat colour" from "card stock". */}
        <radialGradient id={sheenId} cx="30%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={shadeId} cx="50%" cy="55%" r="75%">
          <stop offset="55%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.24" />
        </radialGradient>
        {/* One corner ornament, reused at all four corners by mirroring
            rather than rotating -- the card isn't square, so a rotation
            would stretch the motif's proportions at the top/bottom pair. */}
        <g id={ornId}>
          <path d="M0 6 A6 6 0 0 1 6 0" fill="none" />
          <path d="M4.24 2.74 L5.74 4.24 L4.24 5.74 L2.74 4.24 Z" stroke="none" fill="currentColor" />
        </g>
      </defs>

      <rect width="60" height="84" rx="6" fill={base} />
      <rect width="60" height="84" rx="6" fill={`url(#${sheenId})`} />
      <rect width="60" height="84" rx="6" fill={`url(#${shadeId})`} />

      <g clipPath={`url(#${clipId})`} stroke={ink} strokeWidth="0.7" opacity="0.55" fill="none">
        {patternPaths(pattern, ink)}
      </g>

      <rect x="3.5" y="3.5" width="53" height="77" rx="4" fill="none" stroke={ink} strokeWidth="1.1" opacity="0.6" />
      <rect x="6" y="6" width="48" height="72" rx="3" fill="none" stroke={ink} strokeWidth="0.5" opacity="0.4" />

      <g stroke={ink} strokeWidth="0.6" opacity="0.6" color={ink}>
        <use href={`#${ornId}`} transform="translate(5,5)" />
        <use href={`#${ornId}`} transform="translate(55,5) scale(-1,1)" />
        <use href={`#${ornId}`} transform="translate(55,79) scale(-1,-1)" />
        <use href={`#${ornId}`} transform="translate(5,79) scale(1,-1)" />
      </g>
    </svg>
  );
}

/**
 * The field pattern plus a centred medallion, per pattern name. Kept as one
 * switch rather than five components -- there is no shared state or props
 * beyond `ink`, and every branch is only reached for its own pattern.
 */
function patternPaths(pattern: CardBackArtwork["pattern"], ink: string) {
  switch (pattern) {
    case "lattice":
      return (
        <>
          {[...Array(20)].map((_, i) => {
            const x = -30 + i * 6;
            const bold = i % 2 === 0;
            return (
              <g key={i} strokeWidth={bold ? 0.7 : 0.4}>
                <path d={`M${x} 84 L${x + 84} 0`} />
                <path d={`M${x} 0 L${x + 84} 84`} />
              </g>
            );
          })}
          <circle cx="30" cy="42" r="4.5" strokeWidth="0.8" />
          <circle cx="30" cy="42" r="1.4" fill={ink} stroke="none" />
        </>
      );
    case "chevron":
      return (
        <>
          {[...Array(11)].map((_, i) => {
            const y = 3 + i * 7;
            return <path key={i} d={`M4 ${y + 8} L30 ${y} L56 ${y + 8}`} strokeWidth={i % 2 === 0 ? 0.8 : 0.4} />;
          })}
          <path d="M30 32 L38 42 L30 52 L22 42 Z" strokeWidth="0.9" />
          <path d="M30 36 L34 42 L30 48 L26 42 Z" strokeWidth="0.6" />
        </>
      );
    case "pinstripe":
      return (
        <>
          {[...Array(15)].map((_, i) => {
            const x = 6 + i * 3.5;
            return <path key={i} d={`M${x} 6 V78`} strokeWidth={i % 3 === 0 ? 0.7 : 0.35} />;
          })}
          <path d="M30 26 L42 42 L30 58 L18 42 Z" strokeWidth="0.9" />
          {[...Array(4)].map((_, i) => {
            const y = 32 + i * 6;
            return <path key={i} d={`M24 ${y + 4} L30 ${y} L36 ${y + 4}`} strokeWidth="0.5" />;
          })}
        </>
      );
    case "rings":
      return (
        <>
          {[6, 12, 18, 24].map((r, i) => (
            <circle key={r} cx="30" cy="42" r={r} strokeWidth={i % 2 === 0 ? 0.8 : 0.5} />
          ))}
          {[...Array(16)].map((_, i) => {
            const a = (i / 16) * Math.PI * 2;
            const x1 = 30 + 13.5 * Math.cos(a);
            const y1 = 42 + 13.5 * Math.sin(a);
            const x2 = 30 + 16.5 * Math.cos(a);
            const y2 = 42 + 16.5 * Math.sin(a);
            return <path key={i} d={`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`} strokeWidth="0.5" />;
          })}
          <circle cx="30" cy="42" r="1.6" fill={ink} stroke="none" />
        </>
      );
    case "crest":
      return (
        <>
          <path d="M30 14 L46 24 V48 L30 66 L14 48 V24 Z" strokeWidth="0.9" />
          <path d="M30 22 L40 28 V46 L30 58 L20 46 V28 Z" strokeWidth="0.6" />
          <path d="M30 38 L34 42 L30 46 L26 42 Z" strokeWidth="0.6" />
          {[...Array(6)].map((_, i) => {
            const y = 20 + i * 6;
            return (
              <g key={i} strokeWidth="0.5">
                <path d={`M7 ${y} L11 ${y - 2}`} />
                <path d={`M53 ${y} L49 ${y - 2}`} />
              </g>
            );
          })}
        </>
      );
  }
}

/**
 * The same drawing, addressed by cosmetic id instead of by artwork -- what
 * every caller on the table actually has, since a seat carries an id.
 */
export function CardBackFor({ id, className }: { id: string | null | undefined; className?: string }) {
  return <CardBackArt art={cardBackArt(id)} className={className} />;
}
