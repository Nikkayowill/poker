/**
 * Every chip on the felt: the pot as a mound, the chips a bet pushes in, a
 * street sweeping to the middle, and the pot going home.
 *
 * THE ARCHITECTURE IS TWO POPULATIONS THAT NEVER MIX, and it is the thing
 * this module exists to enforce.
 *
 *   Permanent chips are the pot mound and the standing bets. They are pure
 *   layout: a slot, an identity, and nothing else. They never move. A chip
 *   already resting in the pot has no clock attached to it, cannot be caught
 *   mid-flight, and cannot be shifted by anything except a relayout.
 *
 *   Transient chips exist only while something is happening. They are spawned
 *   at a source, flown, and destroyed on arrival. Nothing in the game state
 *   points at one.
 *
 * A chip joining the pot is therefore a transient chip that flies in and, on
 * landing, hands over to the permanent chip it was carrying: the temporary one
 * is destroyed in the same frame the permanent one becomes visible. Neither is
 * ever drawn twice, and the permanent stack is never the thing being animated.
 *
 * The system this replaced had one population with a `keepOnArrival` flag,
 * which meant a settled pot chip was still an entry in the moving list, still
 * carried a target, and could still be retargeted by a resize or a re-sync.
 * Every "the pot twitched" bug came out of that, and none of them are
 * expressible here.
 *
 * WHAT IS PUSHED IN FROM THE RENDERER. Two things, and both are per-fit rather
 * than per-frame: the `ChipSpace` (where the pot, bet spots, trays and payout
 * landings are on whichever table is being drawn) and the chip radius the fit
 * solved for. Neither is read from a module-level constant, which is what lets
 * one implementation serve the classic room's ellipse and the racetrack's
 * perspective table.
 *
 * Renderer-agnostic: there is not a single drawing call in here. `drawList()`
 * says what exists and where; the painter decides what that looks like. It
 * lives in `lib/` rather than beside a renderer so `npm test` can reach it.
 */

import { CHIP_RADIUS, type Vec3 } from "../scene-config";
import { racetrackChipSpace, type ChipSpace } from "../chip-space";
import { seatAngle } from "../seat-ring";
import { betStyleMotion, DEFAULT_BET_STYLE, type BetAnimationStyle } from "../bet-style";
import {
  betSlots,
  chipBreakdown,
  MAX_BET_CHIPS,
  MAX_POT_CHIPS,
  MAX_POT_COLUMNS,
  pileSlots,
  spraySequence,
  spreadSlots,
  type StackSlot,
} from "./chip-stack";
import {
  arcLift,
  deformation,
  flightDrift,
  flightRoll,
  hasLanded,
  MOTION,
  springCurve,
  sprayDurationMs,
  type ChipMoveKind,
  type MotionProfile,
} from "./chip-motion";
import { flightVariance, type FlightVariance } from "./chip-spec";

/**
 * The golden angle, in radians. Stepping by it (as `sweepBets` and
 * `spawnBet`'s scatter both do below) spreads N points around a circle with
 * no two ever landing close together, at any N -- the same distribution a
 * sunflower's seeds use, and why this reads as a natural scatter instead of
 * a repeating pattern the way a fixed fraction of a turn would.
 */
const GOLDEN_ANGLE_RAD = 2.39996;

/**
 * What the painter is handed for one chip.
 *
 * Ground position and stack index are separate fields, and that separation is
 * the 2.5D part of "2.5D chip system". A stack's height is expressed as a
 * screen-space offset (the painter multiplies `stackIndex` by the pitch it
 * derived from the chip's own drawn size) rather than as world Y, which is
 * what guarantees the 3–4 pixel separation between chips at every breakpoint
 * and every depth. Baking the height into world Y — what the old system did —
 * hands the separation to the projection, and the projection's answer on a
 * portrait phone was two thirds of a pixel.
 */
export interface RenderChip {
  denomination: number;
  /**
   * Where the chip's *base* is: its position on the cloth, plus whatever the
   * flight arc has lifted it to. Never includes the stack height.
   */
  position: Vec3;
  /** How many chips are underneath it in its own column. Fractional in flight. */
  stackIndex: number;
  /** Stable identity, seeding every deterministic imperfection this chip has. */
  seed: number;
  /**
   * Genuinely in the air right now.
   *
   * The painter keys the flying shadow off this rather than off height, and
   * the distinction is load-bearing: a chip resting eight high in the pot is
   * also well above the cloth, and giving it a hovering shadow pool is exactly
   * what makes a settled mound read as floating discs.
   */
  airborne: boolean;
  /** 0 on the cloth, 1 at the apex of the arc. Drives the shadow and the swell. */
  lift: number;
  /** Deviation from the projected straight path, in CSS pixels. */
  driftXPx: number;
  driftYPx: number;
  /** Tumble through the air, in radians, on top of the resting tilt. */
  rollRad: number;
  /** Landing squash. */
  scaleX: number;
  scaleY: number;
  /**
   * 1 everywhere except the tail of a payout, where a chip that has landed in
   * front of its winner fades out rather than being cut. See `payOut`.
   */
  opacity: number;
  /** The seat that owns a standing bet or its incoming flight, when any. */
  ownerSlot?: number;
}

