// A namespace import, not a default one -- same reason stackacres-scene.ts's
// own top-of-file comment gives: the package's ESM build has only named
// exports, and `import Phaser from "phaser"` fails at build time.
import * as Phaser from "phaser";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import { STACKACRES_ITEM_CATALOGUE } from "@/lib/stackacres/items";
import { isoDepthAt, isoProject } from "@/lib/stackacres/iso";
import {
  CRIT_FLASH_DURATION_MS,
  CRIT_SHAKE_DURATION_MS,
  barnAbsorbAlpha,
  barnAbsorbDepth,
  barnAbsorbScale,
  barnArcControlPoint,
  critFlashLabel,
  critShakeIntensity,
  harvestPopAngleRange,
  juiceItemFor,
  juiceStyleFor,
  quadraticBezierPoint,
  type JuiceShardStyle,
  type Point,
} from "@/lib/stackacres/juice";
import { RAMPS, hex, type RampName } from "./art-palette";
import type { PainterName } from "./stackacres-art";

/**
 * GameJuiceManager: the "it heard you" layer for StackAcres.
 *
 * A tap on a ready crop or a lucky harvest has to feel answered the instant
 * the finger lands -- see the constraint this class is built to, restated
 * from stackacres-scene.ts's own `popUnit`: "a tap on the map feels like a
 * button and a tap that waits for a response does not." Every trigger here
 * is therefore FIRE-AND-FORGET: called synchronously from a pointer-down
 * handler, with no await and no dependency on whatever the settlement write
 * eventually returns. If a harvest is later refused (muck, a lost race), the
 * caller's own refusal path (`floatAt` with `tone: "deny"`) says so
 * separately -- this class never rolls that back, the same way a button's
 * press animation does not play in reverse when a click handler throws.
 *
 * WORLD-SPACE IN, SCREEN-SPACE OUT, ALWAYS THROUGH iso.ts. Every trigger
 * below takes true WORLD coordinates (the same space ./world.ts and every
 * unit's stored position live in) and projects them with `isoProject`/
 * `isoDepthAt` itself -- never a screen point handed in pre-projected. That
 * is what keeps a burst depth-sorted against the standing crop layer and the
 * barn: both this class and stackacres-scene.ts's own `depthAt` read the
 * identical formula out of iso.ts, so neither can drift from the other.
 *
 * POOLED, NOT ALLOCATED PER TAP. The one thing StackAcres taps rapidly
 * during a session is exactly the thing a poker table next door cannot
 * afford to stutter for: a GC pause from allocating and discarding
 * GameObjects on every tap. Every particle burst this class throws goes
 * through a small number of `Phaser.GameObjects.Particles.ParticleEmitter`s
 * created ONCE (one per shard colour actually used, lazily, on first use)
 * and re-fired with `.explode()` from then on -- a real emitter is Phaser's
 * own pooled-particle primitive, not a Graphics object stood up and torn
 * down per burst the way stackacres-scene.ts's own `celebrateHarvest` still
 * does for its sparks. The handful of transient sprites this class DOES
 * create per trigger (the popped item icon, the barn-absorb flight) are
 * cheap, short-lived, single GameObjects -- the same shape `celebrateHarvest`
 * and `floatAt` already use throughout the scene for one-shot effects -- and
 * are not pooled, because pooling a once-per-tap Image buys nothing a
 * one-line `destroy()` in its own tween's `onComplete` does not already give
 * for free.
 */

export interface GameJuiceManagerConfig {
  /** True WORLD point of the barn's own doorway -- `triggerBarnAbsorb`'s
   *  flight destination. Passed in rather than imported so this class does
   *  not hold its own copy of stackacres-scene.ts's BARN_X/BARN_Y. */
  barnPoint: Point;
  /** Mirrors stackacres-scene.ts's own `options.reducedMotion`: every
   *  trigger below still does its job (a shard still lands, a crit is still
   *  legible, an item still visibly reaches the barn) but skips the tween
   *  and jump-cuts to the resting state, the same posture `popUnit`/
   *  `celebrateHarvest`/`floatAt` already take. */
  reducedMotion: boolean;
  /**
   * The crit label's font, in CSS `font-family` shorthand. Optional because
   * this class has no DOM host of its own to read one off -- pass
   * `window.getComputedStyle(host).fontFamily` (`floatAt`'s own recipe) to
   * pick up the farm's Baloo 2 display font; falls back to that font's own
   * declared fallback stack (stackacres-font.ts) otherwise.
   */
  fontFamily?: string;
}

