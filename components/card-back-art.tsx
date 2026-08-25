import { useId } from "react";
import { cardBackArt, type CardBackArtwork } from "@/lib/cosmetics/catalog";

/**
 * Card-back artwork, drawn rather than shipped as files: an SVG stays crisp
 * at every size a card renders at (26px on a crowded opponent seat up to
 * 116px on your own hole cards), and the whole set is still only a few KB.
 *
 * This is the ornate register real card backs actually use -- a dot-stipple
 * engraved field, a scrollwork border, corner rosettes, and a tall medallion
 * split by true 180-degree rotational symmetry (a real deck's back has to
 * read the same either way up, so the bottom half IS the top half rotated,
 * not a separately-drawn mirror). It replaces an earlier pass that used
 * simpler geometric patterns (crossed lines, chevrons, rings) -- those are
 * gone, not kept as a fallback; every catalog entry now goes through this
 * one system, told apart only by its own `base`/`ink` colour pair, the same
 * way a real deck's blue and red backs are the same engraving in two inks.
 *
 * The medallion's emblem -- a spade rising off a stippled ground, wings
 * swept from its shoulders -- is original. It is NOT a redraw of the
 * Bicycle Rider Back's cherub-and-Pegasus medallion, which is USPCC's own
 * trademarked illustration; this only borrows the register (engraving
 * density, scrollwork, a split symmetric medallion), not the artwork.
 *
 * All the shape math (the wavy vine, the rosette, the wing feathers) is
 * colour-independent, so every `d` string here is built ONCE at module
 * load and reused by every instance -- only the `stroke`/`fill`/`color`
 * attributes vary per card. `useId()` still backs the one thing that IS
 * per-instance state, the stipple `<pattern>`'s id: five or six opponents
 * can hold this same back on screen at once, and a hardcoded id would have
 * every one of those SVGs resolve to whichever instance's `<defs>` landed
 * first in the DOM.
 *
 * Lives here, above both callers, rather than under components/store where it
 * started. The store's preview and the card on the felt have to be the same
 * drawing -- two implementations of "the Brass back" is two things to keep in
 * step, and the one that drifts is the one nobody is looking at, which would
 * mean a player buying a swatch that is not what lands on the table.
 */

const W = 300;
const H = 420;
const CX = 150;
const CY = 210;

// ---- scrollwork vine: a single chained-cubic wave, so it's a real curve
// (each hump's tangent is reflected into the next via SVG's `S` command)
// rather than a sine sampled into straight segments. ----------------------
function vineD(length: number, amp: number, unit: number): { d: string; halves: number; half: number } {
  const half = unit / 2;
  const halves = Math.round(length / half);
  let d = "M0 0 ";
  for (let i = 0; i < halves; i++) {
    const ex = (i + 1) * half;
    const sign = i % 2 === 0 ? -1 : 1;
    const cx2 = ex - half * 0.42;
    const cy2 = sign * amp;
    if (i === 0) {
      d += `C${(half * 0.42).toFixed(2)} ${(sign * amp).toFixed(2)} ${cx2.toFixed(2)} ${cy2.toFixed(2)} ${ex.toFixed(2)} 0 `;
    } else {
      d += `S${cx2.toFixed(2)} ${cy2.toFixed(2)} ${ex.toFixed(2)} 0 `;
    }
  }
  return { d, halves, half };
}

function vineCurls(halves: number, half: number, amp: number): string[] {
  const r = 2.6;
  const curls: string[] = [];
  for (let i = 0; i < halves; i++) {
    const cx = (i + 0.5) * half;
    const sign = i % 2 === 0 ? -1 : 1;
    const cy = sign * amp;
    curls.push(
      `M${(cx - r).toFixed(2)} ${cy.toFixed(2)} a${r} ${r} 0 1 1 ${(r * 1.6).toFixed(2)} ${(sign * r * 0.4).toFixed(2)}`,
    );
  }
  return curls;
}

const HORIZ_LEN = 168;
const VERT_LEN = 288;
const VINE_UNIT = 24;
const VINE_AMP = 8;
const HORIZ_VINE = vineD(HORIZ_LEN, VINE_AMP, VINE_UNIT);
const VERT_VINE = vineD(VERT_LEN, VINE_AMP, VINE_UNIT);
const HORIZ_CURLS = vineCurls(HORIZ_VINE.halves, HORIZ_VINE.half, VINE_AMP);
const VERT_CURLS = vineCurls(VERT_VINE.halves, VERT_VINE.half, VINE_AMP);