interface PermanentChip {
  chip: RenderChip;
  /**
   * False while the transient chip carrying it is still in the air. An
   * invisible permanent chip is a reservation, not a drawn object.
   */
  visible: boolean;
  /**
   * The transient chip currently delivering it, while one exists.
   *
   * Held so a relayout can retarget a carrier that is still in the air. The
   * pot re-tiers as it grows — a fourth column opening moves every chip — and
   * without this the reservation would move to its new slot while its carrier
   * kept flying at the old one, and the chip would jump the width of a column
   * the instant it landed.
   */
  carrier: Flight | null;
}

interface Flight {
  chip: RenderChip;
  from: Vec3;
  to: Vec3;
  fromStack: number;
  toStack: number;
  profile: MotionProfile;
  /** The arc's apex in world units — the profile's chip radii, resolved. */
  arcPeak: number;
  variance: FlightVariance;
  elapsedMs: number;
  delayMs: number;
  /** Runs once, on arrival, before the flight is destroyed. */
  onArrive?: () => void;
  /**
   * Set once the chip has parked and is only waiting out its linger.
   *
   * A separate flag rather than `elapsedMs >= durationMs` because a lingering
   * chip must stop being integrated entirely — it has arrived, and re-running
   * the spring against a target it is already on would keep handing it
   * sub-pixel corrections forever.
   */
  landed: boolean;
  /**
   * Whether the chip is already on the felt while it waits out its stagger.
   *
   * False for a bet spray, whose chips are in the player's tray until they
   * leave — drawing one early would put a chip on the rail that nobody has
   * bet yet. True for a payout, whose chips are the pot: they are sitting on
   * the table in plain sight, and hiding them until their turn came was a
   * second, subtler version of the vanishing this method exists to fix — the
   * mound visibly thinned out from the top as the stagger worked through it.
   */
  visibleBeforeLaunch: boolean;
  /**
   * How long the chip rests where it landed before fading, and how long the
   * fade takes. Absent for every flight except a payout, which is the only
   * one whose chips have nothing to hand over to on arrival.
   */
  linger?: { holdMs: number; fadeMs: number; elapsedMs: number };
}

/** How high a chip joining the pot drops in from, in chip radii. */
const PILE_DROP_RADII = 4;
/**
 * A standing bet drops from lower than the pot: it is a hand's-width of chips
 * pushed out by one player, not the table's whole middle being fed.
 */
const BET_DROP_RADII = 2.6;

/** The most chips one bet pushes in. Past ten a spray is a particle effect. */
const MAX_SPRAY_CHIPS = 10;
/**
 * The payout's fallback cap, used only when there were no chips on the felt to
 * send (a divergent snapshot, or a hand that ended before anything was
 * committed). The ordinary path sends the chips that are actually there.
 */
const MAX_PAYOUT_CHIPS = 12;

/**
 * How long the whole payout spends launching, however many chips it is
 * sending.
 *
 * A fixed per-chip stagger cannot survive this animation any more. It sends
 * every chip on the felt now — a big pot's mound plus whatever was still
 * standing in front of the callers — which can be eighty discs where the old
 * recomputed spray was always twelve. At a flat 16ms that is over a second of
 * chips leaving one at a time. The stagger is divided out of this window
 * instead, so a two-chip pot still leaves as two distinct chips and an
 * eighty-chip pot leaves as a wave.
 */
const PAYOUT_LAUNCH_WINDOW_MS = 320;

/**
 * How long a paid chip sits in front of its winner before fading, and how long
 * the fade takes.
 *
 * The chips used to be destroyed the frame they arrived, which meant the pot
 * visibly went somewhere and then was never *seen* to be there — the eye
 * tracked the movement and found nothing at the end of it. Holding the stack
 * for most of a second is what turns the payout into "they won that": you get
 * to look at the pile sitting in front of the winner before it is absorbed
 * into their stack.
 *
 * Budgeted against `NEXT_HAND_DELAY_MS` (2,800): the launch window, the flight
 * and both of these together come to about 1,820ms, so the next hand is never
 * dealt over the top of a pot still being paid.
 */
const PAYOUT_HOLD_MS = 700;
const PAYOUT_FADE_MS = 400;

