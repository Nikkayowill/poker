/**
 * FishingGaugeScene: the Phaser side of lib/stackacres/fishing-gauge.ts.
 *
 * The split is the one every StackAcres Phaser module keeps: this file owns
 * GameObjects and holds no opinion about difficulty, drain or darting --
 * every number comes out of the pure module.
 *
 * A SECOND SCENE rather than more methods on TopdownScene
 * (../stackacres-td/scene.ts). The gauge is a modal UI layer: it draws in
 * screen space rather than on the tile grid, it wants its own camera so the
 * farmer's own camera cannot slide it off, and it wants to freeze without the
 * map freezing (the world keeps rendering behind the scrim, crops and animals
 * still moving). Phaser already has exactly that in a parallel scene, so
 * `launchFishingGauge` adds this one over the world scene and stops it again
 * when the fight resolves.
 *
 * INPUT COMES OFF THE HOST ELEMENT, not off Phaser. The game is built with
 * `input: { mouse: false, touch: false, keyboard: false }` (see
 * ../stackacres-td/topdown-world.tsx: the scene reads pointer events off the
 * host itself, and two input layers on one surface double-handle every
 * press), so `this.input` is not a thing here. This scene binds that same
 * host element in the CAPTURE phase and with `stopPropagation`, which is what
 * keeps a press meant for the gauge from also walking the farmer underneath
 * it -- the world's own listeners are bubble-phase, so capture-phase always
 * gets first refusal.
 *
 * FIXED COST: every GameObject is allocated in `create` and reused. The
 * moving parts are two Graphics objects, one static (redrawn only on a
 * resize) and one cleared per frame, which is the same "a frame never makes
 * a game object" rule the rest of this farm's effects follow.
 */

import * as Phaser from "phaser";
import {
  FISH_MARKER_SPAN,
  createFishingGaugeState,
  fishGaugeProfile,
  gaugeOverlap,
  gaugeTension,
  stepFishingGauge,
  type FishingGaugeState,
} from "@/lib/stackacres/fishing-gauge";
import type { FishSpecies } from "@/lib/stackacres/fishing";
import { RAMPS, hex } from "./art-palette";

export const FISHING_GAUGE_SCENE_KEY = "stackacres-fishing";

/** Matches the fallback stacks in game-juice-manager.ts and
 *  frenzy-fx-manager.ts: Baloo 2 is loaded by the route, and the rounded
 *  system faces stand in for it until the swap lands. */
const FALLBACK_FONT_STACK =
  '"Baloo 2", ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", Nunito, system-ui, sans-serif';

/** How long the banner sits on screen after the fight resolves, before the
 *  scene tears itself down. Long enough to read two words. */
const RESOLVE_HOLD_MS = 760;
const ENTRY_MS = 240;
const EXIT_MS = 180;

/** Layout, all in CSS pixels and multiplied by the host's DPR at use --
 *  the canvas is DPR times denser than the screen (again, see
 *  stackacres-world.tsx), so a literal here is a CSS pixel like every
 *  other number a designer would quote. */
const PANEL_W = 96;
const PANEL_PAD = 12;
const PANEL_RADIUS = 18;
const PANEL_INSET_RIGHT = 26;
const TRACK_W = 34;
const TRACK_RADIUS = 14;
const METER_W = 12;
const METER_GAP = 10;
const TITLE_SIZE = 15;
const HINT_SIZE = 13;
const BANNER_SIZE = 26;
const MIN_TRACK_H = 150;
const MAX_TRACK_H = 360;

/** Which colour a species reads as on the track. */
const SPECIES_RAMP: Readonly<Record<FishSpecies, keyof typeof RAMPS>> = {
  bluegill: "water",
  trout: "pine",
  catfish: "hide",
};

const SPECIES_LABEL: Readonly<Record<FishSpecies, string>> = {
  bluegill: "Bluegill",
  trout: "Trout",
  catfish: "Catfish",
};

