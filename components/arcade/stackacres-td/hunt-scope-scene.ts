/**
 * HuntScopeScene: the Phaser side of lib/stackacres/hunt-proximity.ts.
 *
 * Same split, and the same reason for it, FishingGaugeScene's own header
 * states: this file owns GameObjects and holds no opinion about wariness
 * rate, focus range or alert -- every number comes out of the pure module.
 *
 * NO LONGER A MODAL. The previous shape of this file was a full-screen
 * scrim over an isolated patch: a lens dragged across fenced-off brush, with
 * a crosshair, a lock ring and a vector aiming line. Stalking is now a
 * proximity game played directly on the open world -- the farmer walks
 * there with the joystick like anywhere else on the map -- so this scene
 * owns nothing but a small floating overhead gauge that tracks the animal's
 * own screen position, plus a Use prompt when the player is close enough to
 * try. There is no lens shader, no aiming line, no viewport transform: the
 * world scene keeps drawing the whole map underneath exactly as it always
 * does, and this one just paints a HUD marker on top of it.
 *
 * A SECOND SCENE rather than a manager on TopdownScene, for the same reason
 * the fishing gauge is one: it wants its own camera so the gauge sits fixed
 * in screen space above whatever's animal position, not sliding around with
 * a world-scene shake, and it wants to be added and torn down without the
 * world scene ever knowing this feature exists. `launchHuntScope` adds it
 * over the world scene and stops it again when the stalk resolves.
 *
 * INPUT: the Use press is still driven by topdown-world.tsx's own Use key
 * (see its `onUseHeld`), because the farmer needs the SAME key to work the
 * ground everywhere else on the map -- there is no separate button to
 * capture here. This scene therefore takes no pointer or keyboard input of
 * its own; `attemptCatch()` is a plain method the shell calls, matching the
 * capture-phase-off-the-host convention only for completeness (Escape still
 * gives the stalk up), the same way FishingGaugeScene binds Escape without
 * needing every other key.
 *
 * FIXED COST: every GameObject is allocated in `create` and reused; nothing
 * here allocates per frame.
 */

import * as Phaser from "phaser";
import {
  abandonStalk,
  attemptCatch,
  createHuntProximityState,
  inFocusRange,
  markDistance,
  stalkAlarm,
  stepHuntProximity,
  type HuntProximityState,
} from "@/lib/stackacres/hunt-proximity";
import type { HuntingWeapon, QuarrySpecies } from "@/lib/stackacres/hunting";
import type { WorldPoint } from "@/lib/stackacres/world";
import { RAMPS, hex } from "../stackacres/art-palette";

export const HUNT_SCOPE_SCENE_KEY = "stackacres-hunt-scope";

/** Matches the fallback stacks in fishing-gauge-scene.ts and
 *  game-juice-manager.ts: Baloo 2 is loaded by the route, and the rounded
 *  system faces stand in for it until the swap lands. */
const FALLBACK_FONT_STACK =
  '"Baloo 2", ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", Nunito, system-ui, sans-serif';

/** How long the banner sits on screen after the stalk resolves, before the
 *  scene tears itself down. Long enough to read two words. */
const RESOLVE_HOLD_MS = 820;
const EXIT_MS = 190;

/** Layout, in CSS pixels multiplied by the host's DPR at use -- the canvas
 *  is DPR times denser than the screen (see topdown-world.tsx), so a
 *  literal here is a CSS pixel like every other number a designer would
 *  quote. */
const GAUGE_WIDTH = 74;
const GAUGE_HEIGHT = 8;
const GAUGE_LIFT = 46;
const HINT_SIZE = 13;
const BANNER_SIZE = 26;
const PROMPT_SIZE = 15;

export interface HuntScopeSceneOptions {
  /** Picks the difficulty profile the stalk plays at, and nothing else --
   *  see lib/stackacres/hunt-proximity.ts's own header. */
  readonly species: QuarrySpecies;
  readonly weapon: HuntingWeapon;
  readonly dpr: number;
  readonly reducedMotion?: boolean;
  /** Baloo 2's loaded family name, when the route has it. */
  readonly fontFamily?: string;
  readonly baggedHint?: string;
  readonly random?: () => number;
  /** Where the farmer really is right now, in world units. Read every
   *  frame -- TopdownScene.farmerPoint() -- so the joystick keeps driving
   *  him toward the quarry while the stalk runs. */
  readonly getPlayerWorld: () => WorldPoint;
  /** A world point projected to CSS pixels relative to the canvas host --
   *  TopdownScene.screenPoint(), the same conversion every other DOM/HUD
   *  overlay on this screen already uses. */
  readonly worldToScreen: (point: WorldPoint) => { x: number; y: number };
}