export class ChipScene {
  private readonly pile = new Map<string, PermanentChip>();
  private readonly bets = new Map<string, PermanentChip>();
  private readonly flights: Flight[] = [];
  private paying = false;
  private space: ChipSpace = racetrackChipSpace();
  private betStyle: BetAnimationStyle = DEFAULT_BET_STYLE;
  /**
   * The chip radius this fit draws at, in world units.
   *
   * Every layout distance in here is a multiple of it — column pitch, mound
   * row depth, drop heights, arc peaks — so the felt stays in proportion on a
   * plate where chips had to be drawn larger than the projection would have
   * made them. Defaulted to the base radius so a scene built under test
   * without a renderer describes a desktop table.
   */
  private chipRadius = CHIP_RADIUS;
  /**
   * Which shape the centre pile lays its chips out in -- a mound everywhere
   * the felt has room to spare, or a flat spread on a landscape phone
   * (`MOBILE_LANDSCAPE_MAX_WIDTH_PX`, table-anchors.ts) where a mound's
   * height has nowhere to climb before it fights the board caption sitting
   * right above it.
   */
  private potLayout: "mound" | "spread" = "mound";
  /**
   * Milliseconds until the street sweep currently in the air has landed.
   *
   * Chips joining the pot wait this out before they drop, so the mound builds
   * itself *after* the swept chips have arrived and been destroyed rather than
   * alongside them. Without it a street change briefly shows both populations
   * at once, which reads as the pot doubling and then halving.
   */
  private sweepRemainingMs = 0;
  /** Transient chips need distinct seeds; identity is per spawn, not per slot. */
  private flightSeed = 0;

  constructor(private readonly onChanged: () => void) {}

  /* ---------------------------------------------------------------- *
   * What the renderer pushes in.
   * ---------------------------------------------------------------- */

  /**
   * Re-shape the table under the chips already on it.
   *
   * Slots are recomputed on the next sync; chips already resting keep their
   * positions until then. A resize is not a game event, and re-homing a
   * settled mound mid-hand would read as the pot twitching.
   */
  setSpace(space: ChipSpace): void {
    this.space = space;
  }

  /** The drawn chip radius for this fit — see `solveChipWorldRadius`. */
  setChipRadius(radius: number): void {
    if (!Number.isFinite(radius) || radius <= 0 || radius === this.chipRadius) return;
    this.chipRadius = radius;
  }

  /**
   * Select how future bet sprays travel. No repaint: nothing on screen moves,
   * and a chip already in the air finishes the journey it left on — restyling
   * mid-flight is the visual equivalent of rewriting history.
   */
  setBetStyle(style: BetAnimationStyle): void {
    this.betStyle = style;
  }

  /**
   * Choose the centre pile's shape for this fit. Same "next sync, not now"
   * timing as `setChipRadius`: a resize is not a game event, and re-homing a
   * settled pile mid-hand for it would read as the pot twitching, so this
   * only takes effect the next time `syncPile` runs on its own.
   */
  setPotLayout(layout: "mound" | "spread"): void {
    this.potLayout = layout;
  }

  /* ---------------------------------------------------------------- *
   * The permanent populations.
   * ---------------------------------------------------------------- */

  /**
   * The pot, as a mound.
   *
   * Keyed by denomination and ordinal within it, so raising a pot from three
   * chips to four *adds one chip* rather than rebuilding the pile — otherwise
   * every chip already on the felt replays its landing every time anybody
   * bets.
   *
   * A chip whose slot changed because the mound re-tiered is moved instantly
   * rather than animated. That is the "never animate the permanent stack"
   * rule holding: a re-tier happens in the same beat as new chips landing, so
   * the mound reorganising underneath them reads as the pot being pushed
   * together, and the alternative is a settled stack that slides sideways
   * whenever a fourth column opens.
   */
  syncPile(pot: number, bigBlind: number, paying: boolean): void {
    if (paying !== this.paying) {
      this.paying = paying;
      this.onChanged();
    }
    /**
     * While the payout runs, the felt is left exactly as it is.
     *
     * This used to empty the mound the instant `paying` went true, and it is
     * worth writing down what that looked like, because it is the whole reason
     * the payout read as chips vanishing. The pot's mound and every standing
     * bet blinked out in one frame; `payOut` then built a *fresh* twelve-chip
     * stack from a recomputed breakdown and slid that out from the pot's
     * centre. So the chips that arrived at the winner were never the chips
     * that had been sitting on the table, they were a different shape, and the
     * eye caught the substitution even when it could not name it.
     *
     * `payOut` consumes the felt itself now, so clearing here would be
     * deleting the very chips it is about to send.
     */
    if (paying) return;
    const units = chipBreakdown(pot, bigBlind, MAX_POT_CHIPS);
    const slots = this.potLayout === "spread"
      ? spreadSlots(units.length, this.chipRadius, MAX_POT_CHIPS)
      : pileSlots(units.length, this.chipRadius, MAX_POT_COLUMNS);
    const centre = this.space.pot();
    const wanted = new Set<string>();

    units.forEach((unit, index) => {
      const key = `${unit.denomination}:${unit.denominationIndex}`;
      wanted.add(key);
      const slot = slots[index];
      const rest: Vec3 = {
        x: centre.x + slot.offsetX,
        y: this.space.feltY,
        z: centre.z + slot.offsetZ,
      };

      const existing = this.pile.get(key);
      if (existing) {
        this.rehome(existing, rest, slot.index);
        return;
      }
      this.pile.set(key, this.arrive(key, unit.denomination, rest, slot, PILE_DROP_RADII, this.sweepRemainingMs));
      this.onChanged();
    });

    this.prune(this.pile, wanted);
  }

