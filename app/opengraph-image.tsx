import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "StackChips - Texas Hold'em";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card a link to stackchips.app renders as in Discord/iMessage/Slack/etc.
 * There was no OG image at all before this -- a shared link fell back to a
 * bare title-and-URL text card, which is invisible in a chat scrollback next
 * to any other game's actual preview. Same three brand colours as
 * app/icon.svg's sweep (#983fe0/#db9c0b/#dc1413), not a screenshot: a live
 * table changes hand to hand and a stale screenshot ages badly as a permanent
 * asset cached by every platform that has ever unfurled the link.
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
          background: "#0a0710",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* A gradient "ring" via a padding-box trick, not border-image --
            Satori (next/og's renderer) doesn't implement border-image, which
            rendered this whole mark invisible until caught by actually
            fetching the deployed image rather than trusting the build to
            catch it (ImageResponse runs at request time, not build time). */}
        <div
          style={{
            display: "flex",
            width: 220,
            height: 220,
            borderRadius: 48,
            padding: 10,
            background: "linear-gradient(100deg, #983fe0 0%, #db9c0b 52%, #dc1413 100%)",
            marginBottom: 44,
          }}
        >
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "100%",
              borderRadius: 38,
              background: "#0a0710",
            }}
          />
        </div>
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