export interface FishingGaugeSceneOptions {
  /** Which fish is on the line. Drives the whole difficulty curve through
   *  lib/stackacres/fishing-gauge.ts's own profile table. */
  readonly species: FishSpecies;
  /** The element the world scene reads its pointers off. This scene reads
   *  the same one; see this file's header. */
  readonly host: HTMLElement;
  /** Device pixel ratio the canvas was sized at. Pass the same one the world
   *  sized its canvas with so the two layers agree. */
  readonly dpr: number;
  /**
   * Replaces the panel's own "<Species> on the line!" heading.
   *
   * The shell passes a species-free line on purpose: WHICH fish a cast lands
   * is the server's roll inside `catch-fish` (lib/stackacres/fishing.ts), and
   * `species` above only picks how hard the fight is. A heading naming the
   * species would be this layer claiming a catch it does not decide.
   */
  readonly title?: string;
  /** What the hint reads once the fish is landed. Defaults to the species
   *  name, which only a caller that genuinely knows it should take. */
  readonly landedHint?: string;
  readonly reducedMotion?: boolean;
  /** Baloo 2's loaded family name, when the route has it. */
  readonly fontFamily?: string;
  readonly random?: () => number;
}

export interface FishingGaugeSceneCallbacks {
  /** The fish is landed. The shell's cue to POST `catch-fish`, which is
   *  where the species is actually decided -- this scene only says the
   *  player earned one. */
  onLanded?: (species: FishSpecies) => void;
  /** The line went slack: no catch, no cost. */
  onEscaped?: (species: FishSpecies) => void;
  /** Fired once after either outcome, when the scene has stopped. */
  onClosed?: () => void;
}

export class FishingGaugeScene extends Phaser.Scene {
  private readonly options: FishingGaugeSceneOptions;
  private callbacks: FishingGaugeSceneCallbacks;

  private state: FishingGaugeState;
  private holding = false;
  /** Set the moment the fight resolves: `update` stops stepping and the
   *  input handlers stop taking presses, while the exit tweens play. */
  private resolved = false;

  private scrim!: Phaser.GameObjects.Rectangle;
  private root!: Phaser.GameObjects.Container;
  private frame!: Phaser.GameObjects.Graphics;
  private live!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;

  /** Panel geometry in canvas pixels, recomputed by `layout`. Local to the
   *  container, which sits at the panel's centre. */
  private trackH = 0;
  private panelH = 0;
  private scale1 = 1;

  private unbind: (() => void) | null = null;

  constructor(options: FishingGaugeSceneOptions, callbacks: FishingGaugeSceneCallbacks = {}) {
    super({ key: FISHING_GAUGE_SCENE_KEY });
    this.options = options;
    this.callbacks = callbacks;
    this.state = createFishingGaugeState(options.species, options.random ?? Math.random);
  }

  /** Lets the shell swap handlers without rebuilding the scene. */
  setCallbacks(callbacks: FishingGaugeSceneCallbacks): void {
    this.callbacks = callbacks;
  }

