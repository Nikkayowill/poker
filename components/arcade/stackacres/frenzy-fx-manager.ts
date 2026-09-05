// A namespace import, not a default one -- same reason every other file in
// this scene gives: the package's ESM build has only named exports, and
// `import Phaser from "phaser"` fails at build time. `Phaser.BlendModes` is
// read as a value below, not just as a type.
import * as Phaser from "phaser";
import {
  FRENZY_PULSE_AMPLITUDE,
  frenzyEmberCount,
  frenzyOverlayAlpha,
  frenzyOverlayColor,
  frenzyPulseScale,
  type FrenzySnapshot,
  type FrenzyTierDef,
} from "@/lib/stackacres/frenzy";
import { RAMPS } from "./art-palette";

/**
 * FrenzyFxManager: the Phaser side of the Frenzy Heat Combo Engine
 * (lib/stackacres/frenzy.ts). Owns GameObjects and plays back numbers that
 * file already decided; it renders no opinion of its own about what heat
 * means or how a tier's multipliers are chosen.
 *
 * SAME SPLIT AS WeatherOverlayManager, DELIBERATELY. That class's own header
 * explains why a self-contained class beats more private fields on
 * StackAcresScene while several StackAcres features land in parallel, and
 * the same reasoning applies here. It is also the reason this file's screen
 * wash is built the exact way `WeatherOverlayManager.create`'s own tint
 * overlay is -- Phaser's built-in `"__WHITE"` pixel, stretched and tinted,
 * `Phaser.BlendModes.ADD` so the warmth reads as a glow laid over the scene
 * rather than a flat colour cast over it -- rather than a second, slightly
 * different way of doing the same thing.
 *
 * NO PERSISTENT PARTICLE EMITTER. See `frenzyEmberCount`'s own doc comment
 * in lib/stackacres/frenzy.ts for why: this codebase's one live screen-space
 * effect layer (`WeatherOverlayManager`) and this scene's own per-tap
 * effects (`celebrateHarvest`, `cutBurst`) are both hand-built
 * `Graphics`/`Image` objects thrown per event and torn down in their own
 * tween's `onComplete`, never a `Phaser.GameObjects.Particles.ParticleEmitter`
 * -- the one class in this codebase that does reach for a real emitter
 * (game-juice-manager.ts) is unwired dead code. `celebrateTap` below follows
 * the wired convention: a burst is thrown once, from the tap that earned it,
 * and nothing here runs a per-frame emission schedule.
 *
 * SCREEN-SPACE IN FOR THE BURST, NOT WORLD-SPACE. `celebrateTap`'s `at` is
 * expected ALREADY PROJECTED -- the same convention this scene's own
 * `celebrateHarvest` uses (`node.container.x`/`.y`, which `setUnits` already
 * populated via `isoProject`), and the opposite of game-juice-manager.ts's
 * own world-space-in contract. The caller (stackacres-scene.ts) already has
 * a projected point in hand for every unit it owns, so projecting a second
 * time here would be the exact double-projection paintPaths's own comment
 * warns against.
 */

/** Depth for the full-screen heat wash: above the vignette (1e9) so its warm
 *  glow sits over the corner-darkening rather than under it, below the
 *  "you've gone far enough" edge guides (2e9) so wayfinding always reads
 *  through it. */
const FRENZY_OVERLAY_DEPTH = 1.5e9;
/** Above `game-juice-manager.ts`'s own `CRIT_TEXT_DEPTH` (9500) -- "above
 *  floatAt's own reward toast" is that constant's own reasoning, and a
 *  frenzy bonus label is the same kind of one-shot celebration text sharing
 *  the same stacking order. */
const FRENZY_BONUS_TEXT_DEPTH = 9600;
/** Bursts sit just under the label, at `celebrateHarvest`'s own spark depth
 *  (8501), so a frenzy burst layers correctly against every other spark this
 *  scene already throws. */
const FRENZY_BURST_DEPTH = 8501;

const FALLBACK_FONT_STACK =
  'ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", system-ui, sans-serif';

export interface FrenzyFxManagerConfig {
  /** The farm's own display face -- see stackacres-scene.ts's own
   *  `displayFont` for why this cannot be a literal. Optional because a
   *  bonus label falls back to this file's own generic rounded stack, the
   *  same fallback `GameJuiceManagerConfig.fontFamily` documents. */
  fontFamily?: string;
}

/** A screen point, already projected -- see this file's own header for why
 *  `celebrateTap` does not take a world point. */
export interface FrenzyScreenPoint {
  x: number;
  y: number;
}

