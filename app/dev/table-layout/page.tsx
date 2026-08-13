"use client";

/**
 * Dev-only view of the rebuilt racetrack table geometry -- not linked from
 * any nav, just a URL to check proportions/framing against before anything
 * else (avatars, IK, chips) gets built on the anchors in
 * `lib/scene/table-anchors.ts`. Delete once that work lands, or keep it
 * around as a standing geometry check; either is fine.
 */

import { TableAnchorsDebug } from "@/components/table/scene/table-anchors-debug";
import { DESKTOP_LANDSCAPE_VIEWPORT, MOBILE_LANDSCAPE_VIEWPORT } from "@/lib/scene/table-anchors";

export default function TableLayoutDevPage() {
  return (
    <div style={{ background: "#0a0a0b", minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ color: "#f4f4f4", font: "16px system-ui, sans-serif" }}>
        Racetrack table geometry -- debug markers only, no characters yet.
      </div>
      <TableAnchorsDebug viewport={DESKTOP_LANDSCAPE_VIEWPORT} label="Desktop landscape (1600x900)" />
      <TableAnchorsDebug viewport={MOBILE_LANDSCAPE_VIEWPORT} label="Mobile landscape (844x390)" />
    </div>
  );
}
