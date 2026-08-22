/**
 * Dev-only view of the 2.5D table geometry -- not linked from any nav, just
 * a URL to check proportions and camera composition against before anything
 * else is built on the anchors in `lib/scene/table-anchors.ts`.
 *
 * Seat art sizing/position is tuned in code now, not from this page: seat3
 * and seat4 (flanking the dealer) are locked to `SEAT_ART_SLOT` in
 * `lib/scene/seat-art.ts`; the other three each have their own entry in
 * that file's `SEAT_ART_OVERRIDES` (scale, crown, and an offsetX/offsetY
 * nudge in screen pixels) for hand-tuning individually. Edit either and
 * save -- the dev server picks it up.
 */

import { TableAnchorsDebug } from "@/components/table/scene/table-anchors-debug";
import { DESKTOP_LANDSCAPE_FRAME, MOBILE_LANDSCAPE_FRAME } from "@/lib/scene/table-anchors";

export default function TableLayoutDevPage() {
  return (
    <div style={{ background: "#08090c", minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ color: "#f4f4f4", font: "16px system-ui, sans-serif" }}>
        2.5D table geometry &mdash; seat3/seat4 are locked to <code>SEAT_ART_SLOT</code>;
        seat1/seat2/seat5 are hand-tuned in <code>SEAT_ART_OVERRIDES</code>, both in{" "}
        <code>lib/scene/seat-art.ts</code>. Edit and save to see it update.
      </div>
      <TableAnchorsDebug frame={DESKTOP_LANDSCAPE_FRAME} label="Desktop landscape (1600x900)" seatArt="character16" />
      <TableAnchorsDebug frame={MOBILE_LANDSCAPE_FRAME} label="Mobile landscape (844x390)" seatArt="character16" />
    </div>
  );
}