export class FrenzyFxManager {
  private readonly scene: Phaser.Scene;
  private readonly config: FrenzyFxManagerConfig;
  private overlay: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene, config: FrenzyFxManagerConfig = {}) {
    this.scene = scene;
    this.config = config;
  }

  /** Allocates the one GameObject this manager owns. Call once, the same
   *  place stackacres-scene.ts calls `buildSunlight`/`this.weather.create()`. */
  create(): void {
    this.overlay = this.scene.add
      .image(0, 0, "__WHITE")
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(FRENZY_OVERLAY_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
  }

  /**
   * One frame: fits and tints the wash to the current heat, and drives its
   * own gentle scale-pulse at the top two tiers (see `frenzyPulseScale`).
   *
   * The pulse is baked into the DISPLAY SIZE, not a `.setScale()` call laid
   * on top of it -- `setDisplaySize` already computes an absolute scale from
   * the camera's own dimensions every frame (the same zoom-correction
   * `WeatherOverlayManager.animateTint`/this scene's own `fitVignette` both
   * need for a `scrollFactor(0)` object), so a later `.setScale()` would
   * overwrite that instead of multiplying it. The base size is oversized by
   * `1 + FRENZY_PULSE_AMPLITUDE` before the pulse (itself `1 ±
   * FRENZY_PULSE_AMPLITUDE`) is applied on top, so the smallest frame of the
   * pulse (`(1 - AMP) * (1 + AMP) = 1 - AMP^2`) still overshoots the camera's
   * true size -- the wash never visibly gaps at a screen edge mid-pulse.
   */
  setHeat(snapshot: FrenzySnapshot, time: number): void {
    const overlay = this.overlay;
    if (!overlay) return;
    const cam = this.scene.cameras.main;
    const pulse = frenzyPulseScale(snapshot.heat, time);
    const headroom = 1 + FRENZY_PULSE_AMPLITUDE;
    const baseW = cam.width / cam.zoom + 2;
    const baseH = cam.height / cam.zoom + 2;

    overlay.setPosition(cam.width / 2, cam.height / 2);
    overlay.setDisplaySize(baseW * headroom * pulse, baseH * headroom * pulse);
    overlay.setTint(frenzyOverlayColor(snapshot.heat));
    overlay.setAlpha(frenzyOverlayAlpha(snapshot.heat));
  }

  /**
   * One accepted tap, at its own already-projected screen point: an ember
   * burst sized by heat (nothing at all below `FRENZY_EMBER_MIN_HEAT` -- see
   * `frenzyEmberCount`) and, when `bonusGold` is a positive DISPLAY-ONLY
   * estimate, a tier-labelled float naming it.
   *
   * `bonusGold` IS NEVER GOLD THE PLAYER ACTUALLY RECEIVES -- it is
   * `frenzyBonusYield`'s own estimate, thrown here purely as a "you are on
   * fire" flourish. The caller (stackacres-scene.ts's `registerFrenzyTap`)
   * is the one place this number and a real settlement ever appear in the
   * same function, and it never adds this number to anything -- see this
   * file's own header and lib/stackacres/frenzy.ts's for the money-safety
   * argument in full.
   */
  celebrateTap(at: FrenzyScreenPoint, snapshot: FrenzySnapshot, bonusGold: number): void {
    if (!this.scene.sys.isActive()) return;
    const emberCount = frenzyEmberCount(snapshot.heat);
    if (emberCount > 0) this.burstEmbers(at, snapshot.tier, emberCount);
    if (bonusGold > 0 && snapshot.tier.tier !== "cold") this.bonusText(at, snapshot.tier, bonusGold);
  }

  /** Small tier-tinted sparks thrown outward and pulled down -- structurally
   *  identical to this scene's own `celebrateHarvest` spark loop (one
   *  `Graphics` circle per spark, tweened, destroyed on completion), just
   *  coloured from the tier that earned it instead of a fixed gold. */
  private burstEmbers(at: FrenzyScreenPoint, tier: FrenzyTierDef, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const spark = this.scene.add.graphics().setDepth(FRENZY_BURST_DEPTH);
      spark.fillStyle(tier.tint, 1);
      spark.fillCircle(0, 0, 1.6);
      spark.setPosition(at.x, at.y);
      const angle = Math.random() * Math.PI * 2;
      const distance = 14 + Math.random() * 22;
      this.scene.tweens.add({
        targets: spark,
        x: at.x + Math.cos(angle) * distance,
        y: at.y + Math.sin(angle) * distance - 8, // a slight lift, same upward bias celebrateHarvest's own sparks take
        alpha: 0,
        scale: 0.3,
        duration: 420 + Math.random() * 220,
        ease: "Cubic.easeOut",
        onComplete: () => spark.destroy(),
      });
    }
  }

  /** "HOT +42" -- the tier's own label plus the display estimate, in the
   *  tier's own tint. Bouncy scale-in then a lift-and-fade, the same final
   *  beat this scene's `floatAt` and game-juice-manager.ts's `critText` both
   *  use for a one-shot reward label. */
  private bonusText(at: FrenzyScreenPoint, tier: FrenzyTierDef, bonusGold: number): void {
    const label = this.scene.add
      .text(at.x, at.y, `${tier.label} +${bonusGold}`, {
        fontFamily: this.config.fontFamily ?? FALLBACK_FONT_STACK,
        fontSize: "20px",
        fontStyle: "800",
        color: hexToCss(tier.tint),
        stroke: RAMPS.pine.rim,
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(FRENZY_BONUS_TEXT_DEPTH);

    label.setScale(0.2);
    this.scene.tweens.chain({
      targets: label,
      tweens: [
        { scale: 1.25, duration: 150, ease: "Back.easeOut" },
        { scale: 1, duration: 130, ease: "Sine.easeInOut" },
        { y: at.y - 40, alpha: 0, duration: 480, ease: "Cubic.easeOut", delay: 240 },
      ],
      onComplete: () => label.destroy(),
    });
  }

  /** Releases the wash. Call from the owning scene's own `shutdown` -- there
   *  is none today (Phaser's `game.destroy(true)` tears every GameObject
   *  down with the scene regardless, the same posture
   *  `game-juice-manager.ts`'s own `destroy()` is in), so this exists for
   *  symmetry with that class and for a test to call directly. */
  destroy(): void {
    this.overlay?.destroy();
    this.overlay = null;
  }
}

/** Packed 0xRRGGBB to a CSS hex string, for the one Phaser Text style
 *  (`color`) that wants a string rather than a number -- `setTint` above
 *  takes the packed number directly and needs no conversion. */
function hexToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
