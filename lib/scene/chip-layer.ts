/**
 * Every chip on the felt: the pot as a physical pile, the spray a bet pushes
 * in, and the pot going back out to whoever won it.
 *
 * This is the renderer-agnostic core of the chip system — positions,
 * identities and motion, with not a single drawing call in it. The canvas
 * component paints whatever `drawList()` returns; this module decides where
 * everything is. It lives in `lib/` rather than beside the renderer so
 * `npm test` can reach it (`vitest.config.ts` collects `lib/` and `app/`),
 * which its three.js predecessor in `components/table/scene/` never was.
 *
 * What carries over from that predecessor is every decision that was about
 * poker rather than about a renderer: the pot is broken into denominations
 * in big blinds (so a pile means the same thing at every tier), columns use
 * the same 16-high fill order as PlayPokerGO's 2D ChipPool, and the motion is
 * seeded from a chip's own identity rather than `Math.random()`, sprays fly
 * the *amount* as chips (`betSprayDenominations`/`funnelSprayDenominations`)
 * with the decorative cycle only as a malformed-input fallback, and the
 * staggers and the friction slide are exactly the ones the celebration
 * budget in `chip-physics.test.ts` is solved against.
 */

import {
  BET_CHIP_COUNT,
  betSprayDenominations,
  CHIP_ARC_PEAK,
  chipSettleJitter,
  decorativeDenomination,
  FUNNEL_CHIP_COUNT,
  funnelSprayDenominations,
} from "./chip-physics";
import {
  CHIP_AIRTIME_MS,
  CHIP_STAGGER_MS,
} from "./chip-spring";
import {
  DEFAULT_BET_STYLE,
  NEAT_SLIDE_DURATION_MS,
  SPLASH_ARC_PEAK,
  splashScatterOffset,
  type BetAnimationStyle,
} from "./bet-style";
import { POT_CHIP_DENOMINATIONS_BB } from "@/lib/game/pot-chips";
import { CHIP_RADIUS, CHIP_THICKNESS, type Vec3 } from "./scene-config";
import { seatAngle } from "./seat-ring";
import { classicChipSpace, type ChipSpace } from "./chip-space";

/* Both moved to `scene-config.ts` -- see the note there -- and re-exported
 * unchanged so every existing importer keeps working. */
export { CHIP_RADIUS, CHIP_THICKNESS } from "./scene-config";

/**
 * PlayPokerGO's public 2D ChipPool fills 16 chips upward before opening the
 * next column. Its sprites advance 35px horizontally and 3px vertically;
 * these are the same proportions in this room's world units (one painted
 * chip diameter across, one CHIP_THICKNESS up).
 */
export const CHIPS_PER_2D_COLUMN = 16;
export const POT_2D_COLUMNS = 5;
const COLUMN_SPACING = CHIP_RADIUS * 2 * 1.35;

export function get2DChipPosition(chipIndex: number): Readonly<{ x: number; y: number }> {
  const safeIndex = Math.max(0, Math.floor(chipIndex));
  const row = safeIndex % CHIPS_PER_2D_COLUMN;
  return {
    x: Math.floor(safeIndex / CHIPS_PER_2D_COLUMN) * COLUMN_SPACING,
    y: row === 0 ? 0 : -row * CHIP_THICKNESS,
  };
}

interface HeapChip {
  denomination: number;
  /** Stable within its denomination as the amount grows. */
  denominationIndex: number;
  position: Readonly<{ x: number; y: number }>;
}

/**
 * Greedy, high-to-low chip fill used by PlayPokerGO's `getChipHeap`, adapted
 * to this game's blind-relative denominations. The visual cap consumes the
 * undisplayed remainder rather than changing the represented amount.
 */
