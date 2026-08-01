import { cardBackArt, type CardBackArtwork } from "@/lib/cosmetics/catalog";

/**
 * Card-back artwork, drawn rather than shipped as files: the patterns are
 * simple enough that an SVG stays crisper at every size than a PNG would,
 * and the whole set is a few hundred bytes.
 *
 * Lives here, above both callers, rather than under components/store where it
 * started. The store's preview and the card on the felt have to be the same
 * drawing -- two implementations of "the Brass back" is two things to keep in
 * step, and the one that drifts is the one nobody is looking at, which would
 * mean a player buying a swatch that is not what lands on the table.
 */
export function CardBackArt({ art, className }: { art: CardBackArtwork; className?: string }) {
  const { base, ink, pattern } = art;
  return (
    <svg viewBox="0 0 60 84" className={className} role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="60" height="84" rx="6" fill={base} />
      <rect x="3.5" y="3.5" width="53" height="77" rx="4" fill="none" stroke={ink} strokeWidth="1" opacity="0.55" />
      <g stroke={ink} strokeWidth="1" opacity="0.5" fill="none">
        {pattern === "lattice" && [...Array(9)].map((_, i) => (
          <g key={i}>
            <path d={`M${-20 + i * 10} 84 L${20 + i * 10} 0`} />
            <path d={`M${-20 + i * 10} 0 L${20 + i * 10} 84`} />
          </g>
        ))}
        {pattern === "chevron" && [...Array(8)].map((_, i) => (
          <path key={i} d={`M8 ${10 + i * 9} L30 ${4 + i * 9} L52 ${10 + i * 9}`} />
        ))}
        {pattern === "pinstripe" && [...Array(7)].map((_, i) => (
          <path key={i} d={`M${9 + i * 7} 5 V79`} />
        ))}
        {pattern === "rings" && [...Array(4)].map((_, i) => (
          <circle key={i} cx="30" cy="42" r={7 + i * 7} />
        ))}
        {pattern === "crest" && (
          <g>
            <path d="M30 20 L44 30 V50 L30 64 L16 50 V30 Z" />
            <path d="M30 28 L38 33 V47 L30 56 L22 47 V33 Z" />
          </g>
        )}
      </g>
    </svg>
  );
}

/**
 * The same drawing, addressed by cosmetic id instead of by artwork -- what
 * every caller on the table actually has, since a seat carries an id.
 */
export function CardBackFor({ id, className }: { id: string | null | undefined; className?: string }) {
  return <CardBackArt art={cardBackArt(id)} className={className} />;
}
