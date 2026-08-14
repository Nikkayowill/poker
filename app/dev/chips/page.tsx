/**
 * Dev-only bench for the 2.5D chip system -- not linked from any nav, just a
 * URL to judge the chips at the pixel scales the real table renders at.
 *
 * The two scales are measured, not picked: `fitView` gives the classic room
 * `(railWidth / 2 / RAIL_SCALE) / FELT.radiusX` pixels per world unit, so a
 * 900px desktop rail lands near 44 and a 340px phone rail near 17. Art judged
 * at any other size is art judged at the wrong size.
 */

import { ChipBoard, ChipMotionLab } from "@/components/table/scene/chip-lab";

export default function ChipLabPage() {
  return (
    <div style={{ background: "#08090c", minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ color: "#f4f4f4", font: "16px system-ui, sans-serif", maxWidth: 720, lineHeight: 1.5 }}>
        2.5D chip system. Top row: one chip per denomination. Middle: columns of
        1/3/5/9. Bottom: the pot at 1, 6, 14, 27 and 54 chips &mdash; the
        silhouette is what tells a player the size.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
        <ChipBoard label="Desktop rail (~44 px/unit)" pixelsPerUnit={44} />
        <ChipBoard label="Portrait phone rail (~17 px/unit)" pixelsPerUnit={17} />
        <ChipBoard label="Large desktop (~60 px/unit)" pixelsPerUnit={60} />
        <ChipMotionLab pixelsPerUnit={44} />
      </div>
    </div>
  );
}