export function get2DChipHeap(
  amount: number,
  bigBlind: number,
  maxColumns = POT_2D_COLUMNS,
): HeapChip[] {
  if (!Number.isFinite(amount) || !Number.isFinite(bigBlind) || amount <= 0 || bigBlind <= 0) return [];
  const capacity = Math.max(0, Math.floor(maxColumns)) * CHIPS_PER_2D_COLUMN;
  if (capacity === 0) return [];

  let remaining = amount / bigBlind;
  const heap: HeapChip[] = [];
  for (const denomination of POT_CHIP_DENOMINATIONS_BB) {
    const wanted = Math.floor(remaining / denomination);
    if (wanted <= 0) continue;
    const shown = Math.min(wanted, capacity - heap.length);
    for (let denominationIndex = 0; denominationIndex < shown; denominationIndex += 1) {
      heap.push({
        denomination,
        denominationIndex,
        position: get2DChipPosition(heap.length),
      });
    }
    remaining -= wanted * denomination;
    if (heap.length >= capacity) break;
  }

  // A positive amount below one blind still needs one visible chip.
  if (heap.length === 0) {
    heap.push({ denomination: 1, denominationIndex: 0, position: get2DChipPosition(0) });
  }
  return heap;
}

/** Fixed clocks prevent a 2D chip from converging forever. */
const CHIP_DROP_DURATION_MS = 180;
const CHIP_BET_DURATION_MS = 900;
const CHIP_SWEEP_DURATION_MS = 650;

/** How high a newly added pile chip drops in from. */
const PILE_DROP = 1.1;

/**
 * A standing bet drops in from lower than the central pot: it is a
 * hand's-width of chips pushed out by one player, not the table's whole
 * middle.
 */
const BET_DROP = 0.7;

/**
 * Per-chip stagger on the short drop a newly added pile or standing-bet chip
 * makes onto its resting place.
 *
 * It was an unnamed `18` written out at both call sites, which is how two
 * copies of one number start disagreeing. Shorter than a bet's stagger
 * because the travel is a fraction of a unit and the whole event is the
 * contact, not the journey.
 */
const DROP_STAGGER_MS = 18;

/**
 * Per-chip stagger when a street's standing bets sweep into the pot.
 *
 * Deliberately tighter than `CHIP_STAGGER_MS`, and the reason is arithmetic
 * rather than taste. A bet spray is capped at ten chips; a sweep can carry
 * every standing chip at the table — six seats' worth of columns, routinely
 * twenty-plus. At the bet's 30ms that is over a second of dealer before the
 * next card, on every street. The sweep is one continuous gesture rather
 * than a countable sequence anyway, so the eye is not resolving individual
 * chips here the way it is on a bet.
 */
const SWEEP_STAGGER_MS = 14;

export interface SceneChip {
  denomination: number;
  /** The chip's centre, in world units. */
  position: Vec3;
  /**
   * True while the chip is genuinely in flight. The painter keys the
   * decoupled ground shadow off this, not off height alone: a chip resting
   * mid-stack is well above the felt too, and giving it a hovering shadow
   * pool is exactly what makes a settled pile read as floating chips.
   */
  airborne?: boolean;
  /**
   * How far off the cloth the chip is, 0 on the felt and 1 at the apex of
   * its arc.
   *
   * The painter turns this into a size, and it exists because this room has
   * no camera to do it honestly. The projection is an orthographic tilt, so a
   * chip a world unit above the felt draws at exactly the same size as one
   * resting on it — a flight has no depth cue at all beyond its shadow, which
   * is a large part of why bets read as sliding decals rather than as objects
   * being thrown. See `flightScale` in chip-spring.ts.
   */
  lift?: number;
}

interface MovingChip {
  chip: SceneChip;
  /** Clocked motion; fields are mutated in the render tick. */
  motion: { from: Vec3; elapsedMs: number; durationMs: number };
  target: Vec3;
  /** Counts down before the chip starts moving, which is what staggers a spray. */
  delayMs: number;
  /** Pile chips stay when they land; spray chips are removed. */
  keepOnArrival: boolean;
  /**
   * The arc, on its own clock. Absent means the chip stays on the cloth: a
   * neat slide, and the short vertical drop a chip makes onto a pile it is
   * joining (which is already a vertical move — arcing it would send it up
   * before it came down).
   */
  arc?: { peak: number; elapsedMs: number; durationMs: number };
}