// ---- corner rosette: a compass-like flower, six petals -------------------
const ROSETTE_R = 26;
const ROSETTE_PETALS = 6;
const ROSETTE_TICKS = (() => {
  const ticks: { x1: number; y1: number; x2: number; y2: number; tipX: number; tipY: number }[] = [];
  for (let i = 0; i < ROSETTE_PETALS; i++) {
    const a = (i / ROSETTE_PETALS) * Math.PI * 2;
    ticks.push({
      x1: ROSETTE_R * 0.62 * Math.cos(a),
      y1: ROSETTE_R * 0.62 * Math.sin(a),
      x2: ROSETTE_R * 0.98 * Math.cos(a),
      y2: ROSETTE_R * 0.98 * Math.sin(a),
      tipX: ROSETTE_R * 0.98 * Math.cos(a),
      tipY: ROSETTE_R * 0.98 * Math.sin(a),
    });
  }
  return ticks;
})();

// ---- the medallion: a spade rising off a stippled ground, with wings
// swept from its shoulders. Built once as static path data. ----------------
function spadePath(scale: number): { body: string; stem: string } {
  const p = (x: number, y: number) => `${(x * scale).toFixed(2)} ${(y * scale).toFixed(2)}`;
  const body =
    `M${p(0, -42)} ` +
    `C${p(20, -34)} ${p(34, -18)} ${p(32, -4)} ` +
    `C${p(30, 8)} ${p(14, 14)} ${p(0, 20)} ` +
    `C${p(-14, 14)} ${p(-30, 8)} ${p(-32, -4)} ` +
    `C${p(-34, -18)} ${p(-20, -34)} ${p(0, -42)} Z`;
  const stem = `M${p(0, 20)} C${p(-6, 27)} ${p(-6, 33)} ${p(0, 39)} C${p(6, 33)} ${p(6, 27)} ${p(0, 20)} Z`;
  return { body, stem };
}

function wingPaths(side: -1 | 1, scale: number): { outline: string; ribs: string[] } {
  const x = (v: number) => (side * v * scale).toFixed(2);
  const y = (v: number) => (v * scale).toFixed(2);
  const outline =
    `M${x(9)} ${y(-15)} ` +
    `Q${x(34)} ${y(-52)} ${x(60)} ${y(-40)} ` +
    `Q${x(46)} ${y(-30)} ${x(48)} ${y(-12)} ` +
    `Q${x(30)} ${y(-16)} ${x(19)} ${y(-2)} ` +
    `Q${x(13)} ${y(-8)} ${x(9)} ${y(-15)} Z`;
  const ribs = [0.72, 0.5, 0.3].map(
    (f) => `M${x(9)} ${y(-15)} Q${x(24 + f)} ${y(-30 - 12 * f)} ${x(20 + 34 * f)} ${y(-14 - 22 * f)}`,
  );
  return { outline, ribs };
}

function groundHatch(scale: number): { arc: string; ticks: string[] } {
  const gy = 46 * scale;
  const arc = `M${(-28 * scale).toFixed(2)} ${gy.toFixed(2)} Q0 ${(gy + 9 * scale).toFixed(2)} ${(28 * scale).toFixed(2)} ${gy.toFixed(2)}`;
  const ticks: string[] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const x = -26 * scale + t * 52 * scale;
    const yy = gy + Math.sin(t * Math.PI) * 8 * scale;
    ticks.push(`M${x.toFixed(2)} ${(yy - 3.5).toFixed(2)} L${x.toFixed(2)} ${(yy + 3.5).toFixed(2)}`);
  }
  return { arc, ticks };
}

const EMBLEM_SCALE = 1;
const SPADE = spadePath(EMBLEM_SCALE * 1.28);
const WING_LEFT = wingPaths(-1, EMBLEM_SCALE * 0.86);
const WING_RIGHT = wingPaths(1, EMBLEM_SCALE * 0.86);
const GROUND = groundHatch(EMBLEM_SCALE);
const OVAL_RX = 74;
const OVAL_RY = 92;
const TOP_EMBLEM_Y = 145;

function Rosette() {
  return (
    <>
      <circle cx="0" cy="0" r={ROSETTE_R} fill="none" strokeWidth="1" />
      <circle cx="0" cy="0" r={ROSETTE_R * 0.6} fill="none" strokeWidth="0.8" />
      <circle cx="0" cy="0" r={ROSETTE_R * 0.14} fill="currentColor" stroke="none" />
      {ROSETTE_TICKS.map((t, i) => (
        <g key={i}>
          <path d={`M${t.x1.toFixed(2)} ${t.y1.toFixed(2)} L${t.x2.toFixed(2)} ${t.y2.toFixed(2)}`} strokeWidth="0.8" />
          <circle cx={t.tipX.toFixed(2)} cy={t.tipY.toFixed(2)} r="1.5" fill="currentColor" stroke="none" />
        </g>
      ))}
    </>
  );
}

