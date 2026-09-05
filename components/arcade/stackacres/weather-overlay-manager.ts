/**
 * WeatherOverlayManager: the Phaser side of lib/stackacres/weather.ts.
 *
 * Same split as buildSunlight/animateSunlight in stackacres-scene.ts: this
 * class owns textures, blend modes and GameObjects; every number it reads
 * comes from the pure module, and it renders no opinion of its own about
 * what a state means or how long it lasts.
 *
 * A SEPARATE, self-contained class rather than more private methods on
 * StackAcresScene, on purpose: several StackAcres features are landing in
 * parallel right now (CLAUDE.md's active-milestone history), and this way
 * wiring weather in is two lines in that file's `create`/`update` rather
 * than a change to its own dense private-field block.
 *
 * THREE LAYERS, all fixed-cost -- allocated once in `create`, never grown:
 *   - a screen-pinned tint overlay (Phaser's built-in "__WHITE" pixel,
 *     stretched and tinted), the camera-tint half of the spec;
 *   - a WORLD-space pool of solar-dust motes, reusing stackacres-art.ts's
 *     own gold "sparkle" bake -- no new asset, per the "avoid heavy asset
 *     loads" constraint;
 *   - a SCREEN-pinned pool of rain streaks, baked once from this file the
 *     first time any scene asks for one.
 *
 * Solar dust is WORLD-pinned and rain is SCREEN-pinned for the same reason
 * sunlight.ts's own two layers split that way: dust suspended in a shaft of
 * light is a property of a place on the farm, while rain falling across the
 * whole view is a property of the sky and must not slide when the camera
 * pans.
 */

// A namespace import, not a default or type-only one: the package's ESM
// build has only named exports (a default import fails at build time), and
// Phaser.BlendModes is read as a value below, not just as a type.
import * as Phaser from "phaser";
import { bakeSparkle } from "./stackacres-art";
import {
  RAIN_STREAK_MAX,
  RAIN_STREAK_TILT,
  SOLAR_DUST_MAX,
  StackAcresWeather,
  WEATHER_TINT_TRANSITION_MS,
  applyWeatherModifiers,
  initialWeatherState,
  interpolateWeatherTint,
  packWeatherTint,
  rainStreakField,
  solarDustAlpha,
  solarDustField,
  stepWeather,
  type RainStreak,
  type SolarDustMote,
  type WeatherModifierResult,
  type WeatherSessionState,
} from "@/lib/stackacres/weather";

/** Depth for both screen-pinned layers: under the vignette (1e9, same
 *  constant stackacres-scene.ts's own sunlight layer uses) and above every
 *  world object. */
const OVERLAY_DEPTH = 1e9 - 2;

export class WeatherOverlayManager {
  private readonly scene: Phaser.Scene;
  private readonly random: () => number;

  private state: WeatherSessionState = initialWeatherState();
  /** The state the tint is fading FROM, held for `WEATHER_TINT_TRANSITION_MS`
   *  after a shift so `interpolateWeatherTint` has both ends. */
  private previousWeather: StackAcresWeather = StackAcresWeather.CLEAR;
  private tintProgressMs = WEATHER_TINT_TRANSITION_MS;

  private tintOverlay: Phaser.GameObjects.Image | null = null;
  private dustSprites: Phaser.GameObjects.Image[] = [];
  private dust: SolarDustMote[] = [];
  private rainSprites: Phaser.GameObjects.Image[] = [];
  private rain: RainStreak[] = [];

  constructor(scene: Phaser.Scene, random: () => number = Math.random) {
    this.scene = scene;
    this.random = random;
  }

  /** Allocates every GameObject this manager will ever use. Call once, the
   *  same place stackacres-scene.ts calls `buildSunlight`. */
  create(): void {
    const scene = this.scene;

    this.tintOverlay = scene.add
      .image(0, 0, "__WHITE")
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);

    const sparkleKey = bakeSparkle(scene);
    for (let i = 0; i < SOLAR_DUST_MAX; i += 1) {
      this.dustSprites.push(
        scene.add.image(0, 0, sparkleKey).setOrigin(0.5).setBlendMode(Phaser.BlendModes.ADD).setVisible(false),
      );
    }

