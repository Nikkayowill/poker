import type { CSSProperties } from "react";
import type { RankTierId } from "@/lib/progression/rank";

/**
 * One arcade jewel per rank tier. Each is its own cut and colour, drawn as flat
 * facets on a 64x64 grid: a dark outline, four tones of the gem's colour from
 * bright to deep, a glint and a twinkling star. Flat tones rather than
 * gradients, so the facets stay crisp at 20px and two jewels on one page never
 * share an SVG id.
 *
 * The geometry is computed once at module load from a few points per cut.
 * Bronze is a hexagon, Silver an octagon, Platinum a kite, Emerald a step cut,
 * Diamond a brilliant, Master a round amethyst, Grandmaster a ruby shield and
 * GOAT a crowned gold gem.
 */

type Point = readonly [number, number];
type Tone = 0 | 1 | 2 | 3;
interface Facet {
  points: Point[];
  tone: Tone;
}

interface Palette {
  /** Brightest to deepest facet tone. */
  tones: [string, string, string, string];
  edge: string;
  glow: string;
}

const PALETTES: Record<RankTierId, Palette> = {
  bronze: { tones: ["#ffc08a", "#ee9a52", "#c2712c", "#8b4a17"], edge: "#3b1d08", glow: "#e58a3c" },
  silver: { tones: ["#ffffff", "#e3e9f4", "#b4bfd4", "#7986a1"], edge: "#252d42", glow: "#b9c7e6" },
  platinum: { tones: ["#d6fbff", "#79e3f2", "#2fb5d1", "#16758f"], edge: "#0a3442", glow: "#45d4ee" },
  emerald: { tones: ["#b4ffcf", "#45e08a", "#14ad55", "#0a6b34"], edge: "#04301a", glow: "#2ddf7a" },
  diamond: { tones: ["#ffffff", "#c9f0ff", "#82c9f5", "#4a8fd6"], edge: "#10305e", glow: "#8fdcff" },
  master: { tones: ["#f0cfff", "#c58af8", "#9147e0", "#5a22a6"], edge: "#27084f", glow: "#b067f5" },
  grandmaster: { tones: ["#ffb3bf", "#ff5470", "#d0153a", "#85091f"], edge: "#3a030e", glow: "#ff3b5c" },
  goat: { tones: ["#fff8c4", "#ffd84a", "#f0a30f", "#b06a05"], edge: "#4a2a02", glow: "#ffc531" },
};

const round = (n: number) => Math.round(n * 10) / 10;

function scaled(points: readonly Point[], about: Point, factor: number): Point[] {
  return points.map(([x, y]) => [round(about[0] + (x - about[0]) * factor), round(about[1] + (y - about[1]) * factor)]);
}

function regular(sides: number, radius: number, center: Point, turn = 0): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = turn + (index / sides) * Math.PI * 2;
    return [round(center[0] + Math.cos(angle) * radius), round(center[1] + Math.sin(angle) * radius)] as Point;
  });
}

/** Light from the upper left: how bright the facet facing `angle` (radians, y down) is. */
function toneFacing(angle: number): Tone {
  const lit = Math.cos(angle - (-Math.PI * 0.75));
  if (lit > 0.75) return 0;
  if (lit > 0.1) return 1;
  if (lit > -0.6) return 2;
  return 3;
}

/** A ring of quads between two matching outlines, each lit by the way it faces, plus the flat top. */
function ringCut(outer: readonly Point[], inner: readonly Point[], center: Point, top: Tone = 1): Facet[] {
  const facets: Facet[] = outer.map((from, index) => {
    const next = (index + 1) % outer.length;
    const mid: Point = [(from[0] + outer[next][0]) / 2, (from[1] + outer[next][1]) / 2];
    return {
      points: [from, outer[next], inner[next], inner[index]],
      tone: toneFacing(Math.atan2(mid[1] - center[1], mid[0] - center[0])),
    };
  });
  return [...facets, { points: [...inner], tone: top }];
}

interface Cut {
  outline: Point[];
  facets: Facet[];
}

const C: Point = [32, 32];

