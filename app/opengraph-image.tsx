import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "StackChips - Texas Hold'em";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card a link to stackchips.app renders as in Discord/iMessage/Slack/etc.
 * There was no OG image at all before this -- a shared link fell back to a
 * bare title-and-URL text card, which is invisible in a chat scrollback next
 * to any other game's actual preview.
 *
 * Draws the real Neon Marquee "S" mark (same badge gradient, glyph, and rule
 * as app/icon.svg -- keep the three in step) instead of a bespoke gradient
 * ring. The ring this replaced used the pre-rebrand --brand-* trio
 * (#983fe0/#db9c0b/#dc1413), which no longer traces to the current mark and
 * was what showed up as a stale "gradient square logo" in link previews.
 * Not a screenshot: a live table changes hand to hand and a stale screenshot
 * ages badly as a permanent asset cached by every platform that has ever
 * unfurled the link.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#150a2b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* The badge from app/icon.svg, redrawn at OG scale: gradient
            rounded-square plate, the outlined "S" glyph, and the yellow
            baseline rule underneath it. */}
        <svg width={200} height={200} viewBox="0 0 512 512" style={{ marginBottom: 44 }}>
          <defs>
            <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#211141" />
              <stop offset="1" stopColor="#150a2b" />
            </linearGradient>
          </defs>
          <rect width="512" height="512" rx="112" fill="url(#badge)" />
          <g transform="translate(256 216) scale(0.4166666666666667 -0.4166666666666667) translate(-330.5 -360.0)">
            <path
              d="M403 0H87Q51 0 51 36V153Q51 189 87 189H356Q369 189 375.5 197.5Q382 206 382 218Q382 235 375.5 243.0Q369 251 356 252L206 273Q136 284 93.5 319.5Q51 355 51 439V544Q51 630 106.0 675.0Q161 720 258 720H538Q574 720 574 684V565Q574 529 538 529H305Q278 529 278 499Q278 470 305 467L454 447Q501 440 536.0 422.5Q571 405 590.5 371.0Q610 337 610 281V176Q610 91 555.0 45.5Q500 0 403 0Z"
              fill="#f6f1ff"
            />
          </g>
          <rect x="146" y="378" width="220" height="16" rx="8" fill="#ffd23f" />
        </svg>
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 700,
            color: "#fefefe",
            letterSpacing: -2,
          }}
        >
          StackChips
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontSize: 34,
            color: "#c9c3d8",
          }}
        >
          Play-money Texas Hold&rsquo;em. No cash value, no cash out.
        </div>
      </div>
    ),
    { ...size },
  );
}
