/**
 * What a felled tree, a cleared stump or a broken rock turns into: the arcade's
 * particle orb (the sign-in prototype, claude.ai/artifact/7fruxyDb8qaLU11MHgtSow),
 * scaled down to the farm.
 *
 * Four beats, the same ones the orb plays when a game is won:
 *
 * 1. The thing's own pixels swarm into a small orb above where it stood. Each
 *    point starts a little later than the last (its `seed`), eases in and out,
 *    and swirls around the middle on the way, so it reads as a swarm and not
 *    a crossfade. Colour slides from the pixel's own to the orb's.
 * 2. The orb holds for a beat: a sphere turning slowly, with rainbow bands
 *    drifting across it like oil on water, and a liquid wobble.
 * 3. It splits into a handful of coins, each a disc of points, hovering and
 *    spinning around where the orb was.
 * 4. The coins fly into the farmer one after another, nearest first, along an
 *    arc, shrinking as they land. Each landing is a beat of its own
 *    (`motesLanded`), the way each coin bumped the Gold pill.
 *
 * Pure and renderer-free: components/arcade/stackacres-td/orb-burst.ts
 * samples the pixels and draws what this answers.
 */

export interface OrbPixel {
  readonly x: number;
  readonly y: number;
  readonly colour: number;
}

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface OrbPoint {
  readonly from: OrbPixel;
  /** Where on the unit sphere it sits in the orb. */
  readonly sphere: Point3;
  /** Which coin it becomes, and where on that coin's face. */
  readonly mote: number;
  readonly local: { readonly x: number; readonly y: number };
  /** 0-1: how late it starts the swarm. */
  readonly seed: number;
  /** 0-1: which way and how hard it swirls. */
  readonly seed2: number;
  /** 0.7-1: how bright it burns, so the orb has depth. */
  readonly shade: number;
}

export interface OrbBurst {
  readonly points: readonly OrbPoint[];
  readonly centre: { readonly x: number; readonly y: number };
  /** The orb's radius, in map pixels. */
  readonly radius: number;
  /** Where each coin hovers, as an offset from the centre. */
  readonly hover: readonly { readonly x: number; readonly y: number }[];
  /** Each coin's place in the flight order: 0 leaves first. */
  readonly order: readonly number[];
  /** Each coin's own colour: a hue each, like the orb's coloured coins. */
  readonly moteColour: readonly number[];
}

export interface OrbFrame {
  readonly x: number;
  readonly y: number;
  /** 1 at full size. */
  readonly size: number;
  /** 0-1. */
  readonly alpha: number;
  readonly colour: number;
  readonly landed: boolean;
}

/** The swarm into the orb. */
export const SWARM_MS = 620;
/** The orb holding. */
export const HOLD_MS = 380;
/** The orb splitting into coins. */
export const SPLIT_MS = 260;
/** The coins hovering before the first one leaves. */
export const HOVER_MS = 160;
/** Between one coin leaving and the next. */
export const COIN_STAGGER_MS = 70;
/** One coin's flight. */
export const COIN_FLY_MS = 440;
/** How many coins the orb splits into. */
export const COINS = 7;

const SPLIT_AT = SWARM_MS + HOLD_MS;
const FLY_AT = SPLIT_AT + SPLIT_MS + HOVER_MS;
/** From the break to the last coin landing. */
export const ORB_BURST_MS = FLY_AT + (COINS - 1) * COIN_STAGGER_MS + COIN_FLY_MS;

/** The orb's share of the swarm stagger, the prototype's 0.35. */
const STAGGER = 0.35;
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** A coin's face, in map pixels. */
const COIN_RADIUS = 3.2;

/**
 * An orb for `pixels`, standing over `centre` with a radius to suit how big
 * the thing was, whose coins leave nearest to `toward` first.
 */
export function makeOrbBurst(
  pixels: readonly OrbPixel[],
  centre: { x: number; y: number },
  toward: { x: number; y: number },
  random: () => number = Math.random,
): OrbBurst {
  let spread = 0;
  for (const pixel of pixels) spread = Math.max(spread, Math.hypot(pixel.x - centre.x, pixel.y - centre.y));
  const radius = Math.min(12, Math.max(6, spread * 0.4));
  // Sorted along one diagonal, the orb's own trick: point i sits in about the same
  // part of the tree as it does of the orb, so the swarm flows instead of scrambling.
  const sorted = [...pixels].sort((a, b) => a.x + a.y * 0.35 - (b.x + b.y * 0.35));
  const n = sorted.length;
  const hover = Array.from({ length: COINS }, (_, k) => {
    const a = (k / COINS) * TAU + random() * 0.5;
    const r = radius * (1.15 + 0.35 * random());
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75 - radius * 0.2 };
  });
  const byDistance = hover
    .map((h, k) => ({ k, d: Math.hypot(centre.x + h.x - toward.x, centre.y + h.y - toward.y) }))
    .sort((a, b) => a.d - b.d);
  const order: number[] = new Array(COINS);
  byDistance.forEach(({ k }, rank) => (order[k] = rank));
  const moteColour = hover.map((_, k) => rainbow(k / COINS + 0.08, 0.15));
  const points = sorted.map((from, j): OrbPoint => {
    const y = 1 - (2 * (j + 0.5)) / Math.max(1, n);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = j * GOLDEN;
    const sphere = { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
    // A coin takes the points on its side of the orb, so each forms from the part nearest it.
    const angle = Math.atan2(sphere.y, sphere.x);
    let mote = 0;
    let best = Infinity;
    for (let k = 0; k < COINS; k++) {
      const d = Math.abs(wrap(Math.atan2(hover[k].y, hover[k].x) - angle));
      if (d < best) {
        best = d;
        mote = k;
      }
    }
    const la = random() * TAU;
    const lr = COIN_RADIUS * Math.sqrt(random());
    return {
      from,
      sphere,
      mote,
      local: { x: Math.cos(la) * lr, y: Math.sin(la) * lr },
      seed: random(),
      seed2: random(),
      shade: 0.7 + 0.3 * random(),
    };
  });
  return { points, centre: { x: centre.x, y: centre.y }, radius, hover, order, moteColour };
}