export class ChipLayer {
  private readonly moving: MovingChip[] = [];
  /** Pile chips by their identity in the breakdown, so a settled one is reused. */
  private readonly pile = new Map<string, SceneChip>();
  /**
   * Standing street bets, keyed `slot:denomination:index` — the chips
   * resting in front of each bettor until the street closes. The same keyed
   * sync discipline as the pile: a raise *adds* chips to a stack that is
   * already there, and a re-fetched snapshot re-hands every settled chip
   * its identical spot.
   */
  private readonly bets = new Map<string, SceneChip>();
  private paying = false;
  /**
   * The table these chips are on: where the pot, the bet spots, the trays and
   * the payout landings are, and how high the cloth is.
   *
   * Held as one field rather than as the loose `radiusZ` and `nearSeatInset`
   * it replaced, and pushed in by the renderer rather than threaded through
   * nine call sites. Defaulted to the classic room's desktop shape so every
   * unit test that constructs a layer without one keeps describing the same
   * table it always did.
   */
  private space: ChipSpace = classicChipSpace();
  /**
   * How a bet's spray travels — the player's own preference, pushed in by
   * the renderer. Only future sprays read it: a chip already in flight
   * finishes the journey it left on, restyling mid-air would be the visual
   * equivalent of rewriting history.
   */
  private betStyle: BetAnimationStyle = DEFAULT_BET_STYLE;

  constructor(private readonly onChanged: () => void) {}

  /** Select how future bet sprays travel. No repaint: nothing on screen moves. */
  setBetStyle(style: BetAnimationStyle): void {
    this.betStyle = style;
  }

  /**
   * Re-shape the table under the chips already on it.
   *
   * Only the spots future chips are given are recomputed; chips already at
   * rest keep their world positions. A resize is not a game event, and
   * re-homing a settled pile mid-hand would read as the pot twitching.
   *
   * The classic room calls this on two occasions -- a resize that re-solves
   * the felt's plan depth, and the breakpoint where the local player's own
   * figure stops being drawn and the near seat's bet reach changes with it
   * (see `NEAR_SEAT_BET_INSET_DESKTOP`). The racetrack calls it once, at
   * mount: its table is a fixed object and only the camera moves.
   */
  setSpace(space: ChipSpace): void {
    this.space = space;
  }

  /**
   * The pot, as chips.
   *
   * Keyed by denomination and position in the column: raising a pot from
   * three chips to four has to *add one chip*, not rebuild the stack, or
   * every chip already on the felt replays its landing every time anybody
   * bets.
   */
  syncPile(pot: number, bigBlind: number, paying: boolean): void {
    if (paying !== this.paying) {
      this.paying = paying;
      this.onChanged();
    }
    // While the funnel is running the pot has already been paid out; leaving
    // the pile under it would show the same chips twice.
    const heap = paying ? [] : get2DChipHeap(pot, bigBlind);
    const wanted = new Set<string>();

    const columnCount = Math.ceil(heap.length / CHIPS_PER_2D_COLUMN);
    const spread = (columnCount - 1) / 2;
    // Named for the spot, not the amount -- `pot` is already this method's
    // first parameter, and the pile is no longer at the felt's own centre.
    const centre = this.space.pot();
    heap.forEach(({ denomination, denominationIndex, position: layout }, index) => {
      const key = `${denomination}:${denominationIndex}`;
      wanted.add(key);
      const rest: Vec3 = {
        x: centre.x + layout.x - spread * COLUMN_SPACING,
        y: this.space.feltY + CHIP_THICKNESS / 2 - layout.y,
        z: centre.z,
      };
      const existing = this.pile.get(key);
      if (existing) {
        // PlayPokerGO recentres the whole pool when a sixteenth chip opens a
        // new column. Keep keyed chips, but give every existing chip its new
        // centred slot so the visual result is identical.
        const moving = this.moving.find((entry) => entry.chip === existing);
        if (moving) {
          moving.target = rest;
        } else {
          existing.position = { ...rest };
        }
        return;
      }

      const chip: SceneChip = {
        denomination,
        position: { x: rest.x, y: rest.y + PILE_DROP, z: rest.z },
        airborne: true,
      };
      this.pile.set(key, chip);
      this.moving.push({
        chip,
        motion: { from: { ...chip.position }, elapsedMs: 0, durationMs: CHIP_DROP_DURATION_MS },
        target: rest,
        delayMs: (index % CHIPS_PER_2D_COLUMN) * DROP_STAGGER_MS,
        keepOnArrival: true,
        // The travel is about a chip's own thickness, so the event is the
        // contact. No arc — this is already a vertical move.
      });
      this.onChanged();
    });

    for (const [key, chip] of this.pile) {
      if (wanted.has(key)) continue;
      // Drop it from the moving list too, or a chip that was still settling
      // would be animated after being removed.
      const index = this.moving.findIndex((entry) => entry.chip === chip);
      if (index >= 0) this.moving.splice(index, 1);
      this.pile.delete(key);
      this.onChanged();
    }
  }

