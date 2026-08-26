/**
 * The small-size StackChips mark: the badge's arc, one card, one gold spade.
 *
 * The full badge (StackChipsLogo / public/brand/stackchips-logo.png) carries a
 * four-card fan, a banner and two lines of type. Rendered at the ~50px a
 * header row allows, all of that collapses into a smudge (verified against a
 * real 1440x900 render). So the header gets this instead, and the wordmark
 * beside it supplies the name the badge would have been trying to spell.
 *
 * Same art as app/icon.svg, for the same reason, so keep the two in step.
 * Inline SVG rather than a shipped asset, same call as
 * components/card-back-art.tsx: it's a handful of paths and inherits nothing
 * from the cascade that could surprise it.
 */
export function StackChipsMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Ids are namespaced: two inline SVGs in one document share a defs
            namespace, and a bare "sweep" would collide with the next one. */}
        <linearGradient id="sc-mark-sweep" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#983fe0" />
          <stop offset=".48" stopColor="#db9c0b" />
          <stop offset="1" stopColor="#dc1413" />
        </linearGradient>
        <linearGradient id="sc-mark-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6c94a" />
          <stop offset="1" stopColor="#b48918" />
        </linearGradient>
      </defs>

      <path
        d="M84 300a172 172 0 0 1 344 0"
        fill="none"
        stroke="url(#sc-mark-sweep)"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <g transform="rotate(-9 256 300)">
        <rect x="176" y="196" width="160" height="222" rx="26" fill="#fefefe" />
        <path
          d="M256 240c0 0-58 44-58 78a30 30 0 0 0 52 21l-10 39h32l-10-39a30 30 0 0 0 52-21c0-34-58-78-58-78z"
          fill="url(#sc-mark-gold)"
        />
      </g>
    </svg>
  );
}