function buildCuts(): Record<RankTierId, Cut> {
  const hex = regular(6, 29, C, Math.PI);
  const octagon = regular(8, 29, C, Math.PI / 8);
  const kite: Point[] = [[32, 2], [58, 32], [32, 62], [6, 32]];
  const step: Point[] = [[16, 4], [48, 4], [60, 16], [60, 48], [48, 60], [16, 60], [4, 48], [4, 16]];
  const round12 = regular(12, 29, C, Math.PI / 12);
  const shield: Point[] = [[10, 6], [54, 6], [62, 28], [32, 60], [2, 28]];
  const shieldCenter: Point = [32, 28];

  const brilliant: Facet[] = [
    { points: [[20, 8], [44, 8], [40, 22], [24, 22]], tone: 0 },
    { points: [[14, 8], [20, 8], [24, 22], [2, 22]], tone: 1 },
    { points: [[50, 8], [44, 8], [40, 22], [62, 22]], tone: 2 },
    { points: [[2, 22], [22, 22], [32, 58]], tone: 3 },
    { points: [[22, 22], [42, 22], [32, 58]], tone: 1 },
    { points: [[42, 22], [62, 22], [32, 58]], tone: 2 },
  ];

  const crownBody = regular(10, 19, [32, 43], Math.PI / 10);
  const crown: Facet[] = [
    { points: [[11, 26], [11, 8], [21, 17], [21, 26]], tone: 0 },
    { points: [[21, 26], [21, 17], [32, 3], [43, 17], [43, 26]], tone: 1 },
    { points: [[53, 26], [53, 8], [43, 17], [43, 26]], tone: 2 },
    { points: [[11, 26], [53, 26], [53, 31], [11, 31]], tone: 3 },
  ];

  return {
    bronze: { outline: hex, facets: ringCut(hex, scaled(hex, C, 0.55), C) },
    silver: { outline: octagon, facets: ringCut(octagon, scaled(octagon, C, 0.52), C, 0) },
    platinum: {
      outline: kite,
      facets: [
        { points: [kite[0], kite[1], [32, 32]], tone: 1 },
        { points: [kite[1], kite[2], [32, 32]], tone: 3 },
        { points: [kite[2], kite[3], [32, 32]], tone: 2 },
        { points: [kite[3], kite[0], [32, 32]], tone: 0 },
        ...ringCut(scaled(kite, C, 0.5), scaled(kite, C, 0.22), C, 0).slice(0, 4),
      ],
    },
    emerald: {
      outline: step,
      facets: [
        ...ringCut(step, scaled(step, C, 0.72), C),
        ...ringCut(scaled(step, C, 0.72), scaled(step, C, 0.42), C).slice(0, 8),
        { points: scaled(step, C, 0.42), tone: 0 },
      ],
    },
    diamond: { outline: [[14, 8], [50, 8], [62, 22], [32, 58], [2, 22]], facets: brilliant },
    master: { outline: round12, facets: ringCut(round12, scaled(round12, C, 0.56), C, 0) },
    grandmaster: { outline: shield, facets: ringCut(shield, scaled(shield, shieldCenter, 0.5), shieldCenter) },
    goat: {
      outline: [[11, 8], [21, 17], [32, 3], [43, 17], [53, 8], [53, 31], [48, 54], [38, 62], [26, 62], [16, 54], [11, 31]],
      facets: [...ringCut(crownBody, scaled(crownBody, [32, 43], 0.55), [32, 43], 0), ...crown],
    },
  };
}

const CUTS = buildCuts();

const path = (points: readonly Point[]) => `M${points.map(([x, y]) => `${x} ${y}`).join("L")}Z`;

export interface RankJewelProps {
  tier: RankTierId;
  /** Pixel size of the square jewel. */
  size?: number;
  /** Adds the glow and the twinkle. Off for tiny inline uses. */
  shine?: boolean;
  className?: string;
  /** Read out by screen readers. Omit when the tier name is written beside it. */
  label?: string;
}

export function RankJewel({ tier, size = 40, shine = true, className, label }: RankJewelProps) {
  const palette = PALETTES[tier];
  const cut = CUTS[tier];
  const style = { "--jewel-glow": palette.glow } as CSSProperties;

  return (
    <svg
      className={["rank-jewel", shine ? "rank-jewel-shine" : "", className ?? ""].filter(Boolean).join(" ")}
      data-tier={tier}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={path(cut.outline)} fill={palette.tones[2]} stroke={palette.edge} strokeWidth="5" strokeLinejoin="round" />
      {cut.facets.map((facet, index) => (
        <path
          key={index}
          d={path(facet.points)}
          fill={palette.tones[facet.tone]}
          stroke={palette.edge}
          strokeOpacity=".35"
          strokeWidth=".8"
          strokeLinejoin="round"
        />
      ))}
      <path d={path(cut.outline)} fill="none" stroke={palette.edge} strokeWidth="2.2" strokeLinejoin="round" />
      <path className="rank-jewel-glint" d="M17 14 L26 14 L19 22 L15 22 Z" fill="#fff" fillOpacity=".75" />
      {shine && (
        <path
          className="rank-jewel-spark"
          d="M52 4 L54 10 L60 12 L54 14 L52 20 L50 14 L44 12 L50 10 Z"
          fill="#fff"
        />
      )}
    </svg>
  );
}