  /**
   * The standing bets: each seat's committed-this-street amount as chips,
   * resting at that seat's edge of the felt until the street closes — the
   * way a real bet sits in front of its player, not in the pot it is not
   * yet part of. The centre pile's amount is the pot *minus* these, so the
   * felt's chips always sum to the pot the HUD states.
   *
   * If the wager layout ever grows beyond one column, columns spread along
   * the ellipse's tangent at the seat, not screen X; a side seat's bet would
   * otherwise grow into the rail.
   */
  syncBets(bets: Array<{ slot: number; amount: number }>, seatCount: number, bigBlind: number): void {
    const wanted = new Set<string>();
    for (const { slot, amount } of bets) {
      // A wager is a single cut stack in PlayPokerGO; only the central pot
      // spreads beyond one 16-chip column.
      const heap = get2DChipHeap(amount, bigBlind, 1);
      if (heap.length === 0) continue;
      const origin = this.space.betSpot(slot, seatCount);
      const theta = seatAngle(slot, seatCount);
      // Plan-space tangent of the ellipse at this seat, unit length.
      const tangent = { x: -Math.sin(theta), z: Math.cos(theta) };
      heap.forEach(({ denomination, denominationIndex, position: layout }, index) => {
        const key = `${slot}:${denomination}:${denominationIndex}`;
        wanted.add(key);
        if (this.bets.has(key)) return;
        const along = layout.x;
        const rest: Vec3 = {
          x: origin.x + tangent.x * along,
          y: this.space.feltY + CHIP_THICKNESS / 2 - layout.y,
          z: origin.z + tangent.z * along,
        };
        const chip: SceneChip = {
          denomination,
          position: { x: rest.x, y: rest.y + BET_DROP, z: rest.z },
          airborne: true,
        };
        this.bets.set(key, chip);
        this.moving.push({
          chip,
          motion: { from: { ...chip.position }, elapsedMs: 0, durationMs: CHIP_DROP_DURATION_MS },
          target: rest,
          delayMs: index * DROP_STAGGER_MS,
          keepOnArrival: true,
        });
        this.onChanged();
      });
    }

    for (const [key, chip] of this.bets) {
      if (wanted.has(key)) continue;
      // A standing bet only ever shrinks outside a sweep on a reconnect or
      // divergent refetch; the honest correction there is instant, exactly
      // as the pile's is.
      const index = this.moving.findIndex((entry) => entry.chip === chip);
      if (index >= 0) this.moving.splice(index, 1);
      this.bets.delete(key);
      this.onChanged();
    }
  }

  /**
   * The street closing: every standing bet slides into the middle, the way
   * a dealer sweeps the action in before the next card. The chips are
   * *transferred* out of the standing map into flight — not cleared and
   * re-spawned — so each one leaves from exactly where it was resting.
   * Immediately after this the pot pile grows by the swept amount via its
   * own keyed sync, which is the same arrive-then-drop duality every bet
   * spray has always had.
   */
  sweepBets(): void {
    let order = 0;
    const pot = this.space.pot();
    for (const chip of this.bets.values()) {
      // A chip still dropping in sweeps from wherever it is; drop its settle
      // flight so it is not animated twice — but carry its velocity across.
      // That is the interruptible half of the spring earning its keep: a chip
      // caught mid-drop curves on into the middle rather than stopping dead
      // and starting a second, visibly separate journey.
      const pending = this.moving.findIndex((entry) => entry.chip === chip);
      if (pending >= 0) this.moving.splice(pending, 1);
      const jitter = chipSettleJitter(chip.denomination, order);
      const target: Vec3 = {
        x: pot.x + jitter.x * 4,
        y: this.space.feltY + CHIP_THICKNESS / 2,
        z: pot.z + jitter.z * 4,
      };
      chip.airborne = true;
      this.moving.push({
        chip,
        motion: { from: { ...chip.position }, elapsedMs: 0, durationMs: CHIP_SWEEP_DURATION_MS },
        target,
        delayMs: order * SWEEP_STAGGER_MS,
        keepOnArrival: false,
        // The only preset that must not overshoot. Past the pot is off the
        // back of the felt, and this is the longest journey on the table.
        arc: { peak: CHIP_ARC_PEAK, elapsedMs: 0, durationMs: CHIP_AIRTIME_MS },
      });
      order += 1;
    }
    if (order > 0) this.onChanged();
    this.bets.clear();
  }