  /**
   * The standing bets: each seat's committed-this-street amount, resting at
   * that seat's edge of the felt until the street closes — the way a bet sits
   * in front of its player rather than in a pot it is not yet part of. The
   * centre mound shows the pot *minus* these, so the felt's chips always sum
   * to the pot the HUD states.
   *
   * A cut stack, never a mound. Six pyramids around one table would run into
   * each other, and a bet is one player's gesture at one spot rather than the
   * table's whole middle. Extra columns spread along the ellipse's tangent at
   * the seat, not along screen X — a side seat's bet would otherwise grow into
   * the rail.
   */
  syncBets(bets: Array<{ slot: number; amount: number }>, seatCount: number, bigBlind: number): void {
    const wanted = new Set<string>();
    for (const { slot, amount } of bets) {
      const units = chipBreakdown(amount, bigBlind, MAX_BET_CHIPS);
      if (units.length === 0) continue;
      const layout = betSlots(units.length, this.chipRadius);
      const origin = this.space.betSpot(slot, seatCount);
      const theta = seatAngle(slot, seatCount);
      const tangent = { x: -Math.sin(theta), z: Math.cos(theta) };

      units.forEach((unit, index) => {
        const key = `${slot}:${unit.denomination}:${unit.denominationIndex}`;
        wanted.add(key);
        const place = layout[index];
        const rest: Vec3 = {
          x: origin.x + tangent.x * place.offsetX,
          y: this.space.feltY,
          z: origin.z + tangent.z * place.offsetX,
        };
        const existing = this.bets.get(key);
        if (existing) {
          this.rehome(existing, rest, place.index);
          return;
        }
        this.bets.set(key, this.arrive(key, unit.denomination, rest, place, BET_DROP_RADII, 0, slot));
        this.onChanged();
      });
    }
    this.prune(this.bets, wanted);
  }

  /**
   * The street closing: every standing bet is thrown into the middle, the way
   * a dealer sweeps the action in before the next card.
   *
   * The permanent chips are removed and transient ones spawned in their exact
   * places. That is the same "spawn, fly, destroy" cycle everything else here
   * uses, and it means the sweep cannot leave a bet chip half-swept if it is
   * interrupted — the standing bets are already gone the instant it starts.
   */
  sweepBets(): void {
    const profile = MOTION.sweep;
    const pot = this.space.pot();
    let order = 0;
    for (const entry of this.bets.values()) {
      const from = entry.chip.position;
      // Aimed at the mound's own footprint rather than at one point, so a
      // swept street piles up instead of stacking into a single spike.
      const spread = this.chipRadius * 1.9;
      const angle = order * GOLDEN_ANGLE_RAD;
      const to: Vec3 = {
        x: pot.x + Math.cos(angle) * spread,
        y: this.space.feltY,
        z: pot.z + Math.sin(angle) * spread * 0.6,
      };
      this.launch({
        denomination: entry.chip.denomination,
        from,
        to,
        fromStack: entry.chip.stackIndex,
        toStack: 0,
        profile,
        delayMs: order * profile.staggerMs,
      });
      order += 1;
    }
    if (order > 0) {
      this.sweepRemainingMs = sprayDurationMs(order, profile);
      this.onChanged();
    }
    this.bets.clear();
  }

  /**
   * Standing bets, gone at once — for the moments a sweep would lie: a new
   * hand mounting over a stale one, or the payout, where the pot the bets
   * already joined is the thing flying out.
   */
  clearBets(): void {
    if (this.bets.size > 0) this.onChanged();
    this.bets.clear();
  }

  /* ---------------------------------------------------------------- *
   * The transient populations.
   * ---------------------------------------------------------------- */