  create(): void {
    const px = this.options.dpr;
    this.scale1 = px;

    this.scrim = this.add
      .rectangle(0, 0, 10, 10, hex(RAMPS.iron.rim), 0.52)
      .setOrigin(0, 0)
      .setDepth(0);

    this.root = this.add.container(0, 0).setDepth(1);
    this.frame = this.add.graphics();
    this.live = this.add.graphics();

    const fontFamily = this.options.fontFamily ?? FALLBACK_FONT_STACK;
    this.title = this.add
      .text(0, 0, this.options.title ?? `${SPECIES_LABEL[this.options.species]} on the line!`, {
        fontFamily,
        fontSize: `${TITLE_SIZE * px}px`,
        fontStyle: "800",
        color: RAMPS.chalk.top,
        stroke: RAMPS.iron.rim,
        strokeThickness: 3 * px,
        align: "center",
      })
      .setOrigin(0.5, 1);

    this.hint = this.add
      .text(0, 0, "Hold to lift the net", {
        fontFamily,
        fontSize: `${HINT_SIZE * px}px`,
        fontStyle: "700",
        color: RAMPS.cream.top,
        stroke: RAMPS.iron.rim,
        strokeThickness: 2 * px,
        align: "center",
      })
      .setOrigin(0.5, 0);

    this.banner = this.add
      .text(0, 0, "", {
        fontFamily,
        fontSize: `${BANNER_SIZE * px}px`,
        fontStyle: "800",
        color: RAMPS.gold.top,
        stroke: RAMPS.pine.rim,
        strokeThickness: 5 * px,
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setAlpha(0);

    this.root.add([this.frame, this.live, this.title, this.hint, this.banner]);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.bindInput();

    if (this.options.reducedMotion) {
      this.root.setAlpha(1).setScale(1);
      this.scrim.setAlpha(0.52);
      return;
    }
    this.root.setAlpha(0).setScale(0.88);
    this.scrim.setAlpha(0);
    this.tweens.add({ targets: this.scrim, alpha: 0.52, duration: ENTRY_MS, ease: "Sine.easeOut" });
    this.tweens.add({
      targets: this.root,
      alpha: 1,
      scale: 1,
      duration: ENTRY_MS,
      ease: "Back.easeOut",
    });
  }

  /** Sizes the panel to the current canvas and redraws the static frame.
   *  Called once from `create` and again on every resize. */
  private layout(): void {
    const px = this.scale1;
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;

    this.scrim.setSize(width, height).setPosition(0, 0);

    this.trackH = Phaser.Math.Clamp(height * 0.58, MIN_TRACK_H * px, MAX_TRACK_H * px);
    const titleBlock = (TITLE_SIZE + HINT_SIZE + PANEL_PAD * 2) * px;
    this.panelH = this.trackH + titleBlock + PANEL_PAD * 2 * px;
    const panelW = PANEL_W * px;

    this.root.setPosition(width - panelW / 2 - PANEL_INSET_RIGHT * px, height / 2);

    const top = -this.panelH / 2;
    this.title.setPosition(0, top + (PANEL_PAD + TITLE_SIZE) * px);
    this.hint.setPosition(0, this.panelH / 2 - (PANEL_PAD + HINT_SIZE) * px);
    this.banner.setPosition(0, 0);
    this.banner.setWordWrapWidth(panelW * 2.4);
    this.title.setWordWrapWidth(panelW * 1.9);
    this.hint.setWordWrapWidth(panelW * 1.9);

    this.drawFrame(panelW);
  }

  /** The parts that never move: panel plate, track well, meter well. */
  private drawFrame(panelW: number): void {
    const px = this.scale1;
    const g = this.frame;
    g.clear();

    g.fillStyle(hex(RAMPS.wood.rim), 0.92);
    g.fillRoundedRect(-panelW / 2, -this.panelH / 2, panelW, this.panelH, PANEL_RADIUS * px);
    g.lineStyle(3 * px, hex(RAMPS.wood.top), 0.85);
    g.strokeRoundedRect(-panelW / 2, -this.panelH / 2, panelW, this.panelH, PANEL_RADIUS * px);

    const trackW = TRACK_W * px;
    g.fillStyle(hex(RAMPS.water.rim), 0.95);
    g.fillRoundedRect(this.trackX() - trackW / 2, -this.trackH / 2, trackW, this.trackH, TRACK_RADIUS * px);
    g.lineStyle(2 * px, hex(RAMPS.water.side), 0.9);
    g.strokeRoundedRect(this.trackX() - trackW / 2, -this.trackH / 2, trackW, this.trackH, TRACK_RADIUS * px);

    const meterW = METER_W * px;
    g.fillStyle(hex(RAMPS.iron.rim), 0.9);
    g.fillRoundedRect(this.meterX() - meterW / 2, -this.trackH / 2, meterW, this.trackH, meterW / 2);
  }

  /** Track centre and meter centre, both local to the container. The track
   *  sits right of centre so the meter has room on its left. */
  private trackX(): number {
    return (METER_W + METER_GAP) * this.scale1 * 0.5;
  }

  private meterX(): number {
    return this.trackX() - (TRACK_W / 2 + METER_GAP + METER_W / 2) * this.scale1;
  }

  /** Canvas y of a normalised track position's bottom edge. 0 is the bottom
   *  of the well, 1 the top -- the pure module's own convention. */
  private yFor(pos: number): number {
    return this.trackH / 2 - pos * this.trackH;
  }

  override update(_time: number, delta: number): void {
    if (!this.resolved) {
      this.state = stepFishingGauge(this.state, delta, this.holding, this.options.random ?? Math.random);
      if (this.state.phase !== "playing") this.resolve(this.state.phase);
    }
    this.draw();
  }

  /** Bar, fish and meter, cleared and redrawn every frame. */
  private draw(): void {
    const px = this.scale1;
    const profile = fishGaugeProfile(this.state.species);
    const overlap = gaugeOverlap(this.state);
    const tension = gaugeTension(this.state);
    const g = this.live;
    g.clear();

    // Capture bar. It greens up and gains a rim the instant it is actually
    // covering the fish, which is the only feedback in here that teaches
    // the rule.
    const trackW = TRACK_W * px;
    const barH = profile.barSpan * this.trackH;
    const barTop = this.yFor(this.state.barPos + profile.barSpan);
    const barColour = overlap > 0 ? hex(RAMPS.grass.top) : hex(RAMPS.gold.side);
    g.fillStyle(barColour, overlap > 0 ? 0.55 : 0.38);
    g.fillRoundedRect(this.trackX() - trackW / 2 + 2 * px, barTop, trackW - 4 * px, barH, 10 * px);
    g.lineStyle(3 * px, overlap > 0 ? hex(RAMPS.chalk.top) : hex(RAMPS.gold.top), 0.95);
    g.strokeRoundedRect(this.trackX() - trackW / 2 + 2 * px, barTop, trackW - 4 * px, barH, 10 * px);

    // The fish. Drawn as a body plus a tail wedge so it reads as facing the
    // way it is swimming, which is the cheapest possible tell for where it
    // is about to go.
    const fishH = FISH_MARKER_SPAN * this.trackH;
    const fishCy = this.yFor(this.state.fishPos) - fishH / 2;
    const ramp = RAMPS[SPECIES_RAMP[this.state.species]];
    const fishR = Math.min(fishH / 2, trackW / 2 - 4 * px);
    g.fillStyle(hex(ramp.top), 1);
    g.fillCircle(this.trackX(), fishCy, fishR);
    g.lineStyle(2 * px, hex(ramp.rim), 1);
    g.strokeCircle(this.trackX(), fishCy, fishR);
    const swimmingUp = this.state.fishTarget >= this.state.fishPos;
    const tailY = fishCy + (swimmingUp ? fishR * 1.6 : -fishR * 1.6);
    g.fillStyle(hex(ramp.side), 1);
    g.fillTriangle(
      this.trackX() - fishR * 0.7,
      fishCy + (swimmingUp ? fishR * 0.5 : -fishR * 0.5),
      this.trackX() + fishR * 0.7,
      fishCy + (swimmingUp ? fishR * 0.5 : -fishR * 0.5),
      this.trackX(),
      tailY,
    );

    // Progress meter: green while the catch is on, red once the line is
    // closer to slack than it started.
    const meterW = METER_W * px;
    const fillH = this.state.progress * this.trackH;
    const meterColour = tension > 0.45 ? hex(RAMPS.roof.top) : hex(RAMPS.grass.top);
    g.fillStyle(meterColour, 0.95);
    g.fillRoundedRect(this.meterX() - meterW / 2, this.trackH / 2 - fillH, meterW, fillH, meterW / 2);
  }

  /** One-way door: freeze, show the outcome, tear down. */
  private resolve(phase: "landed" | "escaped"): void {
    if (this.resolved) return;
    this.resolved = true;
    this.holding = false;

    const landed = phase === "landed";
    this.banner.setText(landed ? "Landed!" : "It got away");
    this.banner.setColor(landed ? RAMPS.gold.top : RAMPS.cream.top);
    this.hint.setText(
      landed ? (this.options.landedHint ?? SPECIES_LABEL[this.state.species]) : "Try another cast",
    );

    if (landed) this.callbacks.onLanded?.(this.state.species);
    else this.callbacks.onEscaped?.(this.state.species);

    if (this.options.reducedMotion) {
      this.banner.setAlpha(1).setScale(1);
      this.time.delayedCall(RESOLVE_HOLD_MS, () => this.close());
      return;
    }

    if (landed) {
      const gold = hex(RAMPS.gold.top);
      this.cameras.main.flash(180, (gold >> 16) & 255, (gold >> 8) & 255, gold & 255, false);
    } else {
      this.cameras.main.shake(180, 0.006);
    }
    this.banner.setAlpha(0).setScale(0.4);
    this.tweens.chain({
      targets: this.banner,
      tweens: [
        { alpha: 1, scale: 1.18, duration: 180, ease: "Back.easeOut" },
        { scale: 1, duration: 120, ease: "Sine.easeInOut" },
        { alpha: 0, duration: 220, delay: RESOLVE_HOLD_MS, ease: "Sine.easeIn" },
      ],
      onComplete: () => this.close(),
    });
    this.tweens.add({
      targets: this.root,
      alpha: 0,
      scale: 0.94,
      duration: EXIT_MS,
      delay: RESOLVE_HOLD_MS,
      ease: "Sine.easeIn",
    });
    this.tweens.add({
      targets: this.scrim,
      alpha: 0,
      duration: EXIT_MS,
      delay: RESOLVE_HOLD_MS,
      ease: "Sine.easeIn",
    });
  }

  private close(): void {
    const done = this.callbacks.onClosed;
    this.scene.stop();
    done?.();
  }

  /**
   * Gives the fight up as a loss. The shell calls this when the player
   * closes the overlay some other way (a back press, a route change) so the
   * hook always ends in one of the two outcomes the pure module defines,
   * never in a scene that is still running with nobody watching.
   */
  giveUp(): void {
    if (this.resolved) return;
    this.state = { ...this.state, phase: "escaped", progress: 0 };
    this.resolve("escaped");
  }

  /** Press and release, exposed so the shell's own gesture layer or a test
   *  can drive the bar without a real pointer. */
  hold(): void {
    if (!this.resolved) this.holding = true;
  }

  release(): void {
    this.holding = false;
  }

  /**
   * Host pointers and keys, capture-phase so the world scene's bubble-phase
   * listeners never see a press meant for the gauge. Releases are taken off
   * `window` as well: a finger that slides off the canvas mid-fight must
   * still count as letting go, or the bar sticks to the ceiling.
   */
  private bindInput(): void {
    const host = this.options.host;
    const down = (event: PointerEvent): void => {
      if (this.resolved) return;
      event.stopPropagation();
      event.preventDefault();
      this.holding = true;
    };
    const up = (event: PointerEvent): void => {
      event.stopPropagation();
      this.holding = false;
    };
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        this.giveUp();
        return;
      }
      if (event.key !== " " && event.key !== "Enter" && event.key !== "ArrowUp") return;
      event.preventDefault();
      if (!this.resolved) this.holding = true;
    };
    const keyUp = (event: KeyboardEvent): void => {
      if (event.key !== " " && event.key !== "Enter" && event.key !== "ArrowUp") return;
      this.holding = false;
    };
    const blur = (): void => {
      this.holding = false;
    };

    host.addEventListener("pointerdown", down, { capture: true, passive: false });
    host.addEventListener("pointerup", up, { capture: true });
    host.addEventListener("pointercancel", up, { capture: true });
    window.addEventListener("pointerup", blur);
    window.addEventListener("keydown", keyDown, { passive: false });
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);

    this.unbind = () => {
      host.removeEventListener("pointerdown", down, { capture: true });
      host.removeEventListener("pointerup", up, { capture: true });
      host.removeEventListener("pointercancel", up, { capture: true });
      window.removeEventListener("pointerup", blur);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.teardown, this);
  }

  private teardown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.unbind?.();
    this.unbind = null;
  }
}

/**
 * Adds the gauge over a running StackAcres game and starts it. One call is
 * the whole integration: the world scene keeps rendering and keeps its own
 * state, and this scene removes itself on either outcome.
 *
 * Re-launching while one is already up replaces it, so a double tap on the
 * dock cannot leave two gauges stacked on the same canvas.
 */
export function launchFishingGauge(
  game: Phaser.Game,
  options: FishingGaugeSceneOptions,
  callbacks: FishingGaugeSceneCallbacks = {},
): FishingGaugeScene {
  const existing = game.scene.getScene(FISHING_GAUGE_SCENE_KEY);
  if (existing) game.scene.remove(FISHING_GAUGE_SCENE_KEY);
  const scene = new FishingGaugeScene(options, callbacks);
  game.scene.add(FISHING_GAUGE_SCENE_KEY, scene, true);
  return scene;
}
