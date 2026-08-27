/**
 * The small-size StackChips mark: the Bungee "S" from the wordmark, alone,
 * with its yellow baseline rule.
 *
 * The full wordmark (StackChipsLogo / components/brand/stackchips-logo.tsx)
 * spells out both words. Rendered at the ~50px a header row allows, that
 * collapses into a smudge (verified against a real 1440x900 render), so the
 * header gets this instead: one glyph, unmistakable at any size, standing in
 * for the name the wordmark would have been trying to spell.
 *
 * Same art as app/icon.svg, minus its badge plate: this mark sits directly
 * on the app's own chrome rather than needing a background of its own, so
 * keep the two in step. Inline SVG rather than a shipped asset, same call as
 * components/card-back-art.tsx: it's a handful of paths and inherits nothing
 * from the cascade that could surprise it. Outlined from the real
 * Bungee-Regular glyph (see public/brand/concepts/neon-marquee/README.md for
 * how), not <text> with a font-family, so there is no fallback-font risk if
 * Bungee is slow or fails to load.
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
      <g transform="translate(256 216) scale(0.4166666666666667 -0.4166666666666667) translate(-330.5 -360.0)">
        <path
          d="M403 0H87Q51 0 51 36V153Q51 189 87 189H356Q369 189 375.5 197.5Q382 206 382 218Q382 235 375.5 243.0Q369 251 356 252L206 273Q136 284 93.5 319.5Q51 355 51 439V544Q51 630 106.0 675.0Q161 720 258 720H538Q574 720 574 684V565Q574 529 538 529H305Q278 529 278 499Q278 470 305 467L454 447Q501 440 536.0 422.5Q571 405 590.5 371.0Q610 337 610 281V176Q610 91 555.0 45.5Q500 0 403 0Z"
          fill="#f6f1ff"
        />
      </g>
      <rect x="146" y="378" width="220" height="16" rx="8" fill="#ffd23f" />
    </svg>
  );
}