  /**
   * Standing bets, gone at once — for the moments a sweep would lie: a new
   * hand mounting over a stale one, or the payout, where the pot the bets
   * already joined is the thing flying out.
   */
  clearBets(): void {
    for (const chip of this.bets.values()) {
      const index = this.moving.findIndex((entry) => entry.chip === chip);
      if (index >= 0) this.moving.splice(index, 1);
    }
    if (this.bets.size > 0) this.onChanged();
    this.bets.clear();
  }

  /**
   * A bet: the amount actually committed, as chips, from the player's own
   * rail to their bet spot — smallest denominations first, so the big chips
   * end up on top where they read. The spray lands where the standing bet
   * (`syncBets`) is about to appear, which is what makes the
   * arrive-then-settle read as one gesture. The old fixed three-chip
   * decorative spray survives only as the fallback for a malformed amount,
   * where showing something is better than a silent bet.
   *
   * How the chips travel is the selected style:
   *
   * "neat_slide" — the whole bet as one rigid pillar, stacked a thickness
   * apart (which the projection renders as the classic ~3px screen rise
   * per chip at the desktop fit), no scatter, no stagger, no arc: every
   * chip glides on the same clocked cubic ease-out, off the line fast and
   * into a heavy stop, exactly aligned the whole way.
   *
   * "splash_chunk" — chips thrown in one by one on tall parabolas
   * (SPLASH_ARC_PEAK over the friction slide), staggered by index so the
   * cluster visibly blooms, each landing on its own trigonometric
   * index-wave offset (`splashScatterOffset`) and settling on the slide's
   * exponential decay. Every offset is a pure function of the chip's
   * index, so the same bet lands the same cluster every time.
   */
  spawnBet(slot: number, seatCount: number, amount: number, bigBlind: number): void {
    // The tray on the rail in front of the player, not the seat and never the
    // middle of their badge. See `seatTrayOrigin` — the point this replaced
    // was outside the painted rail entirely, so every bet in this room has
    // been flying in from the carpet.
    const origin = this.space.tray(slot, seatCount);
    const spot = this.space.betSpot(slot, seatCount);
    const denominations = betSprayDenominations(amount, bigBlind);
    const spray = denominations.length > 0
      ? denominations
      : Array.from({ length: BET_CHIP_COUNT }, (_, index) => decorativeDenomination(index));
    const restY = this.space.feltY + CHIP_THICKNESS / 2;
    spray.forEach((denomination, index) => {
      // Every chip leaves from the tray's own surface. It used to leave from
      // `restY + index * CHIP_THICKNESS` — a pre-built tower standing on the
      // rail before the bet was made, which is the one thing a stack being
      // *assembled* must not start as.
      const start: Vec3 = { x: origin.x, y: restY, z: origin.z };

      if (this.betStyle === "neat_slide") {
        // The pillar keeps each chip at its own height on both ends, so the
        // stack that arrives is the stack that left. This is the one style
        // that still pre-builds its tower, deliberately: it is a cut stack
        // being pushed, not chips being tossed.
        const from: Vec3 = { x: origin.x, y: restY + index * CHIP_THICKNESS, z: origin.z };
        const target: Vec3 = { x: spot.x, y: restY + index * CHIP_THICKNESS, z: spot.z };
        this.moving.push({
          chip: { denomination, position: { ...from }, airborne: true },
          motion: { from: { ...from }, elapsedMs: 0, durationMs: NEAT_SLIDE_DURATION_MS },
          target,
          delayMs: 0,
          keepOnArrival: false,
        });
        return;
      }

      if (this.betStyle === "splash_chunk") {
        const scatter = splashScatterOffset(index);
        this.moving.push({
          chip: { denomination, position: { ...start }, airborne: true },
          motion: { from: { ...start }, elapsedMs: 0, durationMs: CHIP_BET_DURATION_MS },
          target: { x: spot.x + scatter.x, y: restY, z: spot.z + scatter.z },
          delayMs: index * CHIP_STAGGER_MS,
          keepOnArrival: false,
          arc: { peak: SPLASH_ARC_PEAK, elapsedMs: 0, durationMs: CHIP_AIRTIME_MS },
        });
        return;
      }

      // "stacked_toss", the default. Build the stack at the tray and move it
      // as one compact 2D object. The stack is already legible on the first
      // painted frame; it does not grow under the community cards one chip at
      // a time.
      const layout = get2DChipPosition(index);
      const from: Vec3 = {
        x: origin.x,
        y: restY - layout.y,
        z: origin.z,
      };
      this.moving.push({
        chip: { denomination, position: { ...from }, airborne: true },
        motion: { from: { ...from }, elapsedMs: 0, durationMs: CHIP_BET_DURATION_MS },
        target: {
          x: spot.x,
          y: restY - layout.y,
          z: spot.z,
        },
        // This is a prebuilt stack, not a chip-by-chip spray. Keep every
        // layer alive on the same clock so the column never loses its top
        // chips before the group reaches the pot.
        delayMs: 0,
        keepOnArrival: false,
      });
    });
    this.onChanged();
  }