  /**
   * A bet: the amount actually committed, as chips, from the player's own
   * tray to their bet spot — smallest denominations first, so the big chips
   * land last and end up on top where they read.
   *
   * `kind` is the poker action, and it is what sets the timing: a call is the
   * quickest thing at the table and a shove is allowed to be a moment. The
   * player's bet-style preference modifies that motion rather than replacing
   * it (see `betStyleMotion`) — every style now gets the same spring, arc and
   * per-chip variation, and differs in how much of each.
   *
   * The chips leave as a cut stack (chip `i` starts `i` high in the hand) and
   * land in the column the standing bet is about to occupy, which is what
   * makes the throw and the settle read as one gesture.
   */
  spawnBet(
    slot: number,
    seatCount: number,
    amount: number,
    bigBlind: number,
    kind: ChipMoveKind = "bet",
  ): void {
    const base = MOTION[kind] ?? MOTION.bet;
    const style = betStyleMotion(this.betStyle);
    const profile: MotionProfile = {
      ...base,
      arcPeakRadii: base.arcPeakRadii * style.arcScale,
      staggerMs: base.staggerMs * style.staggerScale,
    };
    const origin = this.space.tray(slot, seatCount);
    const spot = this.space.betSpot(slot, seatCount);
    const denominations = spraySequence(amount, bigBlind, MAX_SPRAY_CHIPS);
    if (denominations.length === 0) return;
    const layout = betSlots(denominations.length, this.chipRadius);
    const theta = seatAngle(slot, seatCount);
    const tangent = { x: -Math.sin(theta), z: Math.cos(theta) };

    denominations.forEach((denomination, index) => {
      const place = layout[index];
      const scatter = style.scatterRadii > 0
        ? {
          x: Math.sin(index * GOLDEN_ANGLE_RAD) * style.scatterRadii * this.chipRadius,
          z: Math.cos(index * GOLDEN_ANGLE_RAD) * style.scatterRadii * this.chipRadius * 0.6,
        }
        : { x: 0, z: 0 };
      this.launch({
        denomination,
        ownerSlot: slot,
        from: { x: origin.x, y: this.space.feltY, z: origin.z },
        to: {
          x: spot.x + tangent.x * place.offsetX + scatter.x,
          y: this.space.feltY,
          z: spot.z + tangent.z * place.offsetX + scatter.z,
        },
        fromStack: index,
        // A splashed chip lands loose on the cloth, not on a column.
        toStack: style.scatterRadii > 0 ? 0 : place.index,
        profile,
        delayMs: index * profile.staggerMs,
        varianceScale: style.varianceScale,
      });
    });
    this.onChanged();
  }