const FALLBACK_FONT_STACK =
  'ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", system-ui, sans-serif';

/** Depth (or nudge) constants shared by every trigger, named rather than
 *  inlined so the three effects' stacking order against each other and
 *  against the world is legible in one place. */
const HARVEST_POP_DEPTH_NUDGE = 4;
const HARVEST_SHARD_DEPTH_NUDGE = 3.5;
const CRIT_TEXT_DEPTH = 9500; // above floatAt's own 9000: a crit outranks a plain reward toast
const BARN_ABSORB_DEPTH_NUDGE = 2;
const BARN_ABSORB_FLIGHT_MS = 520;
const BARN_ABSORB_ARRIVE_SHARDS = 6;

export class GameJuiceManager {
  private readonly scene: Phaser.Scene;
  private readonly config: GameJuiceManagerConfig;
  /** One pooled emitter per RAMPS colour actually used, created lazily and
   *  reused for every future burst of that colour -- see this class's own
   *  doc comment for why this is the load-bearing part of "low overhead". */
  private readonly shardEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

  constructor(scene: Phaser.Scene, config: GameJuiceManagerConfig) {
    this.scene = scene;
    this.config = config;
  }

  /* ------------------------------------------------------------------ */
  /* Trigger 1: the harvest pop                                          */
  /* ------------------------------------------------------------------ */

  /**
   * A ready unit answers a tap immediately: its icon pops straight up and
   * settles, and a burst of shards in that stock's own colour throws outward
   * and falls. `x`/`y` are the unit's true WORLD position (the same point
   * `celebrateHarvest` reads off the unit's own node) -- projected here, not
   * by the caller.
   */
  triggerHarvestPop(x: number, y: number, cropType: StackAcresStock): void {
    if (!this.scene.sys.isActive()) return;
    const screen = isoProject(x, y);
    const depth = isoDepthAt(x, y, HARVEST_POP_DEPTH_NUDGE);
    const style = juiceStyleFor(cropType);

    this.popIcon(screen, depth, cropType);
    this.burstShards(screen, isoDepthAt(x, y, HARVEST_SHARD_DEPTH_NUDGE), style);
  }

  /** The item's own icon, thrown up and scaled with a hard overshoot then a
   *  small settle -- "a violent upward pop", not a gentle fade-in. */
  private popIcon(screen: Point, depth: number, cropType: StackAcresStock): void {
    const item = juiceItemFor(cropType);
    const iconName = STACKACRES_ITEM_CATALOGUE[item].icon as PainterName;
    const icon = this.scene.add
      .image(screen.x, screen.y, iconName)
      .setDepth(depth)
      .setOrigin(0.5, 0.5)
      .setScale(0.001); // texture may not exist yet the first time; scaling
    // from ~0 rather than skipping the frame hides a not-yet-baked texture's
    // default placeholder square just as effectively as waiting for it would,
    // with no async gap before the pop starts.

    if (this.config.reducedMotion) {
      icon.setScale(1);
      this.scene.time.delayedCall(260, () => icon.destroy());
      return;
    }
    this.scene.tweens.chain({
      targets: icon,
      tweens: [
        { scale: 1.35, y: screen.y - 22, duration: 130, ease: "Back.easeOut" },
        { scale: 1, y: screen.y - 14, duration: 140, ease: "Quad.easeIn" },
        { alpha: 0, y: screen.y - 8, duration: 160, ease: "Quad.easeIn", delay: 60 },
      ],
      onComplete: () => icon.destroy(),
    });
  }

  /** Procedural colour shards thrown outward and pulled down, entirely
   *  through a pooled emitter -- see this class's own doc comment. */
  private burstShards(screen: Point, depth: number, style: JuiceShardStyle): void {
    const emitter = this.ensureShardEmitter(style);
    emitter.setDepth(depth);
    emitter.setPosition(screen.x, screen.y);
    emitter.explode(style.shardCount);
  }

