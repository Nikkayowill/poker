/**
 * HuntScopeScene: the Phaser side of lib/stackacres/hunt-scope.ts.
 *
 * Same split, and the same reason for it, as FishingGaugeScene's own header
 * states: this file owns GameObjects and holds no opinion about difficulty,
 * lock rate or spooking -- every number comes out of the pure module.
 *
 * A SECOND SCENE rather than a manager on TopdownScene, for the reasons the
 * fishing gauge already set out: the scope is a modal UI layer, it draws in
 * screen space, it wants its own camera so a world pan cannot slide it off,
 * and it wants to freeze without the world scene freezing. `launchHuntScope`
 * adds this one over the world scene and stops it again when the stalk
 * resolves.
 *
 * WHAT THE PLAYER ACTUALLY SEES. The brush is drawn twice. The bottom copy
 * is dim and holds no animal at all; the top copy is lit, holds the animal,
 * and is masked to the lens circle. So the animal is only ever visible
 * through the glass, and finding it is a real part of the stalk rather than
 * a formality. Dragging pans the lens RELATIVELY, never jumping it to the
 * finger -- an absolute jump would register as an enormous lens speed and
 * spook the animal for a tap the player never meant as a movement.
 *
 * INPUT COMES OFF THE HOST ELEMENT, not off Phaser, for the reason
 * topdown-world.tsx gives: the game is built with `input: { mouse: false,
 * touch: false, keyboard: false }`, so `this.input` is not a thing here.
 * This scene binds the same host element the world scene reads, in the
 * CAPTURE phase and with `stopPropagation`, which is what keeps a press
 * meant for the scope from also panning the map underneath it.
 *
 * FIXED COST: every GameObject is allocated in `create` and reused. The
 * brush tufts are a plain array of numbers rolled once, not objects, and the
 * moving parts are four Graphics -- one static, three cleared per frame --
 * which is the same "a frame never makes a game object" rule the fishing
 * gauge and the weather dust pools already follow.
 */

import * as Phaser from "phaser";
import {
  QUARRY_RADIUS,
  abandonStalk,
  createHuntScopeState,
  huntWeaponProfile,
  markHold,
  stalkAlarm,
  stepHuntScope,
  takeMark,
  type HuntScopeState,
  type ScopePoint,
} from "@/lib/stackacres/hunt-scope";
import type { HuntingWeapon, QuarrySpecies } from "@/lib/stackacres/hunting";
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
const ENTRY_MS = 260;
const EXIT_MS = 190;

/** Layout, all in CSS pixels and multiplied by the host's DPR at use -- the
 *  canvas is DPR times denser than the screen (see topdown-world.tsx), so a
 *  literal here is a CSS pixel like every other number a designer would
 *  quote. */
const FIELD_INSET = 22;
const FIELD_RADIUS = 20;
const FIELD_MAX_W = 520;
const FIELD_MAX_H = 380;
const TITLE_SIZE = 16;
const HINT_SIZE = 13;
const BANNER_SIZE = 28;
const ALARM_H = 9;
const ALARM_GAP = 10;

/** How many tufts of brush the field is stippled with. Rolled once from a
 *  fixed seed so the patch looks the same for the whole stalk. */
const TUFT_COUNT = 90;

/** Drag distance in CSS pixels past which a press counts as a pan rather
 *  than a press meant for the Use action. */
const DRAG_SLOP = 6;

interface Tuft {
  /** Patch fractions, the same 0..1 space the pure module uses. */
  x: number;
  y: number;
  scale: number;
  lean: number;
}

export interface HuntScopeSceneOptions {
  /** Picks the difficulty profile the stalk plays at, and nothing else --
   *  see lib/stackacres/hunt-scope.ts's own header. */
  readonly species: QuarrySpecies;
  readonly weapon: HuntingWeapon;
  /** The element the world scene reads its pointers off. This scene reads
   *  the same one; see this file's header. */
  readonly host: HTMLElement;
  /** Device pixel ratio the canvas was sized at. Pass the same `canvasDpr()`
   *  topdown-world.tsx uses so the two layers agree. */
  readonly dpr: number;
  readonly reducedMotion?: boolean;
  /** Baloo 2's loaded family name, when the route has it. */
  readonly fontFamily?: string;
  readonly title?: string;
  readonly baggedHint?: string;
  readonly random?: () => number;
}