function VineEdge({ vine, curls }: { vine: typeof HORIZ_VINE; curls: string[] }) {
  return (
    <>
      <path d={vine.d} fill="none" strokeWidth="1.1" />
      {curls.map((c, i) => (
        <path key={i} d={c} fill="none" strokeWidth="0.85" opacity="0.9" />
      ))}
    </>
  );
}

function WingedSpade() {
  return (
    <>
      <path d={WING_LEFT.outline} fill="none" strokeWidth="1.2" />
      {WING_LEFT.ribs.map((d, i) => (
        <path key={i} d={d} fill="none" strokeWidth={0.8 - i * 0.12} opacity={0.75 - i * 0.12} />
      ))}
      <path d={WING_RIGHT.outline} fill="none" strokeWidth="1.2" />
      {WING_RIGHT.ribs.map((d, i) => (
        <path key={i} d={d} fill="none" strokeWidth={0.8 - i * 0.12} opacity={0.75 - i * 0.12} />
      ))}
      <path d={SPADE.body} fill="none" strokeWidth="1.5" />
      <path d={SPADE.stem} fill="none" strokeWidth="1" />
      <path d={GROUND.arc} fill="none" strokeWidth="1" />
      {GROUND.ticks.map((d, i) => (
        <path key={i} d={d} strokeWidth="0.6" opacity="0.8" />
      ))}
    </>
  );
}

export function CardBackArt({ art, className }: { art: CardBackArtwork; className?: string }) {
  const { base, ink } = art;
  const stippleId = `cb-field-${useId().replace(/:/g, "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-hidden="true">
      <defs>
        {/* the engraved-field texture: a tiled pair of dots, cheap to
            repeat at any size since the browser tiles it, not React */}
        <pattern id={stippleId} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.55" fill={ink} />
          <circle cx="4.5" cy="4.5" r="0.55" fill={ink} />
        </pattern>
      </defs>

      <rect width={W} height={H} rx="24" fill={base} />
      <g color={ink} stroke={ink} fill="none">
        <rect x="46" y="46" width={W - 92} height={H - 92} rx="8" fill={`url(#${stippleId})`} opacity="0.55" stroke="none" />
        <rect x="14" y="14" width={W - 28} height={H - 28} rx="20" strokeWidth="1.4" opacity="0.95" />
        <rect x="46" y="46" width={W - 92} height={H - 92} rx="8" strokeWidth="1" opacity="0.85" />

        <g strokeWidth="1" opacity="0.92">
          <g transform={`translate(${(W - HORIZ_LEN) / 2},30)`}>
            <VineEdge vine={HORIZ_VINE} curls={HORIZ_CURLS} />
          </g>
          <g transform={`translate(${(W - HORIZ_LEN) / 2},${H - 30}) scale(1,-1)`}>
            <VineEdge vine={HORIZ_VINE} curls={HORIZ_CURLS} />
          </g>
          <g transform={`translate(30,${(H - VERT_LEN) / 2}) rotate(90)`}>
            <VineEdge vine={VERT_VINE} curls={VERT_CURLS} />
          </g>
          <g transform={`translate(${W - 30},${(H - VERT_LEN) / 2}) rotate(90) scale(1,-1)`}>
            <VineEdge vine={VERT_VINE} curls={VERT_CURLS} />
          </g>
        </g>

        <g strokeWidth="1" opacity="0.95">
          <g transform="translate(40,40)"><Rosette /></g>
          <g transform={`translate(${W - 40},40) scale(-1,1)`}><Rosette /></g>
          <g transform={`translate(40,${H - 40}) scale(1,-1)`}><Rosette /></g>
          <g transform={`translate(${W - 40},${H - 40}) scale(-1,-1)`}><Rosette /></g>
        </g>

        {/* the medallion: one emblem built, the other is its own
            180-degree twin -- a real deck's back has to read the same
            either way up, so the bottom half IS the top half, rotated,
            not a second drawing that merely mirrors it */}
        <g strokeWidth="1" opacity="0.95">
          <g transform={`translate(${CX},${TOP_EMBLEM_Y})`}>
            <ellipse cx="0" cy="0" rx={OVAL_RX} ry={OVAL_RY} fill="none" strokeWidth="1" strokeDasharray="0 6.6" strokeLinecap="round" opacity="0.85" />
            <WingedSpade />
          </g>
          <g transform={`rotate(180 ${CX} ${CY})`}>
            <g transform={`translate(${CX},${TOP_EMBLEM_Y})`}>
              <ellipse cx="0" cy="0" rx={OVAL_RX} ry={OVAL_RY} fill="none" strokeWidth="1" strokeDasharray="0 6.6" strokeLinecap="round" opacity="0.85" />
              <WingedSpade />
            </g>
          </g>
        </g>
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