  /**
   * The pot going home.
   *
   * THE CHIPS THAT WERE ON THE TABLE ARE THE CHIPS THAT TRAVEL. That is the
   * whole of this method and it is what the previous version got wrong: it
   * recomputed a fresh breakdown of each winner's amount and flew that out of
   * the pot's centre, while `syncPile` separately deleted the mound and
   * `clearBets` deleted the standing bets. Three operations, and between them
   * the pot vanished, the callers' bets vanished, and an unrelated stack of a
   * different size slid away from a spot none of them had been sitting on.
   *
   * So this consumes the felt. Every resting chip — the mound and every chip
   * still standing in front of a caller, because those are part of the pot too
   * and they go to whoever won it — is turned into a flight that starts from
   * exactly where that chip already was. Nothing is deleted and nothing is
   * conjured.
   *
   * They also stop being destroyed on arrival. A paid chip lands, rests in
   * front of its winner for `PAYOUT_HOLD_MS`, and then fades. Cutting them at
   * the moment of arrival is what made the pot go somewhere and then not be
   * there: the eye follows the movement and finds nothing at the end of it.
   *
   * Split pots divide the chips by share rather than by value. The exact
   * amounts are in the HUD and always have been; what the felt has to show is
   * that two people were paid out of one pile.
   */
  payOut(
    winners: Array<{ slot: number; amount: number }>,
    seatCount: number,
    bigBlind: number,
  ): void {
    if (winners.length === 0) return;

    // A reservation whose carrier is still dropping in is about to have its
    // chip flown away; drop the carrier so it cannot land on an empty slot.
    for (const entry of [...this.pile.values(), ...this.bets.values()]) {
      if (!entry.carrier) continue;
      const index = this.flights.indexOf(entry.carrier);
      if (index >= 0) this.flights.splice(index, 1);
      entry.carrier = null;
      entry.visible = true;
    }

    // Top of the stack first, the way a hand actually lifts a pile: the chips
    // that were on top are the ones that leave first.
    const resting = [...this.pile.values(), ...this.bets.values()]
      .map((entry) => entry.chip)
      .sort((a, b) => b.stackIndex - a.stackIndex);
    this.pile.clear();
    this.bets.clear();

    const total = winners.reduce((sum, winner) => sum + Math.max(0, winner.amount), 0);
    let cursor = 0;

    winners.forEach((winner, index) => {
      const home = this.space.payout(winner.slot, seatCount);
      const last = index === winners.length - 1;
      const share = total > 0 ? Math.max(0, winner.amount) / total : 1 / winners.length;
      const wanted = last
        ? resting.length - cursor
        : Math.min(resting.length - cursor, Math.max(1, Math.round(resting.length * share)));
      const chips = resting.slice(cursor, cursor + Math.max(0, wanted));
      cursor += chips.length;

      // Nothing was resting on the felt — a divergent snapshot, or a hand that
      // ended before anything was committed. Fall back to the amount as chips,
      // leaving from the middle, so a winner is still visibly paid.
      const sources = chips.length > 0
        ? chips.map((chip) => ({ denomination: chip.denomination, from: { ...chip.position }, fromStack: chip.stackIndex }))
        : this.fallbackPayoutSources(winner.amount, bigBlind);
      if (sources.length === 0) return;

      /**
       * Where the chips come to rest in front of the winner.
       *
       * A payout can be bigger than a mound's own capacity — the pot is capped
       * at `MAX_POT_CHIPS`, but this sends the standing bets as well, so a
       * river call into a big pot can be half as many chips again. Rather than
       * dropping the overflow (which would be the vanishing this whole method
       * exists to stop), the layout wraps: each extra pass over the slots
       * stacks another tier on top. A monster pot lands as a taller mound,
       * which is exactly what it should look like.
       */
      const landing = pileSlots(
        Math.min(sources.length, MAX_POT_CHIPS),
        this.chipRadius,
        MAX_POT_COLUMNS,
      );
      if (landing.length === 0) return;
      const tierHeight = Math.max(...landing.map((slot) => slot.index)) + 1;
      const stagger = Math.min(
        MOTION.payout.staggerMs,
        PAYOUT_LAUNCH_WINDOW_MS / Math.max(1, sources.length),
      );

      sources.forEach((source, order) => {
        const base = landing[order % landing.length];
        const tier = Math.floor(order / landing.length);
        const slot = { ...base, index: base.index + tier * tierHeight };
        this.launch({
          denomination: source.denomination,
          from: source.from,
          to: { x: home.x + slot.offsetX, y: this.space.feltY, z: home.z + slot.offsetZ },
          fromStack: source.fromStack,
          toStack: slot.index,
          profile: MOTION.payout,
          delayMs: order * stagger,
          linger: { holdMs: PAYOUT_HOLD_MS, fadeMs: PAYOUT_FADE_MS, elapsedMs: 0 },
          visibleBeforeLaunch: true,
        });
      });
    });
    this.onChanged();
  }

  /** The amount as chips at the pot's centre, when the felt had none to send. */
  private fallbackPayoutSources(
    amount: number,
    bigBlind: number,
  ): Array<{ denomination: number; from: Vec3; fromStack: number }> {
    const pot = this.space.pot();
    const denominations = spraySequence(amount, bigBlind, MAX_PAYOUT_CHIPS);
    const slots = pileSlots(denominations.length, this.chipRadius, MAX_POT_COLUMNS);
    return denominations.map((denomination, index) => ({
      denomination,
      from: { x: pot.x + slots[index].offsetX, y: this.space.feltY, z: pot.z + slots[index].offsetZ },
      fromStack: slots[index].index,
    }));
  }

  /**
   * Clear everything in the air, e.g. when a new hand starts.
   *
   * A transient chip's `onArrive` is *not* run — it never arrived. That is
   * what stops a cancelled drop from revealing a permanent chip belonging to
   * a hand that is already over; the next sync re-reserves anything that is
   * still wanted.
   */
  clearFlights(): void {
    if (this.flights.length > 0) this.onChanged();
    this.flights.length = 0;
    this.sweepRemainingMs = 0;
    for (const entry of this.pile.values()) { entry.visible = true; entry.carrier = null; }
    for (const entry of this.bets.values()) { entry.visible = true; entry.carrier = null; }
  }

  /* ---------------------------------------------------------------- *
   * The frame.
   * ---------------------------------------------------------------- */