    const streakKey = bakeRainStreak(scene);
    for (let i = 0; i < RAIN_STREAK_MAX; i += 1) {
      this.rainSprites.push(
        scene.add
          .image(0, 0, streakKey)
          .setOrigin(0.5, 0)
          .setScrollFactor(0)
          .setDepth(OVERLAY_DEPTH)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setRotation(RAIN_STREAK_TILT)
          .setVisible(false),
      );
    }
  }

  /** One frame. Advances the weather clock, cross-fades the tint, and steps
   *  both particle fields -- in that order, so a shift this frame is what
   *  the particle fields render against. */
  update(time: number, delta: number): void {
    const before = this.state.active;
    this.state = stepWeather(this.state, delta, this.random);
    if (this.state.active !== before) {
      this.previousWeather = before;
      this.tintProgressMs = 0;
    } else {
      this.tintProgressMs = Math.min(WEATHER_TINT_TRANSITION_MS, this.tintProgressMs + delta);
    }

    this.animateTint();
    this.animateSolarDust(delta);
    this.animateRain(delta);
  }

  /** The state active this frame -- read by whatever computes a settling
   *  harvest's `applyWeatherModifiers`. */
  getActiveWeather(): StackAcresWeather {
    return this.state.active;
  }

  /** Convenience passthrough so a caller never has to import
   *  lib/stackacres/weather.ts's registry itself just to price one yield. */
  modifiersFor(baseYield: number): WeatherModifierResult {
    return applyWeatherModifiers(baseYield, this.state.active);
  }

  /**
   * Whether GOLD_RUSH_RAIN's auto-collect is asking for a sweep this frame.
   *
   * A SIGNAL ONLY. This manager never calls a collection route -- the
   * farmhand is presentation and the server is authoritative, and wiring an
   * automatic write from a visual-layer class would break both of those
   * boundaries at once. Whatever already owns "collect this unit" (the same
   * place a tap goes today) is the right place to poll this once a cycle.
   */
  wantsAutoCollect(): boolean {
    return applyWeatherModifiers(0, this.state.active).autoCollect;
  }

  destroy(): void {
    this.tintOverlay?.destroy();
    for (const sprite of this.dustSprites) sprite.destroy();
    for (const sprite of this.rainSprites) sprite.destroy();
    this.tintOverlay = null;
    this.dustSprites = [];
    this.rainSprites = [];
  }

  /* ------------------------------------------------------------------ */
  /* Private: per-layer animation                                        */
  /* ------------------------------------------------------------------ */

  private animateTint(): void {
    const overlay = this.tintOverlay;
    if (!overlay) return;
    const cam = this.scene.cameras.main;
    // Same zoom correction stackacres-scene.ts's own god-ray layer needs: a
    // scrollFactor(0) object is still scaled about the camera's centre, so
    // holding a constant apparent size means dividing by zoom.
    overlay.setPosition(cam.width / 2, cam.height / 2);
    overlay.setDisplaySize(cam.width / cam.zoom + 2, cam.height / cam.zoom + 2);
    const tint = interpolateWeatherTint(this.previousWeather, this.state.active, this.tintProgressMs);
    overlay.setTint(packWeatherTint(tint));
    overlay.setAlpha(tint.intensity);
  }

  private animateSolarDust(delta: number): void {
    if (this.dustSprites.length === 0) return;
    const isSolarFlare = this.state.active === StackAcresWeather.SOLAR_FLARE;
    if (!isSolarFlare && this.dust.length === 0) {
      // Nothing to age and nothing to spawn -- skip the pool loop entirely
      // rather than hiding SOLAR_DUST_MAX sprites every idle frame.
      return;
    }
    const view = this.scene.cameras.main.worldView;
    this.dust = isSolarFlare
      ? solarDustField(this.dust, { x: view.x, y: view.y, width: view.width, height: view.height }, delta, this.random)
      : ageOutSolarDust(this.dust, delta);

    for (let i = 0; i < this.dustSprites.length; i += 1) {
      const sprite = this.dustSprites[i]!;
      const mote = this.dust[i];
      if (!mote) {
        sprite.setVisible(false);
        continue;
      }
      sprite.setVisible(true);
      sprite.setPosition(mote.x, mote.y);
      sprite.setDepth(mote.y);
      sprite.setAlpha(solarDustAlpha(mote) * 0.6);
    }
  }

  private animateRain(delta: number): void {
    if (this.rainSprites.length === 0) return;
    const isGoldRushRain = this.state.active === StackAcresWeather.GOLD_RUSH_RAIN;
    if (!isGoldRushRain && this.rain.length === 0) return;

    this.rain = isGoldRushRain ? rainStreakField(this.rain, delta, this.random) : [];
    const cam = this.scene.cameras.main;
    for (let i = 0; i < this.rainSprites.length; i += 1) {
      const sprite = this.rainSprites[i]!;
      const streak = this.rain[i];
      if (!streak) {
        sprite.setVisible(false);
        continue;
      }
      sprite.setVisible(true);
      sprite.setPosition(streak.x * cam.width, streak.y * cam.height);
    }
  }
}

/** A mote pool aging out (no new spawns) once its state is no longer active,
 *  so a shift away from SOLAR_FLARE lets the dust already in flight finish
 *  its life instead of vanishing on the same frame the tint starts fading. */
function ageOutSolarDust(live: readonly SolarDustMote[], deltaMs: number): SolarDustMote[] {
  const next: SolarDustMote[] = [];
  for (const mote of live) {
    const step = Math.min(Math.max(deltaMs, 0), 64);
    const ageMs = mote.ageMs + step;
    if (ageMs < mote.lifeMs) next.push({ ...mote, ageMs, y: mote.y - (1.4 * step) / 1000 });
  }
  return next;
}

/**
 * One rain streak: a short gold-gradient bar, soft at both ends so a fast
 * vertical scroll reads as a line of rain rather than as a falling tile.
 * Baked once per scene, the same "createCanvas, guard on textures.exists,
 * refresh" shape as bakeGodRays/bakeSparkle in stackacres-art.ts.
 */
function bakeRainStreak(scene: Phaser.Scene): string {
  const key = "weatherRainStreak";
  if (scene.textures.exists(key)) return key;
  const w = 6;
  const h = 64;
  const texture = scene.textures.createCanvas(key, w, h);
  if (!texture) return key;
  const c = texture.context;
  const grad = c.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,214,120,0)");
  grad.addColorStop(0.25, "rgba(255,214,120,.55)");
  grad.addColorStop(0.75, "rgba(255,236,190,.55)");
  grad.addColorStop(1, "rgba(255,236,190,0)");
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
  texture.refresh();
  return key;
}
