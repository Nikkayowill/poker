/**
 * The payout half of the arcade's particle orb (the sign-in prototype,
 * claude.ai/artifact/7fruxyDb8qaLU11MHgtSow; StackAcres' own copy lives at
 * lib/stackacres-td/orb-burst.ts, sampling a felled tree's pixels). This is
 * the same three-beat shape -- swarm into an orb, hold, split into coins that
 * fly to a live target -- reworked for plain viewport pixels instead of a
 * Phaser scene, since a poker table, a duel and an arcade result screen share
 * no renderer: a handful of synthetic gold specks stand in for sampled
 * pixels, and "the farmer's chest" becomes wherever the header's Gold badge
 * actually sits on screen right now.
 *
 * Pure and renderer-free, same discipline as the StackAcres original --
 * components/celebration/win-celebration.tsx samples nothing and draws
 * whatever this answers on a plain 2D canvas.
 */

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface WinOrbSpeck {
  readonly x: number;
  readonly y: number;
  readonly hue: number;
}

export interface WinOrbPoint {
  readonly from: WinOrbSpeck;
  /** Where on the unit sphere it sits in the orb. */
  readonly sphere: Point3;
  /** Which coin it becomes. */
  readonly coin: number;
  readonly local: { readonly x: number; readonly y: number };
  /** 0-1: how late it starts the swarm. */
  readonly seed: number;
  /** 0-1: which way and how hard it swirls. */
  readonly seed2: number;
  /** 0.7-1: how bright it burns, so the orb has depth. */
  readonly shade: number;
}

export interface WinOrbBurst {
  readonly points: readonly WinOrbPoint[];
  readonly centre: { readonly x: number; readonly y: number };
  readonly radius: number;
  /** Where each coin hovers, as an offset from the centre. */
  readonly hover: readonly { readonly x: number; readonly y: number }[];
  /** Each coin's place in the flight order: 0 leaves first. */
  readonly order: readonly number[];
}

export interface WinOrbFrame {
  readonly x: number;
  readonly y: number;
  /** 1 at full size. */
  readonly size: number;
  /** 0-1. */
  readonly alpha: number;
  readonly hue: number;
  readonly landed: boolean;
}

/** The swarm into the orb. */
export const SWARM_MS = 540;
/** The orb holding, spinning. */
export const HOLD_MS = 400;
/** The orb splitting into coins. */
export const SPLIT_MS = 210;
/** The coins hovering before the first one leaves. */
export const HOVER_MS = 140;
/** Between one coin leaving and the next. */
export const COIN_STAGGER_MS = 70;
/** One coin's flight to the balance. */
export const COIN_FLY_MS = 440;
/** How many coins the orb splits into -- an accent, not a spectacle. */
export const COINS = 5;
/** How many specks swarm into the orb -- dense enough to read as a solid,
 * liquid sphere rather than a scatter of dots. */
export const SPECKS = 110;

const SPLIT_AT = SWARM_MS + HOLD_MS;
const FLY_AT = SPLIT_AT + SPLIT_MS + HOVER_MS;
/** From the win landing to the last coin reaching the balance. */
export const WIN_ORB_MS = FLY_AT + (COINS - 1) * COIN_STAGGER_MS + COIN_FLY_MS;

const STAGGER = 0.35;
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** A ring of synthetic gold specks around `centre`, standing in for sampled pixels. */
export function goldSpecks(centre: { x: number; y: number }, radius: number, random: () => number): WinOrbSpeck[] {
  return Array.from({ length: SPECKS }, () => {
    const a = random() * TAU;
    const r = radius * Math.sqrt(random());
    return {
      x: centre.x + Math.cos(a) * r,
      y: centre.y + Math.sin(a) * r,
      // Warm gold band with a little variation, not a flat colour -- some
      // amber, some pale, the way real coins catch light differently.
      hue: 42 + (random() - 0.5) * 18,
    };
  });
}

/**
 * An orb over `centre`, whose coins fly to `toward` (the live target),
 * nearest first.
 */
export function makeWinOrb(
  specks: readonly WinOrbSpeck[],
  centre: { x: number; y: number },
  toward: { x: number; y: number },
  orbRadius: number,
  random: () => number = Math.random,
): WinOrbBurst {
  const sorted = [...specks].sort((a, b) => a.x + a.y * 0.35 - (b.x + b.y * 0.35));
  const n = sorted.length;
  const hover = Array.from({ length: COINS }, (_, k) => {
    const a = (k / COINS) * TAU + random() * 0.5;
    const r = orbRadius * (1.15 + 0.35 * random());
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75 - orbRadius * 0.2 };
  });
  const byDistance = hover
    .map((h, k) => ({ k, d: Math.hypot(centre.x + h.x - toward.x, centre.y + h.y - toward.y) }))
    .sort((a, b) => a.d - b.d);
  const order: number[] = new Array(COINS);
  byDistance.forEach(({ k }, rank) => (order[k] = rank));
  const points = sorted.map((from, j): WinOrbPoint => {
    const y = 1 - (2 * (j + 0.5)) / Math.max(1, n);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = j * GOLDEN;
    const sphere = { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
    const angle = Math.atan2(sphere.y, sphere.x);
    let coin = 0;
    let best = Infinity;
    for (let k = 0; k < COINS; k++) {
      const d = Math.abs(wrap(Math.atan2(hover[k].y, hover[k].x) - angle));
      if (d < best) {
        best = d;
        coin = k;
      }
    }
    const la = random() * TAU;
    const lr = 2.6 * Math.sqrt(random());
    return {
      from,
      sphere,
      coin,
      local: { x: Math.cos(la) * lr, y: Math.sin(la) * lr },
      seed: random(),
      seed2: random(),
      shade: 0.7 + 0.3 * random(),
    };
  });
  return { points, centre: { x: centre.x, y: centre.y }, radius: orbRadius, hover, order };
}