  /**
   * Advance every chip in the air by one frame. Returns whether anything
   * moved, which is what keeps the render loop awake.
   *
   * `reducedMotion` parks each chip on its target immediately. A player who
   * has asked their system for less movement should still see where the pot
   * went — removing the chips would remove information, not motion.
   */
  update(deltaMs: number, reducedMotion: boolean): boolean {
    if (this.flights.length === 0) return false;
    const delta = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
    this.sweepRemainingMs = Math.max(0, this.sweepRemainingMs - delta);

    for (let index = this.flights.length - 1; index >= 0; index -= 1) {
      const flight = this.flights[index];

      // Landed and only waiting out its linger. Held still, then faded — the
      // chip is not integrated again, because it has arrived and re-running
      // the spring against a target it is already sitting on would hand it
      // sub-pixel corrections forever.
      if (flight.landed) {
        const linger = flight.linger;
        if (!linger) {
          this.flights.splice(index, 1);
          continue;
        }
        linger.elapsedMs += delta;
        const fading = linger.elapsedMs - linger.holdMs;
        flight.chip.opacity = fading <= 0
          ? 1
          : linger.fadeMs > 0 ? Math.max(0, 1 - fading / linger.fadeMs) : 0;
        if (fading >= linger.fadeMs) this.flights.splice(index, 1);
        continue;
      }

      if (!reducedMotion && flight.delayMs > 0) {
        flight.delayMs -= delta;
        // A chip waiting its turn is still motion: the scheduler must not
        // sleep between a spray being requested and its last chip leaving.
        if (flight.delayMs > 0) continue;
      }

      flight.elapsedMs += delta;
      const t = reducedMotion || flight.profile.durationMs <= 0
        ? 1
        : Math.min(1, flight.elapsedMs / flight.profile.durationMs);

      if (t >= 1) {
        // The terminal snap. No residual sub-pixel frame may keep the demand
        // loop awake, and no chip may be left a rest-epsilon off its slot:
        // that error is per-chip, so it never averages out and the column it
        // belongs to stops lining up with the column beside it.
        flight.chip.position = { ...flight.to };
        flight.chip.stackIndex = flight.toStack;
        flight.chip.airborne = false;
        flight.chip.lift = 0;
        flight.chip.driftXPx = 0;
        flight.chip.driftYPx = 0;
        flight.chip.rollRad = 0;
        flight.chip.scaleX = 1;
        flight.chip.scaleY = 1;
        flight.onArrive?.();
        if (flight.linger) {
          // A payout chip has nothing to hand over to, so it stays visible
          // where it landed instead of being cut on the frame it arrives.
          flight.landed = true;
          continue;
        }
        this.flights.splice(index, 1);
        continue;
      }

      const progress = springCurve(t, flight.profile.feel);
      const lift = arcLift(t);
      const squash = deformation(t);
      const drift = flightDrift(t, flight.variance);
      flight.chip.position = {
        x: flight.from.x + (flight.to.x - flight.from.x) * progress,
        y: flight.from.y + (flight.to.y - flight.from.y) * progress + lift * flight.arcPeak,
        z: flight.from.z + (flight.to.z - flight.from.z) * progress,
      };
      flight.chip.stackIndex = flight.fromStack + (flight.toStack - flight.fromStack) * progress;
      flight.chip.airborne = !hasLanded(t);
      flight.chip.lift = lift;
      flight.chip.driftXPx = drift.x;
      flight.chip.driftYPx = drift.y;
      flight.chip.rollRad = flightRoll(t, flight.variance);
      flight.chip.scaleX = squash.scaleX;
      flight.chip.scaleY = squash.scaleY;
    }
    return true;
  }

  /** True once the last transient chip has been destroyed. */
  isIdle(): boolean {
    return this.flights.length === 0;
  }

  /**
   * Everything the painter should draw this frame, in no particular order —
   * the painter depth-sorts, because painting order is its concern and world
   * position is this module's.
   *
   * A permanent chip whose transient carrier is still in the air is skipped:
   * it is a reservation, and drawing it would show the chip at both ends of
   * its own flight.
   */
  drawList(): RenderChip[] {
    const out: RenderChip[] = [];
    for (const entry of this.pile.values()) if (entry.visible) out.push(entry.chip);
    for (const entry of this.bets.values()) if (entry.visible) out.push(entry.chip);
    for (const flight of this.flights) {
      // A chip still waiting its turn in a bet spray has not left the tray; it
      // is not on the felt yet and must not be drawn sitting on the rail. A
      // payout chip waiting its turn *is* on the felt — it is part of the pot
      // everyone is looking at — so it keeps being drawn until it leaves.
      if (flight.delayMs > 0 && !flight.visibleBeforeLaunch) continue;
      out.push(flight.chip);
    }
    return out;
  }

  /** Chips belonging to one player's standing bet or incoming bet flight. */
  drawListForOwner(ownerSlot: number): RenderChip[] {
    return this.drawList().filter((chip) => chip.ownerSlot === ownerSlot);
  }

  /* ---------------------------------------------------------------- *
   * Test seams. See `StackchipsSceneSeam`.
   * ---------------------------------------------------------------- */

  /** Every transient chip's world position — where the pot actually went. */
  debugChipPositions(): Vec3[] {
    return this.flights.map((flight) => ({ ...flight.chip.position }));
  }