  /**
   * The pooled emitter for one shard style, created once per RAMPS colour
   * and kept forever after: every later harvest pop of the same stock
   * re-fires the SAME emitter instead of standing a new one up, which is
   * what makes a rapid run of taps throw zero garbage beyond the particles
   * Phaser's own emitter already recycles internally.
   */
  private ensureShardEmitter(style: JuiceShardStyle): Phaser.GameObjects.Particles.ParticleEmitter {
    const existing = this.shardEmitters.get(style.ramp);
    if (existing) return existing;

    const textureKey = this.ensureShardTexture(style.ramp as RampName, style.shardRadius);
    const emitter = this.scene.add.particles(0, 0, textureKey, {
      lifespan: { min: style.lifeMs.min, max: style.lifeMs.max },
      speed: { min: style.speed.min, max: style.speed.max },
      angle: harvestPopAngleRange(), // the one source of truth for this cone; see its own comment
      gravityY: style.gravity,
      scale: { start: 1, end: 0.4 },
      alpha: { start: 1, end: 0 },
      quantity: 0, // fired only via explode() -- this emitter never runs idle
      emitting: false,
    });
    this.shardEmitters.set(style.ramp, emitter);
    return emitter;
  }

  /** A small filled diamond in one RAMPS tone, baked once and reused by
   *  every future shard of that colour -- the same
   *  bake-once-key-by-name-check-`textures.exists` pattern
   *  stackacres-art.ts's own `bakeTexture`/`bakeSparkle` use for every other
   *  procedural texture in this scene. */
  private ensureShardTexture(ramp: RampName, radius: number): string {
    const key = `juice-shard-${ramp}`;
    if (this.scene.textures.exists(key)) return key;
    const px = Math.max(4, Math.ceil(radius * 2) + 2);
    const texture = this.scene.textures.createCanvas(key, px, px);
    if (!texture) return key;
    const c = texture.context;
    const mid = px / 2;
    c.fillStyle = RAMPS[ramp].top;
    c.beginPath();
    c.moveTo(mid, 0);
    c.lineTo(px, mid);
    c.lineTo(mid, px);
    c.lineTo(0, mid);
    c.closePath();
    c.fill();
    texture.refresh();
    return key;
  }

  /* ------------------------------------------------------------------ */
  /* Trigger 2: the crit flash                                           */
  /* ------------------------------------------------------------------ */

  /**
   * A critical harvest: a micro camera shake, a soft gold flash, and
   * bouncy, scaling floating text naming the exact multiplier -- "CRIT!
   * x1.75", never a rounded or vague number, since the player just watched
   * equipment.ts pay out exactly that much. `x`/`y` are the harvested
   * unit's WORLD position; `multiplier` is the harvest's TOTAL payout
   * multiple (1 + critBonus -- see critFlashLabel's own doc comment for why
   * it is not critBonus itself).
   */
  triggerCritFlash(x: number, y: number, multiplier: number): void {
    if (!this.scene.sys.isActive()) return;
    const screen = isoProject(x, y);
    const cam = this.scene.cameras.main;

    if (!this.config.reducedMotion) {
      cam.shake(CRIT_SHAKE_DURATION_MS, critShakeIntensity(multiplier));
      // Soft gold, not white -- a full-white flash on a green farm reads as
      // "screen glitched", not "you got lucky".
      const gold = RAMPS.gold.top;
      cam.flash(CRIT_FLASH_DURATION_MS, (hex(gold) >> 16) & 255, (hex(gold) >> 8) & 255, hex(gold) & 255);
    }

    this.critText(screen, critFlashLabel(multiplier));
  }