  /**
   * The pot going home: each winner's actual payout travels as one intact
   * stack, landing on the winner's own edge of the felt rather than on the
   * seat itself — chips are pushed to a player, not thrown at them.
   *
   * The landing spot is 0.92 of the seat ring, just inside the rail, which
   * is where a dealer actually pushes a pot. (Landing at a fraction of the
   * felt's radius was tried first and left a side seat's payout closing only
   * a fifth of the distance to its plate — it read as the pot drifting
   * vaguely leftward rather than anyone being paid.)
   */
  spawnFunnel(winners: Array<{ slot: number; amount: number }>, seatCount: number, bigBlind: number): void {
    const pot = this.space.pot();
    for (const { slot, amount } of winners) {
      const denominations = funnelSprayDenominations(amount, bigBlind);
      const spray = denominations.length > 0
        ? denominations
        : Array.from({ length: FUNNEL_CHIP_COUNT }, (_, index) => decorativeDenomination(index));
      spray.forEach((denomination, index) => {
        // PlayPokerGO moves one ChipPool container from the pot to the
        // winner, so every layer keeps the same stack-relative position and
        // clock. Modelling the container through equal per-chip vectors gives
        // the canvas the identical result without introducing a scene node.
        const layout = get2DChipPosition(index);
        const landing = this.space.payout(slot, seatCount);
        const target: Vec3 = {
          x: landing.x + layout.x,
          y: this.space.feltY + CHIP_THICKNESS / 2 - layout.y,
          z: landing.z,
        };
        const start: Vec3 = {
          x: pot.x + layout.x,
          y: this.space.feltY + CHIP_THICKNESS / 2 - layout.y,
          z: pot.z,
        };
        this.moving.push({
          chip: { denomination, position: { ...start }, airborne: true },
          motion: { from: { ...start }, elapsedMs: 0, durationMs: CHIP_SWEEP_DURATION_MS },
          target,
          delayMs: 0,
          keepOnArrival: false,
        });
      });
    }
    this.onChanged();
  }

  /** Clear everything in flight, e.g. when a new hand starts. */
  clearFlights(): void {
    for (let index = this.moving.length - 1; index >= 0; index -= 1) {
      if (this.moving[index].keepOnArrival) continue;
      this.moving.splice(index, 1);
    }
  }