  /**
   * Where every transient chip is *going*.
   *
   * A sibling of `debugChipPositions`, and they answer genuinely different
   * questions. A spray's chips are destroyed the frame they arrive, so the
   * shape a spray *assembles* is only ever visible as its targets: sampling
   * positions mid-flight shows chips at scattered points on their own arcs,
   * which tells you nothing about whether they form a column.
   */
  debugFlightTargets(): Vec3[] {
    return this.flights.map((flight) => ({ ...flight.to }));
  }

  /** Chips resting in the pot mound, reservations included. */
  debugPileSize(): number {
    return this.pile.size;
  }

  /** Chips standing in front of bettors, reservations included. */
  debugBetChips(): number {
    return this.bets.size;
  }

  /* ---------------------------------------------------------------- *
   * Internals.
   * ---------------------------------------------------------------- */

  /**
   * Reserve a permanent chip and spawn the transient one that delivers it.
   *
   * The reservation is invisible until its carrier lands, so the two are never
   * on screen together and the permanent chip is never the thing in motion.
   */
  private rehome(entry: PermanentChip, rest: Vec3, stackIndex: number): void {
    entry.chip.position = rest;
    entry.chip.stackIndex = stackIndex;
    if (!entry.carrier) return;
    entry.carrier.to = { ...rest };
    entry.carrier.toStack = stackIndex;
    // The drop is vertical, so its launch point follows its landing point.
    entry.carrier.from = { ...rest, y: rest.y + PILE_DROP_RADII * this.chipRadius };
  }

  private arrive(
    key: string,
    denomination: number,
    rest: Vec3,
    slot: StackSlot,
    dropRadii: number,
    delayMs: number,
    ownerSlot?: number,
  ): PermanentChip {
    const entry: PermanentChip = {
      visible: false,
      carrier: null,
      chip: {
        denomination,
        position: rest,
        stackIndex: slot.index,
        seed: seedOf(key),
        airborne: false,
        lift: 0,
        driftXPx: 0,
        driftYPx: 0,
        rollRad: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        ownerSlot,
      },
    };
    entry.carrier = this.launch({
      denomination,
      ownerSlot,
      from: { ...rest, y: rest.y + dropRadii * this.chipRadius },
      to: rest,
      fromStack: slot.index,
      toStack: slot.index,
      profile: MOTION.drop,
      delayMs: delayMs + slot.index * MOTION.drop.staggerMs,
      onArrive: () => {
        entry.visible = true;
        entry.carrier = null;
      },
    });
    return entry;
  }

  private launch(spec: {
    denomination: number;
    ownerSlot?: number;
    from: Vec3;
    to: Vec3;
    fromStack: number;
    toStack: number;
    profile: MotionProfile;
    delayMs: number;
    varianceScale?: number;
    onArrive?: () => void;
    linger?: { holdMs: number; fadeMs: number; elapsedMs: number };
    visibleBeforeLaunch?: boolean;
  }): Flight {
    this.flightSeed += 1;
    const seed = this.flightSeed;
    const raw = flightVariance(seed);
    const scale = spec.varianceScale ?? 1;
    const flight: Flight = {
      chip: {
        denomination: spec.denomination,
        position: { ...spec.from },
        stackIndex: spec.fromStack,
        seed,
        airborne: true,
        lift: 0,
        driftXPx: 0,
        driftYPx: 0,
        rollRad: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        ownerSlot: spec.ownerSlot,
      },
      from: { ...spec.from },
      to: { ...spec.to },
      fromStack: spec.fromStack,
      toStack: spec.toStack,
      profile: spec.profile,
      arcPeak: spec.profile.arcPeakRadii * this.chipRadius,
      variance: {
        rollRad: raw.rollRad * scale,
        driftXPx: raw.driftXPx * scale,
        driftYPx: raw.driftYPx * scale,
        driftPhase: raw.driftPhase,
      },
      elapsedMs: 0,
      delayMs: Math.max(0, spec.delayMs),
      onArrive: spec.onArrive,
      landed: false,
      linger: spec.linger,
      visibleBeforeLaunch: spec.visibleBeforeLaunch ?? false,
    };
    this.flights.push(flight);
    return flight;
  }

  /**
   * Drop permanent chips the latest sync no longer wants.
   *
   * A standing bet or a mound only shrinks outside a sweep on a reconnect or
   * a divergent refetch, and the honest correction there is instant.
   */
  private prune(population: Map<string, PermanentChip>, wanted: Set<string>): void {
    for (const key of population.keys()) {
      if (wanted.has(key)) continue;
      population.delete(key);
      this.onChanged();
    }
  }
}

/**
 * A stable integer from a chip's key.
 *
 * The imperfections in `chip-spec.ts` are seeded from this, so a chip that has
 * already settled is handed its identical tilt, slide and face orientation
 * every time the pile is rebuilt from a snapshot. Without it the whole mound
 * shimmers each time anybody bets.
 */
function seedOf(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000;
}