  /** The label itself: scales in past 1 and springs back -- the "bouncy
   *  3D-style" read the brief asks for -- then lifts and fades, the same
   *  final beat stackacres-scene.ts's own `floatAt` uses for a reward. */
  private critText(screen: Point, text: string): void {
    const label = this.scene.add
      .text(screen.x, screen.y, text, {
        fontFamily: this.config.fontFamily ?? FALLBACK_FONT_STACK,
        fontSize: "22px",
        fontStyle: "800",
        color: RAMPS.gold.top,
        stroke: RAMPS.pine.rim,
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(CRIT_TEXT_DEPTH);

    if (this.config.reducedMotion) {
      label.setScale(1);
      this.scene.tweens.add({
        targets: label,
        alpha: 0,
        duration: 600,
        delay: 400,
        onComplete: () => label.destroy(),
      });
      return;
    }

    label.setScale(0.2);
    this.scene.tweens.chain({
      targets: label,
      tweens: [
        { scale: 1.3, duration: 160, ease: "Back.easeOut" },
        { scale: 1, duration: 140, ease: "Sine.easeInOut" },
        {
          y: screen.y - 46,
          alpha: 0,
          duration: 520,
          ease: "Cubic.easeOut",
          delay: 260,
        },
      ],
      onComplete: () => label.destroy(),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Trigger 3: the barn absorb                                          */
  /* ------------------------------------------------------------------ */

  /**
   * A collected item's flight from the player's own tap into the glowing
   * barn: a smooth arc (a single quadratic Bezier -- see
   * `barnArcControlPoint`), shrinking and fading only in its last quarter so
   * it reads as arriving rather than dissolving mid-air, with a small burst
   * of shards at the barn on contact. `startX`/`startY` are the true WORLD
   * point the flight leaves from.
   */
  triggerBarnAbsorb(startX: number, startY: number): void {
    if (!this.scene.sys.isActive()) return;
    const start = isoProject(startX, startY);
    const end = isoProject(this.config.barnPoint.x, this.config.barnPoint.y);
    const startDepth = isoDepthAt(startX, startY, BARN_ABSORB_DEPTH_NUDGE);
    const endDepth = isoDepthAt(this.config.barnPoint.x, this.config.barnPoint.y, BARN_ABSORB_DEPTH_NUDGE);

    const glow = this.scene.add
      .circle(start.x, start.y, 5, hex(RAMPS.gold.top))
      .setStrokeStyle(1.5, hex(RAMPS.gold.rim))
      .setDepth(startDepth);

    if (this.config.reducedMotion) {
      glow.setPosition(end.x, end.y).setDepth(endDepth);
      this.scene.time.delayedCall(180, () => {
        glow.destroy();
        this.arriveAtBarn(end, endDepth);
      });
      return;
    }

    const control = barnArcControlPoint(start, end);
    const flight = { t: 0 };
    this.scene.tweens.add({
      targets: flight,
      t: 1,
      duration: BARN_ABSORB_FLIGHT_MS,
      ease: "Cubic.easeIn", // gathers speed as it nears the barn, like being pulled in
      onUpdate: () => {
        const p = quadraticBezierPoint(start, control, end, flight.t);
        glow.setPosition(p.x, p.y);
        glow.setScale(barnAbsorbScale(flight.t));
        glow.setAlpha(barnAbsorbAlpha(flight.t));
        glow.setDepth(barnAbsorbDepth(startDepth, endDepth, flight.t));
      },
      onComplete: () => {
        glow.destroy();
        this.arriveAtBarn(end, endDepth);
      },
    });
  }

  /** The barn's own small acknowledgement of an arrival: a burst in the
   *  same gold as everywhere else a Gold gain is celebrated
   *  (`celebrateHarvest`'s spark colour), through the same pooled emitter
   *  machinery the harvest pop uses. */
  private arriveAtBarn(at: Point, depth: number): void {
    const style = juiceStyleFor("cash_crop"); // borrowed only for its gold ramp; not a crop-specific burst
    const emitter = this.ensureShardEmitter({ ...style, ramp: "gold" });
    emitter.setDepth(depth);
    emitter.setPosition(at.x, at.y);
    emitter.explode(BARN_ABSORB_ARRIVE_SHARDS);
  }

  /* ------------------------------------------------------------------ */

  /** Releases every pooled emitter this instance owns. Baked shard textures
   *  are left in the scene's texture cache on purpose, the same way
   *  stackacres-art.ts's own baked textures are: Phaser tears the whole
   *  cache down with the scene, and re-baking on every scene restart would
   *  cost more than leaving a few 12px canvases parked. Call from the owning
   *  scene's own `shutdown`. */
  destroy(): void {
    for (const emitter of this.shardEmitters.values()) emitter.destroy();
    this.shardEmitters.clear();
  }
}