  /**
   * Advance every chip by one frame. Returns whether anything moved, which
   * is what keeps the render loop awake.
   *
   * `reducedMotion` snaps rather than slides. A player who has asked their
   * system for less movement should still see where the pot went — removing
   * the chips entirely would remove information, not motion.
   */
  update(deltaMs: number, reducedMotion: boolean): boolean {
    if (this.moving.length === 0) return false;
    let moved = false;

    for (let index = this.moving.length - 1; index >= 0; index -= 1) {
      const entry = this.moving[index];
      if (entry.delayMs > 0) {
        entry.delayMs -= deltaMs;
        // A chip waiting its turn is still "motion": the scheduler must not
        // sleep between a spray being requested and its last chip leaving.
        moved = true;
        if (entry.delayMs > 0) continue;
      }

      let arrived = reducedMotion;
      const motion = entry.motion;
      if (!reducedMotion) {
        motion.elapsedMs += Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
        const t = motion.durationMs > 0
          ? Math.min(1, motion.elapsedMs / motion.durationMs)
          : 1;
        if (t >= 1) {
          // Terminal snap is intentional: no residual sub-pixel frame may
          // keep the demand loop awake.
          entry.chip.position.x = entry.target.x;
          entry.chip.position.y = entry.target.y;
          entry.chip.position.z = entry.target.z;
          arrived = true;
        } else {
          // Egret Tween's default (the reference 2D client) is linear. Every
          // chip in a pool shares this same t, so the stack cannot shear.
          const eased = t;
          entry.chip.position.x = motion.from.x + (entry.target.x - motion.from.x) * eased;
          entry.chip.position.y = motion.from.y + (entry.target.y - motion.from.y) * eased;
          entry.chip.position.z = motion.from.z + (entry.target.z - motion.from.z) * eased;
          arrived = false;
        }
        if (entry.arc) {
          entry.arc.elapsedMs += Math.max(0, deltaMs);
          const arcT = Math.min(1, entry.arc.durationMs > 0
            ? entry.arc.elapsedMs / entry.arc.durationMs : 1);
          const landed = arcT >= 1;
          const lift = landed ? 0 : Math.sin(arcT * Math.PI);
          entry.chip.lift = lift;
          entry.chip.position.y += landed ? 0 : lift * entry.arc.peak;
          arrived = arrived && landed;
        } else {
          entry.chip.lift = 0;
        }
        moved = true;
      } else {
        entry.chip.position.x = entry.target.x;
        entry.chip.position.y = entry.target.y;
        entry.chip.position.z = entry.target.z;
        entry.chip.lift = 0;
        moved = true;
      }

      if (arrived) {
        // A kept chip (pile or standing bet) is now resting: it must stop
        // casting the flying shadow the moment it parks, or a settled stack
        // reads as chips hovering over their own shadow pools.
        entry.chip.airborne = false;
        entry.chip.lift = 0;
        this.moving.splice(index, 1);
      }
    }
    return moved;
  }

  /** True after the terminal snap has removed the last moving chip. */
  isIdle(): boolean {
    return this.moving.length === 0;
  }

  /**
   * Everything the painter should draw this frame, in no particular order —
   * the painter depth-sorts, because painting order is its concern and world
   * position is this module's.
   */
  drawList(): SceneChip[] {
    // A pile or standing-bet chip that is still dropping in is in two
    // collections under the same identity; listing it once from its keyed
    // map is what stops it being painted twice.
    return [
      ...this.pile.values(),
      ...this.bets.values(),
      ...this.moving.filter((entry) => !entry.keepOnArrival).map((entry) => entry.chip),
    ];
  }

  /**
   * Every in-flight chip's world position, for the e2e check that the pot
   * lands on the player it was paid to. Exposed through
   * `window.__stackchipsScene` by `table-scene.tsx`.
   */
  debugChipPositions(): Vec3[] {
    return this.moving.map((entry) => ({ ...entry.chip.position }));
  }

  /**
   * Where every chip currently in flight is *going*.
   *
   * A sibling of `debugChipPositions`, and it exists because the two answer
   * genuinely different questions. A bet spray's chips are transient — they
   * are removed the frame they arrive, and the pile that rests at the bet
   * spot afterwards is `syncBets`' own, keyed, separate set of chips. So the
   * shape a spray *assembles* is only ever visible as its targets: sampling
   * positions mid-flight shows chips at scattered points on their own arcs,
   * which is exactly what a column under construction looks like and tells
   * you nothing about whether it is a column.
   */
  debugFlightTargets(): Vec3[] {
    return this.moving.map((entry) => ({ ...entry.target }));
  }

  /** Chips currently resting in the pot pile, for the same test seam. */
  debugPileSize(): number {
    return this.pile.size;
  }

  /** Chips standing in front of bettors, for the same test seam. */
  debugBetChips(): number {
    return this.bets.size;
  }
}
