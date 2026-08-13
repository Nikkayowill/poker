"use client";

/**
 * Dev-only view of the 2.5D table geometry -- not linked from any nav, just
 * a URL to check proportions and camera composition against before anything
 * else is built on the anchors in `lib/scene/table-anchors.ts`.
 */

import { TableAnchorsDebug } from "@/components/table/scene/table-anchors-debug";
import { DESKTOP_LANDSCAPE_FRAME, MOBILE_LANDSCAPE_FRAME } from "@/lib/scene/table-anchors";

export default function TableLayoutDevPage() {
  return (
    <div style={{ background: "#08090c", minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ color: "#f4f4f4", font: "16px system-ui, sans-serif" }}>
        2.5D table geometry &mdash; debug markers only, no characters yet.
      </div>
      <TableAnchorsDebug frame={DESKTOP_LANDSCAPE_FRAME} label="Desktop landscape (1600x900)" />
      <TableAnchorsDebug frame={MOBILE_LANDSCAPE_FRAME} label="Mobile landscape (844x390)" />
    </div>
  );
}