export interface HuntScopeSceneCallbacks {
  /** The animal is taken. The shell's cue to POST `bag-quarry`, which is
   *  where the quarry is actually decided -- this scene only says the player
   *  earned one. */
  onBagged?: () => void;
  /** It was startled off, or the player walked away: no catch, no cost. */
  onLost?: () => void;
  /** Fired once after either outcome, when the scene has stopped. */
  onClosed?: () => void;
}

export class HuntScopeScene extends Phaser.Scene {
  private readonly options: HuntScopeSceneOptions;
  private callbacks: HuntScopeSceneCallbacks;

  private state: HuntProximityState;
  /** Set the moment the stalk resolves: `update` stops stepping, while the
   *  exit tween plays. */
  private resolved = false;

  private root!: Phaser.GameObjects.Container;
  private gaugeTrack!: Phaser.GameObjects.Graphics;
  private gaugeFill!: Phaser.GameObjects.Graphics;
  private hint!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;

  constructor(options: HuntScopeSceneOptions, callbacks: HuntScopeSceneCallbacks = {}) {
    super({ key: HUNT_SCOPE_SCENE_KEY });
    this.options = options;
    this.callbacks = callbacks;
    const player = options.getPlayerWorld();
    this.state = createHuntProximityState(
      options.species,
      options.weapon,
      player,
      options.random ?? Math.random,
    );
  }

  /** Lets the shell swap handlers without rebuilding the scene. */
  setCallbacks(callbacks: HuntScopeSceneCallbacks): void {
    this.callbacks = callbacks;
  }