/** Where one point is `ms` into the burst, its coin flying to `target` (his chest, read live). */
export function orbPointAt(burst: OrbBurst, point: OrbPoint, ms: number, target: { x: number; y: number }): OrbFrame {
  const t = ms / 1000;
  const orb = orbPosition(burst, point, t);
  if (ms < SWARM_MS) {
    const p = ms / SWARM_MS;
    const q = clamp01((p - point.seed * STAGGER) / (1 - STAGGER));
    const e = easeInOut(q);
    // The mid-flight swirl: turn about the middle and push out, most at the halfway mark.
    const mid = Math.sin(Math.PI * e);
    const turn = mid * (point.seed2 - 0.5) * 1.6;
    const push = 1 + mid * 0.28 * point.seed2;
    const x = point.from.x + (orb.x - point.from.x) * e - burst.centre.x;
    const y = point.from.y + (orb.y - point.from.y) * e - burst.centre.y;
    return {
      x: burst.centre.x + (x * Math.cos(turn) - y * Math.sin(turn)) * push,
      y: burst.centre.y + (x * Math.sin(turn) + y * Math.cos(turn)) * push,
      size: 0.8 + 0.2 * orb.depth,
      alpha: point.shade * (0.75 + 0.25 * e),
      colour: mix(point.from.colour, orb.colour, e),
      landed: false,
    };
  }
  if (ms < SPLIT_AT) {
    return { x: orb.x, y: orb.y, size: 0.75 + 0.35 * orb.depth, alpha: point.shade * (0.7 + 0.3 * orb.depth), colour: orb.colour, landed: false };
  }
  const coin = coinFace(burst, point, ms, target);
  if (ms < SPLIT_AT + SPLIT_MS) {
    const e = easeInOut((ms - SPLIT_AT) / SPLIT_MS);
    return {
      x: orb.x + (coin.x - orb.x) * e,
      y: orb.y + (coin.y - orb.y) * e,
      size: 0.8,
      alpha: point.shade,
      colour: mix(orb.colour, burst.moteColour[point.mote], e),
      landed: false,
    };
  }
  return { ...coin, alpha: point.shade * (coin.landed ? 0 : 1), colour: burst.moteColour[point.mote] };
}

/** How many coins have landed on him by `ms`. */
export function motesLanded(burst: OrbBurst, ms: number): number {
  let landed = 0;
  for (let k = 0; k < COINS; k++) if (ms >= FLY_AT + burst.order[k] * COIN_STAGGER_MS + COIN_FLY_MS) landed += 1;
  return landed;
}

/** A point in the orb: the sphere turning, with a liquid wobble and drifting rainbow bands. */
function orbPosition(burst: OrbBurst, point: OrbPoint, t: number): { x: number; y: number; depth: number; colour: number } {
  const spin = t * 1.8;
  const { x, y, z } = point.sphere;
  const rx = x * Math.cos(spin) - z * Math.sin(spin);
  const rz = x * Math.sin(spin) + z * Math.cos(spin);
  const wobble = 1 + 0.07 * Math.sin(2.6 * rx + t * 1.9) * Math.cos(2.2 * y - t * 1.4) + 0.03 * Math.sin(4 * rz + t * 2.7);
  const hue = y * 0.22 + rx * 0.14 + rz * 0.1 + t * 0.25 + point.seed * 0.04;
  return {
    x: burst.centre.x + rx * burst.radius * wobble,
    y: burst.centre.y + y * burst.radius * wobble,
    depth: (rz + 1) / 2,
    colour: rainbow(hue, 0.1),
  };
}

/** A point on its coin's face: hovering and spinning, then flying to him. */
function coinFace(burst: OrbBurst, point: OrbPoint, ms: number, target: { x: number; y: number }): OrbFrame {
  const k = point.mote;
  const t = ms / 1000;
  let cx = burst.centre.x + burst.hover[k].x;
  let cy = burst.centre.y + burst.hover[k].y + 0.6 * Math.sin(t * 5 + k);
  let scale = 1;
  let landed = false;
  const leave = FLY_AT + burst.order[k] * COIN_STAGGER_MS;
  if (ms >= leave) {
    const u = clamp01((ms - leave) / COIN_FLY_MS);
    const e = u * u;
    cx += (target.x - cx) * e;
    cy += (target.y - cy) * e - 10 * Math.sin(Math.PI * u);
    scale = 1 - 0.85 * e;
    landed = u >= 1;
  }
  // Spinning about its upright axis, like a coin tossed.
  const turn = Math.cos(t * (6 + k * 0.7));
  return { x: cx + point.local.x * turn * scale, y: cy + point.local.y * scale, size: 0.6 + 0.4 * scale, alpha: 1, colour: 0, landed };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** A full-spectrum colour for `hue` (turns), lifted toward white by `lift`. */
function rainbow(hue: number, lift: number): number {
  const channel = (offset: number) => {
    const v = 0.5 + 0.5 * Math.cos(TAU * (hue - offset));
    return Math.round((v + (1 - v) * lift) * 255);
  };
  return (channel(0) << 16) | (channel(1 / 3) << 8) | channel(2 / 3);
}

function mix(a: number, b: number, t: number): number {
  const lerp = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}