/** Where one point is `ms` into the burst, its coin flying to the live `target`. */
export function winOrbPointAt(burst: WinOrbBurst, point: WinOrbPoint, ms: number, target: { x: number; y: number }): WinOrbFrame {
  const t = ms / 1000;
  const orb = orbPosition(burst, point, t);
  if (ms < SWARM_MS) {
    const p = ms / SWARM_MS;
    const q = clamp01((p - point.seed * STAGGER) / (1 - STAGGER));
    const e = easeInOut(q);
    const mid = Math.sin(Math.PI * e);
    const turn = mid * (point.seed2 - 0.5) * 1.6;
    const push = 1 + mid * 0.28 * point.seed2;
    const x = point.from.x + (orb.x - point.from.x) * e - burst.centre.x;
    const y = point.from.y + (orb.y - point.from.y) * e - burst.centre.y;
    return {
      x: burst.centre.x + (x * Math.cos(turn) - y * Math.sin(turn)) * push,
      y: burst.centre.y + (x * Math.sin(turn) + y * Math.cos(turn)) * push,
      size: 0.7 + 0.3 * orb.depth,
      alpha: point.shade * (0.75 + 0.25 * e),
      hue: mixHue(point.from.hue, orb.hue, e),
      landed: false,
    };
  }
  if (ms < SPLIT_AT) {
    return { x: orb.x, y: orb.y, size: 0.7 + 0.4 * orb.depth, alpha: point.shade * (0.7 + 0.3 * orb.depth), hue: orb.hue, landed: false };
  }
  const coin = coinFace(burst, point, ms, target);
  if (ms < SPLIT_AT + SPLIT_MS) {
    const e = easeInOut((ms - SPLIT_AT) / SPLIT_MS);
    return {
      x: orb.x + (coin.x - orb.x) * e,
      y: orb.y + (coin.y - orb.y) * e,
      size: 0.8,
      alpha: point.shade,
      hue: orb.hue,
      landed: false,
    };
  }
  return { ...coin, alpha: point.shade * (coin.landed ? 0 : 1), hue: 46 };
}

/** How many coins have reached the target by `ms`. */
export function winOrbCoinsLanded(burst: WinOrbBurst, ms: number): number {
  let landed = 0;
  for (let k = 0; k < COINS; k++) if (ms >= FLY_AT + burst.order[k] * COIN_STAGGER_MS + COIN_FLY_MS) landed += 1;
  return landed;
}

/**
 * How strong the orb's own glow is at `ms`: rises through the swarm, holds
 * at full while it spins, fades away as it splits. The renderer draws one
 * big soft light behind the points at this strength -- without it the orb
 * reads as a scatter of dots rather than a single glowing thing, the same
 * gap StackAcres' own halo closes on the farm.
 */
export function orbGlow(ms: number): number {
  if (ms < SWARM_MS) return easeInOut(ms / SWARM_MS);
  if (ms < SPLIT_AT) return 1;
  if (ms < SPLIT_AT + SPLIT_MS) return Math.max(0, 1 - (ms - SPLIT_AT) / SPLIT_MS);
  return 0;
}

/** A point in the orb: the sphere turning, with a liquid wobble and a drifting warm-to-bright band. */
function orbPosition(burst: WinOrbBurst, point: WinOrbPoint, t: number): { x: number; y: number; depth: number; hue: number } {
  const spin = t * 1.9;
  const { x, y, z } = point.sphere;
  const rx = x * Math.cos(spin) - z * Math.sin(spin);
  const rz = x * Math.sin(spin) + z * Math.cos(spin);
  const wobble = 1 + 0.07 * Math.sin(2.6 * rx + t * 2) * Math.cos(2.2 * y - t * 1.5);
  const hue = 40 + 12 * Math.sin(y * 1.5 + t * 1.2 + point.seed * 0.6);
  return {
    x: burst.centre.x + rx * burst.radius * wobble,
    y: burst.centre.y + y * burst.radius * wobble,
    depth: (rz + 1) / 2,
    hue,
  };
}

/** A point on its coin's face: hovering and spinning, then flying to the target. */
function coinFace(burst: WinOrbBurst, point: WinOrbPoint, ms: number, target: { x: number; y: number }): WinOrbFrame {
  const k = point.coin;
  const t = ms / 1000;
  let cx = burst.centre.x + burst.hover[k].x;
  let cy = burst.centre.y + burst.hover[k].y + 2 * Math.sin(t * 5 + k);
  let scale = 1;
  let landed = false;
  const leave = FLY_AT + burst.order[k] * COIN_STAGGER_MS;
  if (ms >= leave) {
    const u = clamp01((ms - leave) / COIN_FLY_MS);
    // Cubic ease-out: the coin leaves with the speed it already had
    // hovering and glides into the badge rather than accelerating into it,
    // a softer, more deliberate landing than a quadratic ease gives. The
    // arc's lift rides the same eased value as the position, not raw time,
    // so the whole flight reads as one continuous motion instead of two
    // curves (a linear arc over an eased line) drifting out of step.
    const e = 1 - (1 - u) ** 3;
    cx += (target.x - cx) * e;
    cy += (target.y - cy) * e - 44 * Math.sin(Math.PI * e);
    scale = 1 - 0.85 * e;
    landed = u >= 1;
  }
  const turn = Math.cos(t * (6 + k * 0.7));
  return { x: cx + point.local.x * turn * scale, y: cy + point.local.y * scale, size: 0.6 + 0.4 * scale, alpha: 1, hue: 46, landed };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const mixHue = (a: number, b: number, t: number): number => a + (b - a) * t;