export interface HuntScopeSceneCallbacks {
  /** The animal is taken. The shell's cue to POST `bag-quarry`, which is
   *  where the quarry is actually decided -- this scene only says the player
   *  earned one. */
  onBagged?: () => void;
  /** It bolted, or the player walked away: no catch, no cost. */
  onLost?: () => void;
  /** Fired once after either outcome, when the scene has stopped. */
  onClosed?: () => void;
}

export class HuntScopeScene extends Phaser.Scene {
  private readonly options: HuntScopeSceneOptions;
  private callbacks: HuntScopeSceneCallbacks;

  private state: HuntScopeState;
  /** Where the player's drag has put the lens, in patch fractions. Kept
   *  separately from `state.lens` because the pure module clamps and the
   *  pointer does not. */
  private lens: ScopePoint = { x: 0.5, y: 0.5 };
  /** Set the moment the stalk resolves: `update` stops stepping and the
   *  input handlers stop taking presses, while the exit tweens play. */
  private resolved = false;

  private scrim!: Phaser.GameObjects.Rectangle;
  private root!: Phaser.GameObjects.Container;
  /** The dim brush, with no animal in it. Redrawn only on a resize. */
  private field!: Phaser.GameObjects.Graphics;
  /** The lit brush and the animal, masked to the lens. Cleared per frame. */
  private lit!: Phaser.GameObjects.Graphics;
  /** The circle that masks `lit`. Never rendered itself. */
  private lensMask!: Phaser.GameObjects.Graphics;
  /** Lens rim, lock ring, crosshair, alarm bar. Cleared per frame. */
  private hud!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;

  private tufts: Tuft[] = [];

  /** Field geometry in canvas pixels, recomputed by `layout`. Local to the
   *  container, which sits at the field's centre. */
  private fieldW = 0;
  private fieldH = 0;
  private scale1 = 1;

  /** Live drag: whether a press is down, where it last was in CSS pixels,
   *  and whether it has travelled far enough to count as a pan. */
  private dragging = false;
  private lastPointer: { x: number; y: number } | null = null;
  private dragMoved = false;

  private unbind: (() => void) | null = null;

  constructor(options: HuntScopeSceneOptions, callbacks: HuntScopeSceneCallbacks = {}) {
    super({ key: HUNT_SCOPE_SCENE_KEY });
    this.options = options;
    this.callbacks = callbacks;
    this.state = createHuntScopeState(options.species, options.weapon, options.random ?? Math.random);
    this.lens = this.state.lens;
  }

  /** Lets the shell swap handlers without rebuilding the scene. */
  setCallbacks(callbacks: HuntScopeSceneCallbacks): void {
    this.callbacks = callbacks;
  }

