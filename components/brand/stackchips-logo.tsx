/**
 * The StackChips wordmark, hero variant: tilted -2deg with a soft two-colour
 * glow, per the Neon Marquee brand concept. Large placements only (today
 * that's just the sign-in screen) -- components/brand/stackchips-mark.tsx is
 * what a header row gets instead, since the glow costs more to render than
 * it is worth at UI scale and a full wordmark collapses into a smudge below
 * hero size anyway.
 *
 * Inline SVG, not an <Image> pointed at a rasterized copy: the glyphs are
 * outlined straight from Bungee-Regular (see
 * public/brand/concepts/neon-marquee/README.md for how they were built), so
 * there is no font to load and no raster to go soft at an arbitrary display
 * size. Sizing is left entirely to the caller's CSS (see .entry-logo in
 * 04-lobby.css) -- this only fixes the SVG's own aspect ratio via its
 * viewBox.
 */
export function StackChipsLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-233 -1004 7571 1288"
      className={className}
      role="img"
      aria-label="StackChips"
    >
      <defs>
        <filter id="sc-logo-glow-purple" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="34" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="0 0 0 0 0.608  0 0 0 0 0.247  0 0 0 0 0.941  0 0 0 0.85 0"
          />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="sc-logo-glow-yellow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="34" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="0 0 0 0 1  0 0 0 0 0.824  0 0 0 0 0.247  0 0 0 0.85 0"
          />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g transform="rotate(-2 3552.5 -360.0) scale(1,-1)">
        <path
          d="M403 0H87Q51 0 51 36V153Q51 189 87 189H356Q369 189 375.5 197.5Q382 206 382 218Q382 235 375.5 243.0Q369 251 356 252L206 273Q136 284 93.5 319.5Q51 355 51 439V544Q51 630 106.0 675.0Q161 720 258 720H538Q574 720 574 684V565Q574 529 538 529H305Q278 529 278 499Q278 470 305 467L454 447Q501 440 536.0 422.5Q571 405 590.5 371.0Q610 337 610 281V176Q610 91 555.0 45.5Q500 0 403 0Z M1099 0H937Q901 0 901 36V527H754Q718 527 718 563V684Q718 720 754 720H1282Q1318 720 1318 684V563Q1318 527 1282 527H1135V36Q1135 0 1099 0Z M1659 36Q1659 0 1623 0H1476Q1440 0 1440 36V300Q1440 330 1449.5 369.0Q1459 408 1479 460L1566 687Q1577 720 1617 720H1886Q1925 720 1936 687L2023 460Q2043 408 2052.5 369.0Q2062 330 2062 300V36Q2062 0 2026 0H1875Q1836 0 1836 36V176H1659ZM1716 510 1669 358H1826L1779 510Q1772 527 1760 527H1735Q1723 527 1716 510Z M2704 0H2460Q2334 0 2274.0 50.0Q2214 100 2214 204V515Q2214 620 2274.0 670.0Q2334 720 2460 720H2704Q2740 720 2740 684V563Q2740 527 2704 527H2503Q2442 527 2442 477V239Q2442 191 2503 191H2704Q2740 191 2740 155V36Q2740 0 2704 0Z M3084 0H2929Q2893 0 2893 36V684Q2893 720 2929 720H3084Q3120 720 3120 684V454H3160L3263 687Q3277 720 3313 720H3467Q3503 720 3489 687L3387 454Q3443 451 3476.5 414.5Q3510 378 3510 318V36Q3510 0 3474 0H3320Q3284 0 3284 36V231Q3284 265 3252 265H3120V36Q3120 0 3084 0Z"
          fill="#f6f1ff"
          filter="url(#sc-logo-glow-purple)"
        />
        <path
          d="M4158 0H3914Q3788 0 3728.0 50.0Q3668 100 3668 204V515Q3668 620 3728.0 670.0Q3788 720 3914 720H4158Q4194 720 4194 684V563Q4194 527 4158 527H3957Q3896 527 3896 477V239Q3896 191 3957 191H4158Q4194 191 4194 155V36Q4194 0 4158 0Z M4538 0H4383Q4347 0 4347 36V684Q4347 720 4383 720H4538Q4574 720 4574 684V467H4741V684Q4741 720 4777 720H4932Q4968 720 4968 684V36Q4968 0 4932 0H4777Q4741 0 4741 36V258H4574V36Q4574 0 4538 0Z M5166 0Q5130 0 5130 36V155Q5130 191 5166 191H5265V527H5166Q5130 527 5130 563V684Q5130 720 5166 720H5592Q5628 720 5628 684V563Q5628 527 5592 527H5495V191H5592Q5628 191 5628 155V36Q5628 0 5592 0Z M5982 0H5827Q5791 0 5791 36V684Q5791 720 5827 720H6133Q6224 720 6275.5 695.5Q6327 671 6348.0 627.0Q6369 583 6369 525V397Q6369 339 6348.0 295.0Q6327 251 6275.5 226.5Q6224 202 6133 202H6018V36Q6018 0 5982 0ZM6016 533V382H6106Q6135 382 6144.0 397.0Q6153 412 6153 431V484Q6153 504 6144.0 518.5Q6135 533 6106 533Z M6847 0H6531Q6495 0 6495 36V153Q6495 189 6531 189H6800Q6813 189 6819.5 197.5Q6826 206 6826 218Q6826 235 6819.5 243.0Q6813 251 6800 252L6650 273Q6580 284 6537.5 319.5Q6495 355 6495 439V544Q6495 630 6550.0 675.0Q6605 720 6702 720H6982Q7018 720 7018 684V565Q7018 529 6982 529H6749Q6722 529 6722 499Q6722 470 6749 467L6898 447Q6945 440 6980.0 422.5Q7015 405 7034.5 371.0Q7054 337 7054 281V176Q7054 91 6999.0 45.5Q6944 0 6847 0Z"
          fill="#ffd23f"
          filter="url(#sc-logo-glow-yellow)"
        />
      </g>
    </svg>
  );
}