  create(): void {
    const px = this.options.dpr;
    const fontFamily = this.options.fontFamily ?? FALLBACK_FONT_STACK;

    this.root = this.add.container(0, 0).setDepth(1).setVisible(false);
    this.gaugeTrack = this.add.graphics();
    this.gaugeFill = this.add.graphics();

    this.hint = this.add
      .text(0, -GAUGE_HEIGHT * px - 6 * px, "Something's moving nearby", {
        fontFamily,
        fontSize: `${HINT_SIZE * px}px`,
        fontStyle: "700",
        color: RAMPS.cream.top,
        stroke: RAMPS.iron.rim,
        strokeThickness: 2 * px,
        align: "center",
      })
      .setOrigin(0.5, 1);

    this.prompt = this.add
      .text(0, (GAUGE_HEIGHT + 8) * px, "Press Use", {
        fontFamily,
        fontSize: `${PROMPT_SIZE * px}px`,
        fontStyle: "800",
        color: RAMPS.gold.top,
        stroke: RAMPS.iron.rim,
        strokeThickness: 3 * px,
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setAlpha(0);

    this.banner = this.add
      .text(0, -40 * px, "", {
        fontFamily,
        fontSize: `${BANNER_SIZE * px}px`,
        fontStyle: "800",
        color: RAMPS.gold.top,
        stroke: RAMPS.pine.rim,
        strokeThickness: 5 * px,
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setAlpha(0);

    this.root.add([this.gaugeTrack, this.gaugeFill, this.hint, this.prompt, this.banner]);
  }

  override update(_time: number, delta: number): void {
    if (!this.resolved) {
      const player = this.options.getPlayerWorld();
      const wasInRange = this.state.phase === "inRange";
      this.state = stepHuntProximity(this.state, delta, player, this.options.random ?? Math.random);
      if (this.state.phase === "fled") {
        this.resolve("fled");
        return;
      }
      if (this.state.phase === "inRange" && !wasInRange && !this.options.reducedMotion) {
        this.tweens.add({ targets: this.prompt, alpha: 1, duration: 140, ease: "Sine.easeOut" });
      } else if (this.state.phase !== "inRange" && wasInRange) {
        this.prompt.setAlpha(0);
      } else if (this.options.reducedMotion) {
        this.prompt.setAlpha(this.state.phase === "inRange" ? 1 : 0);
      }
    }
    this.draw();
  }

  private draw(): void {
    const px = this.options.dpr;
    const anchor = this.options.worldToScreen(this.state.quarry);
    this.root.setPosition(anchor.x * px, (anchor.y - GAUGE_LIFT) * px).setVisible(true);

    const half = (GAUGE_WIDTH * px) / 2;
    const alarm = stalkAlarm(this.state);
    const inRange = this.state.phase === "inRange" || inFocusRange(this.state);

    this.gaugeTrack.clear();
    this.gaugeTrack.fillStyle(hex(RAMPS.iron.rim), 0.9);
    this.gaugeTrack.fillRoundedRect(-half, 0, GAUGE_WIDTH * px, GAUGE_HEIGHT * px, (GAUGE_HEIGHT * px) / 2);
    this.gaugeTrack.lineStyle(2 * px, hex(RAMPS.iron.top), inRange ? 1 : 0.55);
    this.gaugeTrack.strokeRoundedRect(-half, 0, GAUGE_WIDTH * px, GAUGE_HEIGHT * px, (GAUGE_HEIGHT * px) / 2);

    this.gaugeFill.clear();
    const fillColour = alarm > 0.6 ? hex(RAMPS.roof.top) : hex(RAMPS.straw.top);
    this.gaugeFill.fillStyle(fillColour, 0.95);
    this.gaugeFill.fillRoundedRect(
      -half,
      0,
      GAUGE_WIDTH * px * alarm,
      GAUGE_HEIGHT * px,
      (GAUGE_HEIGHT * px) / 2,
    );

    this.hint.setText(inRange ? "Close enough -- take the shot" : "Get closer, and stay steady");
  }

  /** One-way door: freeze, show the outcome, tear down. */
  private resolve(phase: "bagged" | "fled"): void {
    if (this.resolved) return;
    this.resolved = true;

    const bagged = phase === "bagged";
    this.banner.setText(bagged ? "Snapshot captured!" : "It got startled off");
    this.banner.setColor(bagged ? RAMPS.gold.top : RAMPS.cream.top);
    this.hint.setText(bagged ? (this.options.baggedHint ?? "Back to the farm") : "Try another trail");
    this.prompt.setAlpha(0);

    if (bagged) this.callbacks.onBagged?.();
    else this.callbacks.onLost?.();

    if (this.options.reducedMotion) {
      this.banner.setAlpha(1).setScale(1);
      this.time.delayedCall(RESOLVE_HOLD_MS, () => this.close());
      return;
    }

    if (bagged) this.flashCamera();
    else this.cameras.main.shake(200, 0.004);
    this.banner.setAlpha(0).setScale(0.4);
    this.tweens.chain({
      targets: this.banner,
      tweens: [
        { alpha: 1, scale: 1.18, duration: 190, ease: "Back.easeOut" },
        { scale: 1, duration: 120, ease: "Sine.easeInOut" },
        { alpha: 0, duration: 220, delay: RESOLVE_HOLD_MS, ease: "Sine.easeIn" },
      ],
      onComplete: () => this.close(),
    });
    this.tweens.add({
      targets: this.root,
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
   * The shutter: a short, bright white screen flash for a captured
   * snapshot, in place of any weapon-discharge cue. Plain white rather than
   * a tinted colour -- it is meant to read as a camera flash, not a magic
   * effect -- and short enough (140ms) that it lands as a snap, not a wash.
   */
  private flashCamera(): void {
    this.cameras.main.flash(140, 255, 255, 255, false);
  }

  /**
   * Attempts a catch, if the player is close enough. This is what the Use
   * key is wired to while a stalk is up -- see topdown-world.tsx's
   * `onUseHeld`. Pressing it out of range is a deliberate no-op rather than
   * a miss (the pure module's own rule), so a player closing in cannot lose
   * a stalk to an early press.
   */
  attemptCatch(): void {
    if (this.resolved) return;
    const taken = attemptCatch(this.state);
    if (taken === this.state) return;
    this.state = taken;
    this.resolve("bagged");
  }

  /**
   * Gives the stalk up as a loss. The shell calls this when the player
   * leaves the encounter some other way (a menu, a route change, walking
   * far enough that the shell decides to end it) so a stalk always ends in
   * one of the two outcomes this module defines, never in a scene still
   * running with nobody watching.
   */
  giveUp(): void {
    if (this.resolved) return;
    this.state = abandonStalk(this.state);
    this.resolve("fled");
  }

  /** How far the player currently is from the quarry, in world units --
   *  exposed so the shell can decide when a wandered-off player should have
   *  their stalk auto-abandoned rather than left running forever. */
  distanceToQuarry(): number {
    return markDistance(this.state);
  }
}

/**
 * Adds the scope over a running StackAcres game and starts it. One call is
 * the whole integration: the world scene keeps rendering, keeps driving the
 * farmer off the joystick, and this scene removes itself on either outcome.
 *
 * Re-launching while one is already up replaces it, so tapping into a
 * second encounter cannot leave two gauges stacked on the same canvas.
 */
export function launchHuntScope(
  game: Phaser.Game,
  options: HuntScopeSceneOptions,
  callbacks: HuntScopeSceneCallbacks = {},
): HuntScopeScene {
  const existing = game.scene.getScene(HUNT_SCOPE_SCENE_KEY);
  if (existing) game.scene.remove(HUNT_SCOPE_SCENE_KEY);
  const scene = new HuntScopeScene(options, callbacks);
  game.scene.add(HUNT_SCOPE_SCENE_KEY, scene, true);
  return scene;
}