  create(): void {
    const px = this.options.dpr;
    this.scale1 = px;
    this.rollTufts();

    this.scrim = this.add
      .rectangle(0, 0, 10, 10, hex(RAMPS.iron.rim), 0.62)
      .setOrigin(0, 0)
      .setDepth(0);

    this.root = this.add.container(0, 0).setDepth(1);
    this.field = this.add.graphics();
    this.lit = this.add.graphics();
    this.hud = this.add.graphics();

    // The mask lives outside the container on purpose: a GeometryMask reads
    // world coordinates, so it must not inherit the container's own offset.
    this.lensMask = this.add.graphics().setVisible(false);
    this.lit.setMask(this.lensMask.createGeometryMask());

    const fontFamily = this.options.fontFamily ?? FALLBACK_FONT_STACK;
    this.title = this.add
      .text(0, 0, this.options.title ?? "Something's moving in the brush", {
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
      .text(0, 0, "Drag to look. Hold still when it stops.", {
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

    this.root.add([this.field, this.lit, this.hud, this.title, this.hint, this.banner]);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.bindInput();

    if (this.options.reducedMotion) {
      this.root.setAlpha(1).setScale(1);
      this.scrim.setAlpha(0.62);
      return;
    }
    this.root.setAlpha(0).setScale(0.9);
    this.scrim.setAlpha(0);
    this.tweens.add({ targets: this.scrim, alpha: 0.62, duration: ENTRY_MS, ease: "Sine.easeOut" });
    this.tweens.add({
      targets: this.root,
      alpha: 1,
      scale: 1,
      duration: ENTRY_MS,
      ease: "Back.easeOut",
    });
  }

  /** The brush stipple, rolled once from a fixed seed so the patch holds
   *  still for the whole stalk. Plain numbers, never GameObjects. */
  private rollTufts(): void {
    // Its own small generator rather than the gameplay RNG: this is
    // decoration, and pulling from the same stream would shift the stalk
    // itself if the tuft count were ever changed.
    let seed = 0x9e3779b9;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    this.tufts = Array.from({ length: TUFT_COUNT }, () => ({
      x: next(),
      y: next(),
      scale: 0.6 + next() * 0.8,
      lean: (next() - 0.5) * 0.9,
    }));
  }

  /** Sizes the field to the current canvas and redraws the dim copy. Called
   *  once from `create` and again on every resize. */
  private layout(): void {
    const px = this.scale1;
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;

    this.scrim.setSize(width, height).setPosition(0, 0);

    const inset = FIELD_INSET * px;
    this.fieldW = Math.min(width - inset * 2, FIELD_MAX_W * px);
    this.fieldH = Math.min(height - inset * 2 - (TITLE_SIZE + HINT_SIZE + 40) * px, FIELD_MAX_H * px);
    this.root.setPosition(width / 2, height / 2);

    const top = -this.fieldH / 2;
    this.title.setPosition(0, top - (HINT_SIZE + 6) * px);
    this.hint.setPosition(0, this.fieldH / 2 + 8 * px);
    this.banner.setPosition(0, 0);
    this.title.setWordWrapWidth(this.fieldW);
    this.hint.setWordWrapWidth(this.fieldW);
    this.banner.setWordWrapWidth(this.fieldW);

    this.drawField();
  }

  /** The dim copy: the brush as it looks to the naked eye, with nothing
   *  living in it. Static, so this runs on a resize and never per frame. */
  private drawField(): void {
    const px = this.scale1;
    const g = this.field;
    const w = this.fieldW;
    const h = this.fieldH;
    g.clear();

    g.fillStyle(hex(RAMPS.pine.rim), 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, FIELD_RADIUS * px);
    g.lineStyle(3 * px, hex(RAMPS.wood.rim), 0.9);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, FIELD_RADIUS * px);

    for (const tuft of this.tufts) {
      this.drawTuft(g, tuft, hex(RAMPS.pine.side), 0.85);
    }

    // Everything the lens is NOT over gets pushed down, so the lit circle
    // reads as a light being shone rather than a slightly different green.
    // Drawn into the static copy, under `lit`, so the lens punches through it.
    g.fillStyle(0x000000, 0.34);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, FIELD_RADIUS * px);
  }

  /** One tuft of grass, as a short leaning blade. Shared by both copies so
   *  the lit brush lines up exactly with the dim one under it. */
  private drawTuft(g: Phaser.GameObjects.Graphics, tuft: Tuft, colour: number, alpha: number): void {
    const px = this.scale1;
    const x = (tuft.x - 0.5) * this.fieldW;
    const y = (tuft.y - 0.5) * this.fieldH;
    const tall = 9 * px * tuft.scale;
    g.lineStyle(2 * px * tuft.scale, colour, alpha);
    g.beginPath();
    g.moveTo(x, y + tall / 2);
    g.lineTo(x + tuft.lean * tall * 0.5, y - tall / 2);
    g.strokePath();
  }

  /** Patch fractions to canvas pixels, local to the container. */
  private atX(fx: number): number {
    return (fx - 0.5) * this.fieldW;
  }

  private atY(fy: number): number {
    return (fy - 0.5) * this.fieldH;
  }

  /** The lens radius in canvas pixels. The patch is not square, so the lens
   *  is sized off the smaller axis and stays a circle. */
  private lensPx(): number {
    return huntWeaponProfile(this.state.weapon).lensRadius * Math.min(this.fieldW, this.fieldH);
  }

  override update(_time: number, delta: number): void {
    if (!this.resolved) {
      this.state = stepHuntScope(this.state, delta, this.lens, this.options.random ?? Math.random);
      this.lens = this.state.lens;
      if (this.state.phase === "fled") this.resolve("fled");
    }
    this.draw();
  }

  private draw(): void {
    const px = this.scale1;
    const alarm = stalkAlarm(this.state);
    const locked = this.state.phase === "locked";
    const cx = this.atX(this.state.lens.x);
    const cy = this.atY(this.state.lens.y);
    const r = this.lensPx();

    // The mask follows the lens. In world coordinates, so the container's own
    // centre has to be added back in.
    this.lensMask.clear();
    this.lensMask.fillStyle(0xffffff, 1);
    this.lensMask.fillCircle(this.root.x + cx, this.root.y + cy, r);

    // The lit copy: the same brush, brighter, plus the animal -- which is
    // why it is the masked one. Nothing outside the glass shows the animal.
    const lit = this.lit;
    lit.clear();
    lit.fillStyle(hex(RAMPS.pine.side), 1);
    lit.fillRoundedRect(-this.fieldW / 2, -this.fieldH / 2, this.fieldW, this.fieldH, FIELD_RADIUS * px);
    for (const tuft of this.tufts) {
      this.drawTuft(lit, tuft, hex(RAMPS.grass.top), 1);
    }
    if (this.state.phase !== "bagged") this.drawQuarry(lit);

    const hud = this.hud;
    hud.clear();

    // Lens rim, and the lock ring closing over it. The ring is the only
    // feedback that teaches the rule, so it is the brightest thing here.
    hud.lineStyle(3 * px, hex(RAMPS.iron.top), 0.9);
    hud.strokeCircle(cx, cy, r);
    if (this.state.lock > 0) {
      hud.lineStyle(5 * px, locked ? hex(RAMPS.gold.top) : hex(RAMPS.grass.top), 1);
      hud.beginPath();
      hud.arc(cx, cy, r - 3 * px, -Math.PI / 2, -Math.PI / 2 + this.state.lock * Math.PI * 2, false);
      hud.strokePath();
    }

    // Crosshair. It greens up the instant the mark is actually covered,
    // which is the other half of the teaching.
    const hold = markHold(this.state);
    const tick = r * 0.28;
    hud.lineStyle(2 * px, hold > 0 ? hex(RAMPS.grass.top) : hex(RAMPS.chalk.top), 0.95);
    hud.beginPath();
    hud.moveTo(cx - tick, cy);
    hud.lineTo(cx + tick, cy);
    hud.moveTo(cx, cy - tick);
    hud.lineTo(cx, cy + tick);
    hud.strokePath();

    // Alarm bar under the field: how close the animal is to bolting.
    const barW = this.fieldW - ALARM_GAP * 2 * px;
    const barY = this.fieldH / 2 - (ALARM_H + ALARM_GAP) * px;
    hud.fillStyle(hex(RAMPS.iron.rim), 0.9);
    hud.fillRoundedRect(-barW / 2, barY, barW, ALARM_H * px, (ALARM_H * px) / 2);
    hud.fillStyle(alarm > 0.6 ? hex(RAMPS.roof.top) : hex(RAMPS.straw.top), 0.95);
    hud.fillRoundedRect(-barW / 2, barY, barW * alarm, ALARM_H * px, (ALARM_H * px) / 2);
  }

  /** The animal: a body, a head and an ear, angled the way it is travelling
   *  so its next move is readable. Deliberately a silhouette -- it is seen
   *  through glass, at distance, in cover. */
  private drawQuarry(g: Phaser.GameObjects.Graphics): void {
    const x = this.atX(this.state.quarry.x);
    const y = this.atY(this.state.quarry.y);
    const r = QUARRY_RADIUS * Math.min(this.fieldW, this.fieldH);
    const resting = this.state.quarryMode === "resting";
    const facing = Math.sign(this.state.quarryTarget.x - this.state.quarry.x) || 1;

    g.fillStyle(hex(RAMPS.muck.rim), 1);
    g.fillEllipse(x, y, r * 2.2, r * 1.5);
    g.fillStyle(hex(RAMPS.muck.top), 1);
    g.fillEllipse(x, y - r * 0.15, r * 2, r * 1.25);
    // Head forward of the body, lifted while it is standing and watching --
    // the tell that pairs with the alarm bar.
    g.fillCircle(x + facing * r * 0.95, y - r * (resting ? 0.85 : 0.45), r * 0.62);
    g.fillStyle(hex(RAMPS.muck.side), 1);
    g.fillEllipse(
      x + facing * r * 1.05,
      y - r * (resting ? 1.5 : 1.05),
      r * 0.3,
      r * 0.7,
    );
    g.fillStyle(hex(RAMPS.chalk.top), 1);
    g.fillCircle(x + facing * r * 1.2, y - r * (resting ? 0.95 : 0.55), r * 0.13);
  }

  /** One-way door: freeze, show the outcome, tear down. */
  private resolve(phase: "bagged" | "fled"): void {
    if (this.resolved) return;
    this.resolved = true;
    this.dragging = false;

    const bagged = phase === "bagged";
    this.banner.setText(bagged ? "Got it!" : "It bolted");
    this.banner.setColor(bagged ? RAMPS.gold.top : RAMPS.cream.top);
    this.hint.setText(bagged ? (this.options.baggedHint ?? "Back to the farm") : "Try another trail");

    if (bagged) this.callbacks.onBagged?.();
    else this.callbacks.onLost?.();

    if (this.options.reducedMotion) {
      this.banner.setAlpha(1).setScale(1);
      this.time.delayedCall(RESOLVE_HOLD_MS, () => this.close());
      return;
    }

    if (bagged) {
      // A clean cut-away: the flash IS the moment, and `draw` has already
      // stopped drawing the animal. Nothing is ever shown being struck.
      const gold = hex(RAMPS.gold.top);
      this.cameras.main.flash(200, (gold >> 16) & 255, (gold >> 8) & 255, gold & 255, false);
    } else {
      this.cameras.main.shake(200, 0.007);
    }
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
   * Takes the mark, if one is armed. This is what the Use key is wired to --
   * see topdown-world.tsx. Pressing it early is a deliberate no-op rather
   * than a miss (the pure module's own rule), so a player learning the key
   * cannot lose a stalk to it.
   */
  useMark(): void {
    if (this.resolved) return;
    const taken = takeMark(this.state);
    if (taken === this.state) return;
    this.state = taken;
    this.resolve("bagged");
  }

  /**
   * Gives the stalk up as a loss. The shell calls this when the player
   * closes the overlay some other way (a back press, a route change) so a
   * stalk always ends in one of the two outcomes the pure module defines,
   * never in a scene still running with nobody watching.
   */
  giveUp(): void {
    if (this.resolved) return;
    this.state = abandonStalk(this.state);
    this.resolve("fled");
  }

  /** Pans the lens by a delta in patch fractions, exposed so a test can
   *  drive the scope without a real pointer. */
  panBy(dx: number, dy: number): void {
    if (this.resolved) return;
    this.lens = { x: this.lens.x + dx, y: this.lens.y + dy };
  }

  /**
   * Host pointers and keys, capture-phase so the world scene's bubble-phase
   * listeners never see a press meant for the scope.
   *
   * The drag is RELATIVE: the lens moves by how far the finger moved, never
   * to where it landed. See this file's header on why an absolute jump would
   * spook the animal for a press the player never meant as movement.
   */
  private bindInput(): void {
    const host = this.options.host;

    const down = (event: PointerEvent): void => {
      if (this.resolved) return;
      event.stopPropagation();
      event.preventDefault();
      this.dragging = true;
      this.dragMoved = false;
      this.lastPointer = { x: event.clientX, y: event.clientY };
    };

    const move = (event: PointerEvent): void => {
      if (!this.dragging || this.resolved) return;
      event.stopPropagation();
      const last = this.lastPointer;
      if (!last) return;
      const dxCss = event.clientX - last.x;
      const dyCss = event.clientY - last.y;
      if (Math.hypot(dxCss, dyCss) > DRAG_SLOP) this.dragMoved = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      // CSS pixels to patch fractions, through the same DPR the field was
      // laid out at.
      const px = this.scale1;
      if (this.fieldW > 0 && this.fieldH > 0) {
        this.panBy((dxCss * px) / this.fieldW, (dyCss * px) / this.fieldH);
      }
    };

    const up = (event: PointerEvent): void => {
      if (!this.dragging) return;
      event.stopPropagation();
      this.dragging = false;
      this.lastPointer = null;
      // A press that never became a pan is a press: it takes the mark, which
      // is what makes the scope playable with one thumb and no Use key.
      if (!this.dragMoved) this.useMark();
      this.dragMoved = false;
    };

    const cancel = (): void => {
      this.dragging = false;
      this.lastPointer = null;
      this.dragMoved = false;
    };

    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        this.giveUp();
        return;
      }
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      this.useMark();
    };

    host.addEventListener("pointerdown", down, { capture: true, passive: false });
    host.addEventListener("pointermove", move, { capture: true, passive: false });
    host.addEventListener("pointerup", up, { capture: true });
    host.addEventListener("pointercancel", cancel, { capture: true });
    window.addEventListener("pointerup", cancel);
    window.addEventListener("keydown", keyDown, { passive: false });
    window.addEventListener("blur", cancel);

    this.unbind = () => {
      host.removeEventListener("pointerdown", down, { capture: true });
      host.removeEventListener("pointermove", move, { capture: true });
      host.removeEventListener("pointerup", up, { capture: true });
      host.removeEventListener("pointercancel", cancel, { capture: true });
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("blur", cancel);
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
 * Adds the scope over a running StackAcres game and starts it. One call is
 * the whole integration: the world scene keeps rendering and keeps its own
 * state, and this scene removes itself on either outcome.
 *
 * Re-launching while one is already up replaces it, so a double tap on the
 * treeline cannot leave two scopes stacked on the same canvas.
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
