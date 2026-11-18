import * as Phaser from "phaser";
import { CONTRACTS, PLAYER_GLOW } from "@/lib/stackstrike/content";
import { StackStrikeAudio } from "./stackstrike-audio";
import { recordAim, releaseShot, type AimSample } from "@/lib/stackstrike/aim";
import { GUARD_STRIDE, guardStep, PLAYER_STRIDE, playerStep, readThreat, StepCounter, cuesFor, type Cue, type CueContext } from "@/lib/stackstrike/audio";
import { lineOfSight, segmentRectHit } from "@/lib/stackstrike/geometry";
import { applyRun, loadoutFor, loadProgress, rankFor, saveProgress, type Progress, type RunResult } from "@/lib/stackstrike/progress";
import { buildArena, pickContract } from "@/lib/stackstrike/run";
import {
  accuracy,
  beamRange,
  createState,
  currentWeapon,
  enemyDef,
  radioDelay,
  rating,
  STEP_SECONDS,
  step,
} from "@/lib/stackstrike/sim";
import type { DifficultyId, EnemyState, PlayerInput, SimEvent, SimState } from "@/lib/stackstrike/types";
import { ARM_PX, bodyToWorld, FISTS, GUN_ART, handOffset, handsOnGun, pixelScale, REST_HANDS, segmentBetween, SHOULDERS, solveArm, walkSway, type Pt as BodyPt } from "@/lib/stackstrike/sprites";
import { angleDiff, assistAim, beamPolygon, glowPolygon, roomAt, sensedEnemies } from "@/lib/stackstrike/vision";

/**
 * The Phaser side of StackStrike: reads input, runs lib/stackstrike/sim.ts at
 * a fixed 60 Hz and draws what it says. No game rules in here, and no art yet:
 * everything is drawn with shapes so the feel can be judged before any sprites
 * exist.
 *
 * Built for a phone held sideways, laid out like StackAcres: fixed controls in
 * the bottom corners. Left thumb: a move stick. Right thumb: an aim pad that
 * points the gun and its red laser sight. Drag to aim, let go to fire (along the
 * aim from just before the lift, since a thumb rolls as it leaves the glass);
 * slide back to the middle first to cancel. A tap aims where it lands and fires.
 * Resting a thumb on the pad never fires. Reload and the weapon button sit around it.
 * There is no hide button: pressing into a corner is hiding. Desktop is the
 * same game with WASD, mouse, R and 1-3.
 *
 * The player carries no light. The world is black, lit only by a small glow
 * round the player and by the enemies' flashlights: each beam, cut short by
 * walls, is erased out of the dark, and being inside one is what fills that
 * enemy's spotted meter. The laser is draw-only, so enemies never see it.
 * It is a heist, not a wave shooter: guards are placed on the map (roamers
 * and posts), the gold case is on the far side, and the way out is the door you
 * came in. Guards within sensing range are drawn glowing red over the dark,
 * through walls, fading toward the edge of the range; far ones stay hidden until
 * you get closer, and near ones just off screen get an arrow on the edge. The
 * room you stand in is dimly lit. A spotter shows a radio ring until its call
 * goes out; shoot it first and the call dies.
 *
 * The canvas is drawn at device resolution, so every screen size below is in
 * device pixels: `u` is one CSS pixel's worth.
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SceneOptions {
  /** True on a coarse-pointer device, so the touch controls show from the start. */
  touch: boolean;
  difficulty: DifficultyId;
  /** Device pixels per CSS pixel the canvas is drawn at. */
  pixelRatio: () => number;
  /** Safe-area insets in CSS pixels, for notches and rounded corners. */
  insets: () => Insets;
}

const COLORS = {
  void: 0x000000,
  floor: 0x24262a,
  grid: 0x30333a,
  wall: 0x4a4e57,
  wallEdge: 0xa3a9b4,
  shadow: 0x3fae8c,
  player: 0xe6edf3,
  playerHurt: 0xff5d5d,
  playerShot: 0xffe066,
  enemyShot: 0xff5d5d,
  beamTint: 0xffd98a,
  laser: 0xff3b3b,
  door: 0x4a3a22,
  doorEdge: 0xd9a441,
  hud: "#e6edf3",
};

const ENEMY_COLORS: Record<string, number> = { grunt: 0xe5484d, runner: 0xf59f00 };

const ART = "/stackstrike/art";
/** The runner is the guard's drawing, tinted so it reads as a different kind of enemy. */
const ENEMY_TINT: Record<string, number> = { runner: 0xffb070 };

/** Leading upper arm, trigger upper arm, leading forearm, trigger forearm. Forearms end in a glove. */
type ArmRig = Phaser.GameObjects.Image[];
const ARM_TEXTURE_WIDTH = ARM_PX + 18;

interface Corpse {
  body: Phaser.GameObjects.Image;
  arms: ArmRig;
}

interface EnemySprite {
  body: Phaser.GameObjects.Image;
  arms: ArmRig;
  gun: Phaser.GameObjects.Image;
  last: Point;
  moving: boolean;
}
const ENEMY_GLOW = 0xff2a2a;

const DARKNESS = 0.95;
/** The dark is drawn at this share of screen resolution and stretched back up: light is soft anyway, and it is a full-screen fill. */
const DARK_SCALE = 0.5;

/** Sizes below are CSS pixels; multiply by `u` for the canvas. */
const STICK_RADIUS = 54;
/** How big the knob is drawn. Small and faint: the thumb is the control, the glass only hints where. */
const KNOB_RADIUS = 15;
/** The aim pad is a little bigger than the move stick: the same thumb travel turns the gun through a smaller angle. */
const AIM_RADIUS = 70;
/** A thumb landing within this many pad radii of a pad uses the pad; farther out it floats from where it landed. */
const PAD_GRAB = 1.5;
/** Thumb offsets inside this share of the pad radius are ignored, so a resting thumb does not wobble the gun. */
const AIM_DEADZONE = 0.16;
/** How quickly the gun settles on where the thumb points, per second. Higher is snappier, lower is smoother. */
const AIM_SMOOTHING = 26;
/** The thumb's own jitter is averaged out: this share of the way to the new position each step. */
const THUMB_FILTER = 0.55;
const BUTTON_RADIUS = 30;
/** Buttons are drawn smaller than they are to touch. */
const BUTTON_DRAW_RADIUS = 18;
/** A thumb has to move this far (CSS pixels) from where it landed before it counts as a drag. */
const DRAG_SLOP = 10;
/** A touch on the aim pad this short, with no drag, is a tap: one shot. */
const TAP_MS = 260;
/** A tap keeps asking to fire this long, so the weapon's cooldown cannot swallow it. */
const FIRE_BUFFER_SECONDS = 0.1;
const MAX_FRAME_SECONDS = 0.1;
const RESTART_LOCKOUT_MS = 700;
/** World units the phone view fits top to bottom: a whole room, so everyone in it is on screen. */
const PHONE_VIEW_HEIGHT = 500;
const CAMERA_FOLLOW_RATE = 12;
/** How far the laser sight reaches, in world units. */
const LASER_RANGE = 520;
/** Floor of the room the player is in is lit this much, so the layout can be read. */
const ROOM_LIGHT = 0.4;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: number;
  size: number;
}

/** A thumb on the move stick or the aim pad. */
interface Pad {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  /** The thumb's position with its jitter averaged out. This is what aims. */
  fx: number;
  fy: number;
  downAt: number;
  /** Where the thumb first landed. A tap is judged from here, not from the pad's centre. */
  downX: number;
  downY: number;
  /** Moved well away from where it landed: it is aiming, not tapping. */
  dragged: boolean;
  /** Started on the pad's fixed base, rather than floating from where it landed. */
  fixed: boolean;
  /** Where the gun pointed over the last few frames, so a lift can fire from before the thumb rolled off. */
  history: AimSample[];
}

interface Point {
  x: number;
  y: number;
}

export type ButtonName = "reload" | "swap";
const BUTTON_NAMES: readonly ButtonName[] = ["reload", "swap"];

interface Layout {
  u: number;
  width: number;
  height: number;
  insets: Insets;
  moveHome: Point;
  aimHome: Point;
  buttons: Record<ButtonName, Point>;
}

function circlePoints(x: number, y: number, radius: number, count = 24): Point[] {
  const points: Point[] = [];
  for (let n = 0; n < count; n += 1) {
    const angle = (n / count) * Math.PI * 2;
    points.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
  }
  return points;
}

/** Yellow at 0, red at 1. */
function alertColor(level: number): number {
  const green = Math.round(0xd2 * (1 - level) + 0x30 * level);
  const blue = Math.round(0x3f * (1 - level) + 0x30 * level);
  return (0xff << 16) | (green << 8) | blue;
}

export class StackStrikeScene extends Phaser.Scene {
  private sim: SimState;
  private accumulator = 0;
  private diedAt = 0;
  private paused = false;
  private touch: boolean;

  private layoutNow: Layout = {
    u: 1,
    width: 0,
    height: 0,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    moveHome: { x: 0, y: 0 },
    aimHome: { x: 0, y: 0 },
    buttons: { reload: { x: 0, y: 0 }, swap: { x: 0, y: 0 } },
  };

  /** Where the camera looks, in world units. Smoothed, and shared by the world and the dark. */
  private cam = { x: 0, y: 0 };

  private worldLayer!: Phaser.GameObjects.Layer;
  private hudLayer!: Phaser.GameObjects.Layer;
  private hudCamera!: Phaser.Cameras.Scene2D.Camera;
  private world!: Phaser.GameObjects.Graphics;
  private dark!: Phaser.GameObjects.RenderTexture;
  private lightBrush!: Phaser.GameObjects.Graphics;
  /** Enemies, drawn over the dark in world coordinates (it is moved and scaled to match the camera). */
  private enemyGfx!: Phaser.GameObjects.Graphics;
  /** Rings, meters and radio marks, drawn over the guards' sprites. */
  private enemyTop!: Phaser.GameObjects.Graphics;
  private playerSprite!: Phaser.GameObjects.Image;
  private playerGun!: Phaser.GameObjects.Image;
  private playerArms!: ArmRig;

  private audio!: StackStrikeAudio;
  private muted = false;
  private playerSteps = new StepCounter(PLAYER_STRIDE);
  private lastPlayerPos: Point | null = null;
  private guardSteps = new Map<number, { last: Point; counter: StepCounter }>();
  private lastWeapon = 0;
  /** The names of the last sounds played, for tests. */
  private heard: string[] = [];
  private enemySprites = new Map<number, EnemySprite>();
  private bodySprites = new Map<number, Corpse>();
  private tint!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private healthText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private buttonLabels!: Record<ButtonName, Phaser.GameObjects.Text>;

  /** Each enemy's flashlight beam this frame, by enemy id. Shared by the dark and the enemy drawing. */
  private beams = new Map<number, Point[]>();

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private reloadQueued = false;
  private selectQueued: number | null = null;
  private moveStick: Pad | null = null;
  private aimPad: Pad | null = null;
  /** Where the gun and the laser point. Stays where the thumb left it. */
  private aimAngle = 0;
  /** Seconds a tap on the aim pad still asks to fire. */
  private fireBuffer = 0;
  private hint = { text: "", left: 0 };

  private particles: Particle[] = [];
  private banner: { text: string; left: number; size?: number } = { text: "", left: 0 };
  private progress: Progress;
  /** What the run that just ended earned. Null while playing. */
  private result: RunResult | null = null;

  constructor(private readonly options: SceneOptions) {
    super("stackstrike");
    this.touch = options.touch;
    this.progress = loadProgress();
    this.sim = this.newRun();
  }

  /** A fresh building: its own gold, valuables, guards and twist, with the guns this rank has earned. */
  private newRun(): SimState {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const level = rankFor(this.progress.xp).level;
    const contract = pickContract(seed, level);
    const arena = buildArena(seed, this.options.difficulty, contract);
    return createState(seed, "vanguard", arena, this.options.difficulty, loadoutFor(level));
  }

  /** The contract is the headline of the opening seconds. */
  private announceContract(): void {
    const contract = CONTRACTS[this.sim.arena.contract ?? "standard"];
    this.banner = { text: `${contract.name.toUpperCase()}\n${contract.blurb}`, left: 3.4, size: 17 };
  }

  preload(): void {
    this.load.image("operative", `${ART}/operative.png`);
    this.load.image("guard", `${ART}/guard.png`);
    for (const kind of ["operative", "guard"]) {
      for (const part of ["upper", "fore"]) this.load.image(`arm-${kind}-${part}`, `${ART}/arm-${kind}-${part}.png`);
    }
    for (const id of Object.keys(GUN_ART)) this.load.image(`gun-${id}`, `${ART}/gun-${id}.png`);
    StackStrikeAudio.preload(this);
  }

  create(): void {
    const arena = this.sim.arena;
    this.cameras.main.setBackgroundColor(COLORS.void);
    this.cam = { x: arena.playerSpawn.x, y: arena.playerSpawn.y };

    this.worldLayer = this.add.layer();
    this.hudLayer = this.add.layer();
    this.hudLayer.setDepth(100);

    const floor = this.add.graphics();
    this.drawArena(floor);
    this.world = this.add.graphics();
    this.playerSprite = this.add.image(0, 0, "operative");
    this.playerArms = this.makeArms("operative");
    this.playerGun = this.add.image(0, 0, "gun-pistol");
    this.worldLayer.add([floor, this.world, this.playerSprite, ...this.playerArms, this.playerGun]);

    // Darkness first in the HUD layer so the controls draw on top of it.
    // Origin at the corner: a render texture otherwise centres on its position.
    this.dark = this.add
      .renderTexture(0, 0, Math.ceil(this.scale.width * DARK_SCALE), Math.ceil(this.scale.height * DARK_SCALE))
      .setOrigin(0, 0)
      .setScale(1 / DARK_SCALE);
    this.lightBrush = this.make.graphics({ x: 0, y: 0 }, false);
    this.enemyGfx = this.add.graphics();
    this.enemyTop = this.add.graphics();
    this.tint = this.add.graphics();
    this.hud = this.add.graphics();
    const text = (): Phaser.GameObjects.Text =>
      this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontStyle: "bold", color: COLORS.hud });
    this.healthText = text();
    this.statusText = text();
    this.weaponText = text().setOrigin(0.5, 1);
    this.objectiveText = text().setOrigin(1, 0).setAlign("right");
    this.bannerText = text().setOrigin(0.5).setAlign("center");
    this.buttonLabels = {
      reload: text().setOrigin(0.5).setText(""),
      swap: text().setOrigin(0.5),
    };
    this.hudLayer.add([
      this.dark,
      this.enemyGfx,
      this.enemyTop,
      this.tint,
      this.hud,
      this.healthText,
      this.statusText,
      this.weaponText,
      this.objectiveText,
      this.bannerText,
      ...Object.values(this.buttonLabels),
    ]);

    // The HUD and the dark are drawn by their own camera at 1:1 so the world
    // camera's zoom never scales them.
    this.hudCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.hudLayer);
    this.hudCamera.ignore(this.worldLayer);

    this.announceContract();
    this.setupInput();
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.onResize, this));
    this.onResize();

    this.audio = new StackStrikeAudio(this);
    this.audio.setMuted(this.muted);
    this.audio.startMusic();
    this.lastWeapon = this.sim.player.weaponIndex;

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __stackstrike?: unknown }).__stackstrike = {
        scene: this,
        state: () => this.sim,
        heard: () => [...this.heard],
      };
    }
  }

  /** Mutes or unmutes all sound. Can be called before the scene has started. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.audio?.setMuted(muted);
  }

  /** Freezes the fight, for a portrait phone or a menu. Held sticks are let go. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.audio?.setPaused(paused);
    this.accumulator = 0;
    if (paused) {
      this.moveStick = null;
      this.aimPad = null;
    }
  }

  /** Where a button sits, in CSS pixels. For tests. */
  buttonCentre(name: ButtonName): Point {
    const { buttons, u } = this.layoutNow;
    return { x: buttons[name].x / u, y: buttons[name].y / u };
  }

  /** Where a pad's fixed base sits, in CSS pixels. For tests. */
  padCentre(which: "move" | "aim"): Point {
    const { moveHome, aimHome, u } = this.layoutNow;
    const home = which === "move" ? moveHome : aimHome;
    return { x: home.x / u, y: home.y / u };
  }

  update(_time: number, deltaMs: number): void {
    if (this.paused) return;
    const frame = Math.min(deltaMs / 1000, MAX_FRAME_SECONDS);
    this.accumulator += frame;
    while (this.accumulator >= STEP_SECONDS) {
      this.accumulator -= STEP_SECONDS;
      const input = this.readInput();
      this.reloadQueued = false;
      this.selectQueued = null;
      const wasPlaying = this.sim.status === "playing";
      step(this.sim, input);
      for (const event of this.sim.events) {
        this.react(event);
        this.hear(this.cueContext(), event);
      }
      if (wasPlaying && this.sim.status !== "playing") {
        this.diedAt = this.time.now;
        this.result = applyRun(this.progress, this.sim);
        this.progress = this.result.progress;
        saveProgress(this.progress);
      }
    }

    this.updateAudio(frame);
    this.fireBuffer = Math.max(0, this.fireBuffer - frame);
    if (this.hint.left > 0) this.hint.left -= frame;
    this.updateParticles(frame);
    this.updateCamera(frame);
    this.drawWorld();
    this.updateBeams();
    this.drawDark();
    this.drawEnemies();
    this.syncEnemySprites();
    this.drawHud();
    if (this.banner.left > 0) this.banner.left -= frame;
  }

  /* ----------------------------------------------------------------- sound */

  private cueContext(): CueContext {
    const { player, arena } = this.sim;
    return {
      weaponId: currentWeapon(this.sim).id,
      listener: player.pos,
      blocked: (point) => !lineOfSight(player.pos, point, arena.walls),
      roll: Math.random,
    };
  }

  private hear(ctx: CueContext, event: SimEvent): void {
    this.playCues(cuesFor(event, ctx));
  }

  private playCues(cues: Cue[]): void {
    if (cues.length === 0) return;
    this.audio.play(cues);
    for (const cue of cues) this.heard.push(cue.name);
    if (this.heard.length > 80) this.heard.splice(0, this.heard.length - 80);
  }

  /** Footsteps, the weapon swap click and the music, once per frame. */
  private updateAudio(frame: number): void {
    const { player, enemies, status } = this.sim;
    const playing = status === "playing";
    const ctx = this.cueContext();

    const moved = this.lastPlayerPos ? Math.hypot(player.pos.x - this.lastPlayerPos.x, player.pos.y - this.lastPlayerPos.y) : 0;
    this.lastPlayerPos = { x: player.pos.x, y: player.pos.y };
    if (playing && player.moving && !player.hidden && this.playerSteps.advance(moved) > 0) this.playCues([playerStep(ctx.roll)]);

    // A guard's boots can be heard through a wall, which is how you know where it is in the dark.
    const alive = new Set<number>();
    for (const enemy of enemies) {
      alive.add(enemy.id);
      const track = this.guardSteps.get(enemy.id);
      if (!track) {
        this.guardSteps.set(enemy.id, { last: { x: enemy.pos.x, y: enemy.pos.y }, counter: new StepCounter(GUARD_STRIDE) });
        continue;
      }
      const walked = Math.hypot(enemy.pos.x - track.last.x, enemy.pos.y - track.last.y);
      track.last = { x: enemy.pos.x, y: enemy.pos.y };
      if (playing && track.counter.advance(walked) > 0) {
        const cue = guardStep(enemy.pos, ctx);
        if (cue) this.playCues([cue]);
      }
    }
    for (const id of this.guardSteps.keys()) if (!alive.has(id)) this.guardSteps.delete(id);

    if (player.weaponIndex !== this.lastWeapon) {
      this.lastWeapon = player.weaponIndex;
      if (playing) this.playCues([{ name: "swap", volume: 0.6, rate: 1, pan: 0, delay: 0 }]);
    }

    const threat = readThreat(enemies, this.sim.caution);
    this.audio.update(frame, { ...threat, ending: status === "playing" ? "none" : status });
  }

  /* ----------------------------------------------------------------- input */

  private setupInput(): void {
    this.input.addPointer(2);
    this.input.mouse?.disableContextMenu();

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
      keyboard.on("keydown-R", () => {
        if (this.sim.status !== "playing") this.restart();
        else this.reloadQueued = true;
      });
      keyboard.on("keydown-ONE", () => (this.selectQueued = 0));
      keyboard.on("keydown-TWO", () => (this.selectQueued = 1));
      keyboard.on("keydown-THREE", () => (this.selectQueued = 2));
    }

    this.input.on("wheel", (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.cycleWeapon(dy > 0 ? 1 : -1);
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.paused) return;
      if (this.sim.status !== "playing") {
        if (this.time.now - this.diedAt > RESTART_LOCKOUT_MS) this.restart();
        return;
      }
      if (!pointer.wasTouch) return;
      this.touch = true;

      const button = this.buttonAt(pointer.x, pointer.y);
      if (button) {
        this.pressButton(button);
        return;
      }

      // A thumb near a pad's base uses the pad as drawn; one farther out floats from where it landed.
      const { moveHome, aimHome, u } = this.layoutNow;
      const left = pointer.x < this.scale.width / 2;
      const home = left ? moveHome : aimHome;
      const near = Math.hypot(pointer.x - home.x, pointer.y - home.y) <= (left ? STICK_RADIUS : AIM_RADIUS) * PAD_GRAB * u;
      const pad: Pad = {
        id: pointer.id,
        originX: near ? home.x : pointer.x,
        originY: near ? home.y : pointer.y,
        x: pointer.x,
        y: pointer.y,
        fx: pointer.x,
        fy: pointer.y,
        downAt: this.time.now,
        downX: pointer.x,
        downY: pointer.y,
        dragged: false,
        fixed: near,
        history: [],
      };
      if (left) {
        if (!this.moveStick) this.moveStick = pad;
      } else if (!this.aimPad) {
        this.aimPad = pad;
        // A tap on the pad aims where it landed, so a tap off-centre shoots that way.
        this.aimFromPad(pad);
        this.sampleThumb(pad, pointer);
      }
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      for (const pad of [this.moveStick, this.aimPad]) {
        if (pad?.id === pointer.id) {
          pad.x = pointer.x;
          pad.y = pointer.y;
          // Judged here, not on the next step, so a flick that is over within a frame still counts as aiming.
          if (Math.hypot(pad.x - pad.downX, pad.y - pad.downY) > DRAG_SLOP * this.layoutNow.u) pad.dragged = true;
          if (pad === this.aimPad) this.sampleThumb(pad, pointer);
        }
      }
    });

    const release = (pointer: Phaser.Input.Pointer): void => {
      if (this.moveStick?.id === pointer.id) this.moveStick = null;
      if (this.aimPad?.id === pointer.id) {
        if (this.aimPad.dragged) {
          // Letting go of an aimed thumb shoots, along the aim from just before the lift (the thumb
          // rolls as it leaves the glass). Slid back to the middle, it is a cancel.
          const end = this.padVector(this.aimPad, AIM_RADIUS);
          const shot = releaseShot(this.aimPad.history, pointer.event?.timeStamp ?? performance.now(), {
            angle: Math.atan2(end.y, end.x),
            reach: Math.hypot(end.x, end.y),
          });
          if (shot) {
            this.aimAngle = shot.angle;
            this.fireBuffer = FIRE_BUFFER_SECONDS;
          }
        } else if (this.time.now - this.aimPad.downAt <= TAP_MS) {
          // A quick touch that never dragged is a tap: fire once, where it landed.
          this.fireBuffer = FIRE_BUFFER_SECONDS;
        }
        this.aimPad = null;
      }
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  /**
   * Remembers where the thumb was and when, stamped by the browser when the touch happened
   * rather than when a frame got round to it, so a slow frame cannot smear the lift-off lookback.
   */
  private sampleThumb(pad: Pad, pointer: Phaser.Input.Pointer): void {
    const vector = this.padVector(pad, AIM_RADIUS);
    recordAim(pad.history, {
      at: pointer.event?.timeStamp ?? performance.now(),
      angle: Math.atan2(vector.y, vector.x),
      reach: Math.hypot(vector.x, vector.y),
    });
  }

  private pressButton(name: ButtonName): void {
    switch (name) {
      case "reload":
        this.reloadQueued = true;
        return;
      case "swap":
        this.cycleWeapon(1);
        return;
    }
  }

  private padVector(pad: Pad | null, radiusCss: number = STICK_RADIUS, filtered = false): Point {
    if (!pad) return { x: 0, y: 0 };
    const radius = radiusCss * this.layoutNow.u;
    const dx = ((filtered ? pad.fx : pad.x) - pad.originX) / radius;
    const dy = ((filtered ? pad.fy : pad.y) - pad.originY) / radius;
    const length = Math.hypot(dx, dy);
    return length > 1 ? { x: dx / length, y: dy / length } : { x: dx, y: dy };
  }

  /** Reads the controls for one step. Exposed so tests can check where a thumb or the mouse points. */
  readInput(): PlayerInput {
    const key = (name: string): number => (this.keys?.[name]?.isDown ? 1 : 0);
    let move = { x: key("D") + key("RIGHT") - key("A") - key("LEFT"), y: key("S") + key("DOWN") - key("W") - key("UP") };
    if (this.moveStick) move = this.padVector(this.moveStick);

    const player = this.sim.player;
    let fire = this.fireBuffer > 0;

    if (this.aimPad) {
      // The gun and the laser follow the thumb wherever it is on the pad, eased so a shaky thumb does not shake the gun.
      this.aimPad.fx += (this.aimPad.x - this.aimPad.fx) * THUMB_FILTER;
      this.aimPad.fy += (this.aimPad.y - this.aimPad.fy) * THUMB_FILTER;
      this.aimFromPad(this.aimPad, false);
      const slop = DRAG_SLOP * this.layoutNow.u;
      if (Math.hypot(this.aimPad.x - this.aimPad.downX, this.aimPad.y - this.aimPad.downY) > slop) {
        this.aimPad.dragged = true;
      }
    } else if (!this.touch) {
      const pointer = this.input.mousePointer;
      const world = this.screenToWorld(pointer.x, pointer.y);
      this.aimAngle = Math.atan2(world.y - player.pos.y, world.x - player.pos.x);
      fire = fire || pointer.leftButtonDown();
    }

    // A thumb that is nearly right is helped the rest of the way. The laser and the shot both use it.
    const aim = this.assistedAim();
    return {
      move,
      aim,
      fire,
      reload: this.reloadQueued,
      selectWeapon: this.selectQueued,
    };
  }

  /**
   * Turns the gun toward where the thumb is, unless it is on the pad's centre.
   * `snap` jumps straight there (a tap), otherwise the gun eases round.
   */
  private aimFromPad(pad: Pad, snap = true): void {
    const vector = this.padVector(pad, AIM_RADIUS, !snap);
    if (Math.hypot(vector.x, vector.y) <= AIM_DEADZONE) return;
    const wanted = Math.atan2(vector.y, vector.x);
    if (snap) {
      this.aimAngle = wanted;
      return;
    }
    const blend = 1 - Math.exp(-AIM_SMOOTHING * STEP_SECONDS);
    this.aimAngle += angleDiff(this.aimAngle, wanted) * blend;
  }

  /** The thumb's aim, pulled onto a visible enemy that is nearly in the sights. */
  private assistedAim(): number {
    if (!this.touch) return this.aimAngle;
    const { player, arena, enemies } = this.sim;
    const targets = enemies.map((enemy) => ({ pos: enemy.pos, radius: enemyDef(enemy.defId).radius }));
    return assistAim(this.aimAngle, player.pos, targets, arena.walls, Math.min(currentWeapon(this.sim).range, LASER_RANGE));
  }

  private cycleWeapon(direction: number): void {
    const count = this.sim.player.weaponIds.length;
    this.selectQueued = (this.sim.player.weaponIndex + direction + count) % count;
  }

  /** The button under a touch, preferring the nearest when two are close. */
  private buttonAt(x: number, y: number): ButtonName | null {
    const { buttons, u } = this.layoutNow;
    const reach = (BUTTON_RADIUS + 6) * u;
    let best: ButtonName | null = null;
    let bestDistance = Infinity;
    for (const name of BUTTON_NAMES) {
      if (name === "swap" && this.sim.player.weaponIds.length < 2) continue;
      const dist = Math.hypot(x - buttons[name].x, y - buttons[name].y);
      if (dist <= reach && dist < bestDistance) {
        best = name;
        bestDistance = dist;
      }
    }
    return best;
  }

  private restart(): void {
    this.sim = this.newRun();
    for (const sprite of this.enemySprites.values()) {
      sprite.body.destroy();
      for (const arm of sprite.arms) arm.destroy();
      sprite.gun.destroy();
    }
    this.enemySprites.clear();
    for (const corpse of this.bodySprites.values()) {
      corpse.body.destroy();
      for (const arm of corpse.arms) arm.destroy();
    }
    this.bodySprites.clear();
    this.result = null;
    this.audio.reset();
    this.playerSteps.reset();
    this.lastPlayerPos = null;
    this.guardSteps.clear();
    this.lastWeapon = this.sim.player.weaponIndex;
    this.announceContract();
    this.aimAngle = 0;
    this.fireBuffer = 0;
    this.hint.left = 0;
    this.particles = [];
    this.accumulator = 0;
    this.banner.left = 0;
    this.cam = { x: this.sim.player.pos.x, y: this.sim.player.pos.y };
  }

  /* ------------------------------------------------------------------ camera */

  private get zoom(): number {
    return this.cameras.main.zoom;
  }

  /** The camera centre for a target, kept inside the arena (or centred when the view is bigger). */
  private clampCamera(x: number, y: number): Point {
    const { width, height } = this.layoutNow;
    const arena = this.sim.arena;
    const halfW = width / (2 * this.zoom);
    const halfH = height / (2 * this.zoom);
    return {
      x: arena.width <= halfW * 2 ? arena.width / 2 : Phaser.Math.Clamp(x, halfW, arena.width - halfW),
      y: arena.height <= halfH * 2 ? arena.height / 2 : Phaser.Math.Clamp(y, halfH, arena.height - halfH),
    };
  }

  private updateCamera(frame: number): void {
    const target = this.clampCamera(this.sim.player.pos.x, this.sim.player.pos.y);
    const blend = Math.min(1, CAMERA_FOLLOW_RATE * frame);
    this.cam.x += (target.x - this.cam.x) * blend;
    this.cam.y += (target.y - this.cam.y) * blend;
    const { width, height } = this.layoutNow;
    this.cameras.main.setScroll(this.cam.x - width / 2, this.cam.y - height / 2);
  }

  private worldToScreen(x: number, y: number): Point {
    const { width, height } = this.layoutNow;
    return { x: (x - this.cam.x) * this.zoom + width / 2, y: (y - this.cam.y) * this.zoom + height / 2 };
  }

  private screenToWorld(x: number, y: number): Point {
    const { width, height } = this.layoutNow;
    return { x: (x - width / 2) / this.zoom + this.cam.x, y: (y - height / 2) / this.zoom + this.cam.y };
  }

  /* --------------------------------------------------------------- reactions */

  private react(event: SimEvent): void {
    switch (event.type) {
      case "shot":
        if (event.from === "player") this.burst(event.pos.x, event.pos.y, 3, 0xffe066, 60, 0.08);
        break;
      case "hit":
        this.burst(event.pos.x, event.pos.y, 5, event.target === "enemy" ? 0xffffff : 0xff4d4d, 120, 0.25);
        if (event.target === "player") this.cameras.main.shake(90, 0.004);
        break;
      case "wall":
        this.burst(event.pos.x, event.pos.y, 3, 0x9fb0c8, 80, 0.2);
        break;
      case "kill":
        this.burst(event.pos.x, event.pos.y, 14, ENEMY_COLORS[event.defId] ?? 0xffffff, 200, 0.5);
        break;
      case "pickup":
        this.burst(event.pos.x, event.pos.y, event.main ? 18 : 8, 0xffd23f, 150, 0.6);
        this.banner = event.main ? { text: "GOLD SECURED\nGET OUT", left: 2.4 } : { text: `+${event.value}`, left: 1.1 };
        break;
      case "escaped":
        break;
      case "spotted":
        this.cameras.main.shake(140, 0.003);
        break;
      case "radio":
        this.hint = { text: "THEY CALLED IT IN", left: 2.4 };
        break;
      case "body":
        this.hint = { text: "BODY FOUND", left: 2.4 };
        this.cameras.main.shake(120, 0.002);
        break;
      case "dead":
        this.cameras.main.shake(300, 0.012);
        break;
      case "reload":
      case "hide":
        break;
    }
  }

  private burst(x: number, y: number, count: number, color: number, speed: number, life: number): void {
    for (let n = 0; n < count; n += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        max: life,
        color,
        size: 2 + Math.random() * 2,
      });
    }
    // The pool is capped so a long fight cannot grow it without bound.
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  private updateParticles(dt: number): void {
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  /* ------------------------------------------------------------------ layout */

  private onResize(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const u = Math.max(1, this.options.pixelRatio());
    const css = this.options.insets();
    const insets: Insets = { top: css.top * u, right: css.right * u, bottom: css.bottom * u, left: css.left * u };

    // Fixed controls in the bottom corners, like StackAcres: the two pads at the
    // bottom, the buttons stacked toward the right thumb's reach.
    const right = width - insets.right;
    const bottom = height - insets.bottom;
    const padY = bottom - 86 * u;
    this.layoutNow = {
      u,
      width,
      height,
      insets,
      moveHome: { x: insets.left + 100 * u, y: padY },
      aimHome: { x: right - 104 * u, y: padY },
      buttons: {
        reload: { x: right - 46 * u, y: padY - (AIM_RADIUS + 46) * u },
        swap: { x: right - 130 * u, y: padY - (AIM_RADIUS + 50) * u },
      },
    };

    this.hudCamera.setSize(width, height);
    this.dark.resize(Math.ceil(width * DARK_SCALE), Math.ceil(height * DARK_SCALE));

    // A phone shows about one room, so everyone in it is on screen; a desktop window shows more.
    const zoom = this.touch
      ? Phaser.Math.Clamp(height / PHONE_VIEW_HEIGHT, 0.6 * u, 3 * u)
      : Phaser.Math.Clamp(Math.min(width / 1200, height / 700), 0.45 * u, 2 * u);
    this.cameras.main.setZoom(zoom);

    const small = Math.round(15 * u);
    const left = insets.left + 16 * u;
    this.healthText.setFontSize(small).setPosition(left, insets.top + 12 * u);
    this.weaponText.setFontSize(Math.round(13 * u)).setOrigin(0, 0).setPosition(left, insets.top + 54 * u);
    this.statusText.setFontSize(Math.round(12 * u)).setPosition(left, insets.top + 76 * u);
    this.objectiveText.setFontSize(small).setPosition(width - insets.right - 16 * u, insets.top + 12 * u);
    this.bannerText.setPosition(width / 2, height * 0.3);
    for (const name of BUTTON_NAMES) {
      this.buttonLabels[name].setFontSize(Math.round(9 * u)).setAlpha(0.6).setPosition(this.layoutNow.buttons[name].x, this.layoutNow.buttons[name].y);
    }
  }

  /* ------------------------------------------------------------------ draw */

  private drawArena(g: Phaser.GameObjects.Graphics): void {
    const arena = this.sim.arena;
    g.fillStyle(COLORS.floor, 1);
    g.fillRect(0, 0, arena.width, arena.height);
    g.lineStyle(1, COLORS.grid, 0.8);
    for (let x = 0; x <= arena.width; x += 64) g.lineBetween(x, 0, x, arena.height);
    for (let y = 0; y <= arena.height; y += 64) g.lineBetween(0, y, arena.width, y);

    for (const wall of arena.walls) {
      g.fillStyle(COLORS.wall, 1);
      g.fillRect(wall.x, wall.y, wall.w, wall.h);
      g.lineStyle(2, COLORS.wallEdge, 1);
      g.strokeRect(wall.x, wall.y, wall.w, wall.h);
    }

    // The way in and out, set into the outer wall.
    const { x, y, w, h } = arena.exit.door;
    g.fillStyle(0x1f4d36, 1);
    g.fillRect(x, y, w, h);
    g.lineStyle(2, 0x5ee0a0, 1);
    g.strokeRect(x, y, w, h);
  }

  private drawWorld(): void {
    const g = this.world;
    const { enemies, projectiles } = this.sim;
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 180);
    g.clear();

    this.drawBodies();
    this.drawPlayerSprite();
    this.drawDetectionRing(g, enemies, pulse);

    // Bullets are bright whatever the light, so incoming fire can be read.
    for (const shot of projectiles) {
      const tail = 0.025;
      g.lineStyle(2.5, shot.from === "player" ? COLORS.playerShot : COLORS.enemyShot, 1);
      g.lineBetween(shot.pos.x - shot.vel.x * tail, shot.pos.y - shot.vel.y * tail, shot.pos.x, shot.pos.y);
    }

    for (const particle of this.particles) {
      g.fillStyle(particle.color, particle.life / particle.max);
      g.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
  }

  /** Guards that were shot lie where they fell, arms hanging. Only the light that reaches them shows them. */
  private drawBodies(): void {
    const live = new Set<number>();
    for (const body of this.sim.bodies) {
      live.add(body.id);
      let corpse = this.bodySprites.get(body.id);
      if (!corpse) {
        const image = this.add.image(body.pos.x, body.pos.y, "guard");
        const arms = this.makeArms("guard");
        this.worldLayer.addAt(image, 1);
        arms.forEach((arm, index) => this.worldLayer.addAt(arm, 2 + index));
        corpse = { body: image, arms };
        this.bodySprites.set(body.id, corpse);
      }
      const angle = ((body.id * 37) % 11) * 0.57;
      const scale = pixelScale(14);
      const color = body.found ? 0xb05050 : 0x7a6a6a;
      corpse.body.setPosition(body.pos.x, body.pos.y).setRotation(angle).setScale(scale).setTint(color);
      this.poseArms(corpse.arms, body.pos, angle, angle, scale, REST_HANDS);
      for (const arm of corpse.arms) arm.setTint(color);
    }
    for (const [id, corpse] of this.bodySprites) {
      if (live.has(id)) continue;
      corpse.body.destroy();
      for (const arm of corpse.arms) arm.destroy();
      this.bodySprites.delete(id);
    }
  }

  /** The four arm pieces for one character, hidden until posed. */
  private makeArms(kind: "operative" | "guard"): ArmRig {
    return [`${kind}-upper`, `${kind}-upper`, `${kind}-fore`, `${kind}-fore`].map((name) =>
      this.add.image(0, 0, `arm-${name}`).setOrigin(9 / ARM_TEXTURE_WIDTH, 0.5),
    );
  }

  /**
   * Stretches the arms from the shoulders to the hands. `centre` and `scale` are in whatever space the
   * sprites are drawn in (world, or screen for guards). The shoulders turn with the body, the hands with the aim.
   */
  private poseArms(arms: ArmRig, centre: Point, bodyAngle: number, aim: number, scale: number, hands: { lead: BodyPt; rear: BodyPt }): void {
    const sides = [
      ["lead", -1],
      ["rear", 1],
    ] as const;
    sides.forEach(([side, outward], index) => {
      const pose = solveArm(SHOULDERS[side], hands[side], outward);
      const shoulder = bodyToWorld(centre, bodyAngle, scale, pose.shoulder);
      const elbow = bodyToWorld(centre, bodyAngle, scale, pose.elbow);
      const hand = bodyToWorld(centre, aim, scale, pose.hand);
      const upper = segmentBetween(shoulder, elbow, ARM_PX * scale);
      const fore = segmentBetween(elbow, hand, ARM_PX * scale);
      arms[index].setVisible(true).setPosition(upper.x, upper.y).setRotation(upper.rotation).setScale(scale * upper.stretch, scale);
      arms[2 + index].setVisible(true).setPosition(fore.x, fore.y).setRotation(fore.rotation).setScale(scale * fore.stretch, scale);
    });
  }

  /** The operative from above, turned to where the gun points, with both hands on the gun. */
  private drawPlayerSprite(): void {
    const { player } = this.sim;
    const sway = walkSway(this.time.now / 1000, player.moving);
    const scale = pixelScale(player.radius);
    const gunId = this.currentGunId();
    const art = GUN_ART[gunId];
    const hands = handOffset(player.aim, player.radius, art.hold);
    const alpha = player.hidden ? 0.6 : 1;
    this.playerSprite.setPosition(player.pos.x, player.pos.y).setRotation(player.aim + sway).setScale(scale).setAlpha(alpha);
    this.poseArms(this.playerArms, player.pos, player.aim + sway, player.aim, scale, handsOnGun(art));
    for (const part of [this.playerSprite, ...this.playerArms]) {
      part.setAlpha(alpha);
      if (player.hurt > 0) part.setTintFill(0xff8080);
      else part.clearTint();
    }
    this.placeGun(this.playerGun, gunId, { x: player.pos.x + hands.x, y: player.pos.y + hands.y }, player.aim, scale, alpha);
  }

  private currentGunId(): string {
    return currentWeapon(this.sim).id;
  }

  /** Pins a gun's grip to the hands and turns it to the aim. Left-facing guns are flipped so the top stays up. */
  private placeGun(gun: Phaser.GameObjects.Image, id: string, at: Point, aim: number, scale: number, alpha: number): void {
    const art = GUN_ART[id];
    if (!art) {
      gun.setVisible(false);
      return;
    }
    gun
      .setVisible(true)
      .setTexture(`gun-${id}`)
      .setOrigin(art.grip.x / art.w, art.grip.y / art.h)
      .setPosition(at.x, at.y)
      .setRotation(aim)
      .setScale(scale)
      .setFlipY(Math.cos(aim) < 0)
      .setAlpha(alpha);
  }

  /**
   * One sprite per guard that can be made out: the drawing for the way it faces, a gun
   * in its hands if it carries one, a little bob while it walks. They sit over the dark in
   * screen space, like the glows beneath them.
   */
  private syncEnemySprites(): void {
    const zoom = this.zoom;
    const seconds = this.time.now / 1000;
    const visible = new Map<number, number>();
    for (const { enemy, strength } of sensedEnemies(this.sim.player.pos, this.sim.enemies)) visible.set(enemy.id, strength);

    for (const enemy of this.sim.enemies) {
      let sprite = this.enemySprites.get(enemy.id);
      if (!sprite) {
        const body = this.add.image(0, 0, "guard");
        const arms = this.makeArms("guard");
        const gun = this.add.image(0, 0, "gun-pistol");
        const at = this.hudLayer.getIndex(this.enemyTop);
        this.hudLayer.addAt(body, at);
        arms.forEach((arm, index) => this.hudLayer.addAt(arm, at + 1 + index));
        this.hudLayer.addAt(gun, at + 5);
        sprite = { body, arms, gun, last: { ...enemy.pos }, moving: false };
        this.enemySprites.set(enemy.id, sprite);
      }
      const fade = visible.get(enemy.id);
      if (fade === undefined) {
        sprite.body.setVisible(false);
        for (const arm of sprite.arms) arm.setVisible(false);
        sprite.gun.setVisible(false);
        sprite.last = { ...enemy.pos };
        continue;
      }
      const def = enemyDef(enemy.defId);
      const moved = Math.hypot(enemy.pos.x - sprite.last.x, enemy.pos.y - sprite.last.y) > 0.05;
      sprite.moving = moved;
      sprite.last = { ...enemy.pos };
      const sway = walkSway(seconds + enemy.id * 0.37, moved);
      const scale = pixelScale(def.radius) * zoom;
      const at = this.worldToScreen(enemy.pos.x, enemy.pos.y);
      const bodyAngle = enemy.facing + sway;
      sprite.body.setVisible(true).setPosition(at.x, at.y).setRotation(bodyAngle).setScale(scale).setAlpha(fade);
      const armed = def.attack === "ranged";
      this.poseArms(sprite.arms, at, bodyAngle, enemy.facing, scale, armed ? handsOnGun(GUN_ART.pistol) : FISTS);
      const tint = ENEMY_TINT[enemy.defId];
      for (const part of [sprite.body, ...sprite.arms]) {
        part.setAlpha(fade);
        if (enemy.hurt > 0) part.setTintFill(0xffffff);
        else if (tint !== undefined) part.setTint(tint);
        else part.clearTint();
      }

      if (armed) {
        const hands = handOffset(enemy.facing, def.radius, GUN_ART.pistol.hold);
        const grip = this.worldToScreen(enemy.pos.x + hands.x, enemy.pos.y + hands.y);
        this.placeGun(sprite.gun, "pistol", grip, enemy.facing, scale, fade);
      } else {
        sprite.gun.setVisible(false);
      }
    }

    const alive = new Set(this.sim.enemies.map((enemy) => enemy.id));
    for (const [id, sprite] of this.enemySprites) {
      if (alive.has(id)) continue;
      sprite.body.destroy();
      for (const arm of sprite.arms) arm.destroy();
      sprite.gun.destroy();
      this.enemySprites.delete(id);
    }
  }

  /**
   * Every enemy, all the time, glowing red over the dark so the player is never
   * guessing where they are. Each carries a flashlight and the beam is its line
   * of sight: stand in it and its spotted meter fills, stay out and it cannot
   * see you. The beam goes from yellow toward red as that meter fills.
   */
  private drawEnemies(): void {
    const g = this.enemyGfx;
    const { enemies } = this.sim;
    const { width, height } = this.layoutNow;
    const zoom = this.zoom;
    const top = this.enemyTop;
    for (const layer of [g, top]) layer.setPosition(width / 2 - this.cam.x * zoom, height / 2 - this.cam.y * zoom).setScale(zoom);
    g.clear();
    top.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 220);

    this.drawObjectives(g, pulse);

    for (const { enemy, strength: fade } of sensedEnemies(this.sim.player.pos, enemies)) {
      const def = enemyDef(enemy.defId);
      const alert = enemy.mode === "chase" || enemy.mode === "attack";
      const { x, y } = enemy.pos;

      // Its flashlight: a wide soft beam with a brighter core near the lamp.
      const beam = this.beams.get(enemy.id);
      if (beam) {
        const tint = alertColor(alert ? 1 : enemy.awareness);
        g.fillStyle(tint, (0.1 + 0.14 * (alert ? 1 : enemy.awareness)) * fade);
        g.fillPoints(beam, true);
        g.fillStyle(tint, (0.1 + 0.1 * (alert ? 1 : enemy.awareness)) * fade);
        g.fillPoints(
          beam.map((p) => ({ x: x + (p.x - x) * 0.55, y: y + (p.y - y) * 0.55 })),
          true,
        );
      }

      // The glow: three soft rings, brighter when it is hunting.
      const strength = alert ? 1.4 + 0.3 * pulse : 1;
      for (const [scale, alpha] of [
        [3.4, 0.07],
        [2.4, 0.12],
        [1.65, 0.2],
      ] as const) {
        g.fillStyle(ENEMY_GLOW, Math.min(1, alpha * strength) * fade);
        g.fillCircle(x, y, def.radius * scale);
      }

      // A thin ring round the guard: red rim, brighter when it is on to something.
      g.lineStyle(2, ENEMY_GLOW, 0.9 * fade);
      g.strokeCircle(x, y, def.radius + 1);
      if (alert || enemy.mode === "search" || enemy.mode === "suspicious") {
        g.lineStyle(3, alert ? 0xff3030 : 0xffd23f, fade);
        g.strokeCircle(x, y, def.radius + 5);
      }

      // The detection meter over its head: it fills as it works out you are there.
      const meterWidth = def.radius * 2 + 6;
      const meterLeft = x - meterWidth / 2;
      const meterTop = y - def.radius - 20;
      if (alert) {
        top.fillStyle(0xff3030, 1);
        top.fillRect(x - 1.5, meterTop - 6, 3, 7);
        top.fillRect(x - 1.5, meterTop + 3, 3, 3);
      } else if (enemy.awareness > 0.02) {
        top.fillStyle(0x000000, 0.7);
        top.fillRect(meterLeft - 1, meterTop - 1, meterWidth + 2, 6);
        top.fillStyle(alertColor(enemy.awareness), 1);
        top.fillRect(meterLeft, meterTop, meterWidth * enemy.awareness, 4);
      }
      if (enemy.radio) {
        // Mid radio call: a ring closing in. Kill it before it ends and nobody else hears.
        const left = enemy.radio.left / radioDelay(this.sim);
        top.lineStyle(2, 0x63e6ff, 0.9);
        top.strokeCircle(x, y, def.radius + 9 + 14 * left);
        top.fillStyle(0x63e6ff, 1);
        top.fillRect(x + def.radius * 0.5, y - def.radius - 12, 3, 8);
      }
    }
  }

  /**
   * The gold case and the other valuables glow gold over the dark so you can
   * find them, and the way out glows green once the case is in your hands.
   */
  private drawObjectives(g: Phaser.GameObjects.Graphics, pulse: number): void {
    const { loot, hasGold, arena } = this.sim;
    for (const { spot, taken } of loot) {
      if (taken) continue;
      const main = spot.main;
      const radius = main ? 11 : 6;
      g.fillStyle(0xffd23f, (main ? 0.12 : 0.07) + 0.08 * pulse);
      g.fillCircle(spot.pos.x, spot.pos.y, radius * 3);
      g.fillStyle(0xffd23f, 1);
      if (main) g.fillRect(spot.pos.x - radius, spot.pos.y - radius * 0.7, radius * 2, radius * 1.4);
      else g.fillCircle(spot.pos.x, spot.pos.y, radius);
      g.lineStyle(2, 0x6b4a00, 1);
      if (main) g.strokeRect(spot.pos.x - radius, spot.pos.y - radius * 0.7, radius * 2, radius * 1.4);
      else g.strokeCircle(spot.pos.x, spot.pos.y, radius);
    }
    const zone = arena.exit.zone;
    g.fillStyle(0x5ee0a0, (hasGold ? 0.22 : 0.07) + (hasGold ? 0.14 * pulse : 0));
    g.fillRect(zone.x, zone.y, zone.w, zone.h);
    g.lineStyle(2, 0x5ee0a0, hasGold ? 0.9 : 0.35);
    g.strokeRect(zone.x, zone.y, zone.w, zone.h);
  }

  /**
   * The ring round the player is the stealth meter: it fills with the most
   * suspicious enemy's awareness, and a marker on it points at that enemy,
   * seen or not. Solid red means someone has spotted you.
   */
  private drawDetectionRing(g: Phaser.GameObjects.Graphics, enemies: EnemyState[], pulse: number): void {
    const { player } = this.sim;
    let level = 0;
    let watcher: EnemyState | null = null;
    let hunted = false;
    for (const enemy of enemies) {
      if (enemy.mode === "chase" || enemy.mode === "attack") hunted = true;
      if (enemy.awareness > level) {
        level = enemy.awareness;
        watcher = enemy;
      }
    }
    const radius = player.radius + 9;
    g.lineStyle(2, 0xffffff, 0.12);
    g.strokeCircle(player.pos.x, player.pos.y, radius);
    if (!watcher || level < 0.02) return;

    if (hunted) {
      g.lineStyle(4, 0xff3030, 0.55 + 0.4 * pulse);
      g.strokeCircle(player.pos.x, player.pos.y, radius);
    } else {
      g.lineStyle(4, alertColor(level), 0.95);
      g.beginPath();
      g.arc(player.pos.x, player.pos.y, radius, -Math.PI / 2, -Math.PI / 2 + level * Math.PI * 2, false);
      g.strokePath();
    }

    const toward = Math.atan2(watcher.pos.y - player.pos.y, watcher.pos.x - player.pos.x);
    const cx = player.pos.x + Math.cos(toward) * (radius + 8);
    const cy = player.pos.y + Math.sin(toward) * (radius + 8);
    const ux = Math.cos(toward);
    const uy = Math.sin(toward);
    g.fillStyle(hunted ? 0xff3030 : alertColor(level), 1);
    g.fillTriangle(
      cx + ux * 7,
      cy + uy * 7,
      cx - ux * 3 - uy * 6,
      cy - uy * 3 + ux * 6,
      cx - ux * 3 + uy * 6,
      cy - uy * 3 - ux * 6,
    );
  }

  private updateBeams(): void {
    this.beams.clear();
    for (const { enemy } of sensedEnemies(this.sim.player.pos, this.sim.enemies)) {
      const def = enemyDef(enemy.defId);
      this.beams.set(enemy.id, beamPolygon(enemy.pos, enemy.facing, this.sim.arena.walls, beamRange(this.sim, def), def.fieldOfView, 28));
    }
  }

  /** Blacks the screen out, then erases the enemies' flashlight beams, the glow around the player and the lit doorways. */
  private drawDark(): void {
    const { player, arena } = this.sim;
    const dark = this.dark;
    dark.clear();
    dark.fill(COLORS.void, DARKNESS);

    const erase = (poly: Point[], alpha: number): void => {
      const screen = poly.map((p) => {
        const at = this.worldToScreen(p.x, p.y);
        return { x: at.x * DARK_SCALE, y: at.y * DARK_SCALE };
      });
      this.lightBrush.clear();
      this.lightBrush.fillStyle(0xffffff, alpha);
      this.lightBrush.fillPoints(screen, true);
      dark.erase(this.lightBrush);
    };

    this.tint.clear();

    // The room you are standing in is dimly lit, so you can read the layout. Rooms you are not in stay black.
    const here = roomAt(arena, player.pos);
    if (here) {
      const { x, y, w, h } = here.rect;
      erase(
        [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
        ROOM_LIGHT,
      );
    }

    // The way out is always faintly lit, so you can find your way back.
    const door = arena.exit.door;
    erase(circlePoints(door.x + door.w / 2 + 30, door.y + door.h / 2, 90), 0.4);

    // Each guard's flashlight lights the floor it sweeps, brightest near the lamp. Only the ones you can make out.
    for (const { enemy } of sensedEnemies(player.pos, this.sim.enemies)) {
      const def = enemyDef(enemy.defId);
      const poly = this.beams.get(enemy.id);
      if (!poly) continue;
      erase(poly, 0.3);
      erase(beamPolygon(enemy.pos, enemy.facing, arena.walls, beamRange(this.sim, def) * 0.6, def.fieldOfView * 0.75, 20), 0.3);
    }

    // The glow keeps the area right around the player readable.
    const glow = glowPolygon(player.pos, arena.walls);
    erase(glow, 0.85);
    erase(glowPolygon(player.pos, arena.walls, PLAYER_GLOW.radius * 0.5), 0.9);

    this.drawLaser();
  }

  /**
   * A laser sight, so the player can see where a shot will go on a dark map.
   * It is drawn over the darkness and only on this screen: the sim never reads
   * it, so no enemy can see it. Stops at the first wall.
   */
  private drawLaser(): void {
    const { player, arena } = this.sim;
    if (player.hidden || this.sim.status !== "playing") return;
    const reach = Math.min(currentWeapon(this.sim).range, LASER_RANGE);
    const from = {
      x: player.pos.x + Math.cos(player.aim) * (player.radius + 4),
      y: player.pos.y + Math.sin(player.aim) * (player.radius + 4),
    };
    const far = { x: player.pos.x + Math.cos(player.aim) * reach, y: player.pos.y + Math.sin(player.aim) * reach };
    let nearest = 1;
    for (const wall of arena.walls) {
      const t = segmentRectHit(from, far, wall);
      if (t !== null && t < nearest) nearest = t;
    }
    const end = { x: from.x + (far.x - from.x) * nearest, y: from.y + (far.y - from.y) * nearest };

    const { u } = this.layoutNow;
    const a = this.worldToScreen(from.x, from.y);
    const b = this.worldToScreen(end.x, end.y);
    const g = this.tint;
    // Brightest at the gun, fading toward the far end, in three steps.
    for (let n = 0; n < 3; n += 1) {
      const t0 = n / 3;
      const t1 = (n + 1) / 3;
      g.lineStyle(1.6 * u, COLORS.laser, 0.8 - n * 0.22);
      g.lineBetween(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
    }
    g.fillStyle(COLORS.laser, nearest < 1 ? 0.95 : 0.5);
    g.fillCircle(b.x, b.y, (nearest < 1 ? 3 : 2) * u);
  }

  private drawHud(): void {
    const g = this.hud;
    const { player, status } = this.sim;
    const weapon = currentWeapon(this.sim);
    const { u, width, height, insets, buttons } = this.layoutNow;
    g.clear();

    // Health.
    const barX = insets.left + 16 * u;
    const barY = insets.top + 12 * u + 24 * u;
    const barWidth = 170 * u;
    g.fillStyle(0x000000, 0.6);
    g.fillRect(barX, barY, barWidth, 10 * u);
    g.fillStyle(player.health / player.maxHealth > 0.3 ? 0x7ee787 : 0xff6b6b, 1);
    g.fillRect(barX, barY, barWidth * (player.health / player.maxHealth), 10 * u);
    this.healthText.setText(`HP ${Math.ceil(player.health)}`);

    // Weapon and ammo under the health bar, with the reload bar beneath when reloading.
    const ammo = player.ammo[player.weaponIndex];
    this.weaponText.setText(
      player.reloadLeft > 0 ? `${weapon.name}  RELOADING` : `${weapon.name}  ${ammo}/${weapon.magazineSize}`,
    );
    if (player.reloadLeft > 0) {
      const progress = 1 - player.reloadLeft / weapon.reloadDuration;
      const reloadY = insets.top + 54 * u + 18 * u;
      g.fillStyle(0x000000, 0.6);
      g.fillRect(barX, reloadY, barWidth, 5 * u);
      g.fillStyle(0xffe066, 1);
      g.fillRect(barX, reloadY, barWidth * progress, 5 * u);
    }

    // Stealth state: the thing the player most wants to know in the dark.
    const hunted = this.sim.enemies.some((enemy) => enemy.mode === "chase" || enemy.mode === "attack");
    const parts: string[] = [];
    if (hunted) parts.push("SPOTTED");
    if (player.hidden) parts.push("HIDDEN");
    if (this.hint.left > 0) parts.push(this.hint.text);
    this.statusText.setText(parts.join("  ·  "));
    this.statusText.setColor(hunted ? "#ff6b6b" : player.hidden ? "#4fd1a5" : "#ffd23f");

    // Objective and score, top right.
    const remaining = this.sim.loot.filter((entry) => !entry.taken && !entry.spot.main).length;
    const goal = this.sim.hasGold ? "Gold secured: get out the west door" : "Find the gold case";
    const rank = rankFor(this.progress.xp);
    this.objectiveText.setText(`${this.sim.score} pts\n${goal}\n${remaining} valuable${remaining === 1 ? "" : "s"} left\nRANK ${rank.level}`);

    // How wound up the building is: a thin bar under the objective that fills as guards get edgy.
    if (this.sim.caution > 0.02 && status === "playing") {
      const w = 90 * u;
      const x = width - insets.right - 16 * u - w;
      const y = insets.top + 12 * u + 80 * u;
      g.fillStyle(0x000000, 0.55);
      g.fillRect(x, y, w, 4 * u);
      g.fillStyle(alertColor(this.sim.caution), 0.95);
      g.fillRect(x, y, w * this.sim.caution, 4 * u);
    }

    // Banner: the end screens say how it went; a pickup flashes briefly.
    const ended = status !== "playing";
    if (status === "dead") {
      this.bannerText.setText(
        `ELIMINATED\n${this.sim.score} pts  ·  ${Math.round(accuracy(this.sim) * 100)}% accuracy\n${this.rankLine()}\n${this.touch ? "Tap" : "Press R or click"} to try again`,
      );
    } else if (status === "escaped") {
      const taken = this.sim.loot.filter((entry) => entry.taken).length;
      this.bannerText.setText(
        `${rating(this.sim)}\nGold escaped  ·  ${this.sim.score} pts\n${this.sim.kills} down  ·  spotted ${this.sim.timesSpotted}x  ·  ${taken}/${this.sim.loot.length} loot  ·  ${Math.round(this.sim.endedAt ?? this.sim.time)}s\n${this.rankLine()}\n${this.touch ? "Tap" : "Press R or click"} to go again`,
      );
    } else {
      this.bannerText.setText(this.banner.left > 0 ? this.banner.text : "");
    }
    this.bannerText.setFontSize(Math.round((ended ? 22 : this.banner.size ?? 28) * u));
    if (ended) {
      g.fillStyle(0x000000, 0.5);
      g.fillRect(0, 0, width, height);
    }
    this.bannerText.setAlpha(ended ? 1 : Math.min(1, this.banner.left * 2));

    this.drawPointers(g);

    // Touch controls.
    const playing = status === "playing";
    const showControls = this.touch && playing;
    for (const label of Object.values(this.buttonLabels)) label.setVisible(showControls);
    if (!showControls) return;

    this.drawPad(g, this.layoutNow.moveHome, this.moveStick?.fixed ? this.moveStick : null, "move");
    this.drawPad(g, this.layoutNow.aimHome, this.aimPad?.fixed ? this.aimPad : null, "aim");
    // A thumb that landed off the base gets its own floating pad.
    if (this.moveStick && !this.moveStick.fixed) {
      this.drawPad(g, { x: this.moveStick.originX, y: this.moveStick.originY }, this.moveStick, "move");
    }
    if (this.aimPad && !this.aimPad.fixed) {
      this.drawPad(g, { x: this.aimPad.originX, y: this.aimPad.originY }, this.aimPad, "aim");
    }

    const canSwap = this.sim.player.weaponIds.length > 1;
    this.buttonLabels.swap.setText(weapon.name.toUpperCase()).setVisible(canSwap);
    this.buttonLabels.reload.setVisible(false);
    for (const name of BUTTON_NAMES) {
      if (name === "swap" && !canSwap) continue;
      const at = buttons[name];
      g.lineStyle(1.5 * u, 0xffffff, 0.3);
      g.strokeCircle(at.x, at.y, BUTTON_DRAW_RADIUS * u);
    }
    // Reload is an arrow chasing its tail; the weapon button names the gun.
    const r = buttons.reload;
    const arrow = 7 * u;
    g.lineStyle(1.5 * u, 0xffffff, 0.55);
    g.beginPath();
    g.arc(r.x, r.y, arrow, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(220), false);
    g.strokePath();
    const tip = Phaser.Math.DegToRad(220);
    const tx = r.x + Math.cos(tip) * arrow;
    const ty = r.y + Math.sin(tip) * arrow;
    g.fillStyle(0xffffff, 0.55);
    g.fillTriangle(tx - 4 * u, ty - 3 * u, tx + 3 * u, ty - 4 * u, tx + 1 * u, ty + 4 * u);
  }

  /** What the run earned, and anything it unlocked, for the end screen. */
  private rankLine(): string {
    const result = this.result;
    if (!result) return "";
    const rank = rankFor(result.progress.xp);
    const head = `+${result.xp} XP  ·  RANK ${rank.level}${rank.needed > 0 ? `  (${rank.needed - rank.into} to go)` : "  (MAX)"}`;
    return result.unlocked.length > 0 ? `${head}\nUNLOCKED: ${result.unlocked.join(", ")}` : head;
  }

  /**
   * Arrows on the screen edge for what is just out of view: guards close enough
   * to make out, the gold case until it is taken, and the way out once it is.
   */
  private drawPointers(g: Phaser.GameObjects.Graphics): void {
    if (this.sim.status !== "playing") return;
    const { u, width, height, insets } = this.layoutNow;
    const margin = 22 * u;
    const left = insets.left + margin;
    const right = width - insets.right - margin;
    const top = insets.top + margin;
    const bottom = height - insets.bottom - margin;
    const cx = width / 2;
    const cy = height / 2;

    const point = (world: Point, color: number, alpha: number): void => {
      const at = this.worldToScreen(world.x, world.y);
      if (at.x >= left && at.x <= right && at.y >= top && at.y <= bottom) return;
      const dx = at.x - cx;
      const dy = at.y - cy;
      const scale = Math.min((dx >= 0 ? right - cx : cx - left) / Math.max(1, Math.abs(dx)), (dy >= 0 ? bottom - cy : cy - top) / Math.max(1, Math.abs(dy)));
      const x = cx + dx * scale;
      const y = cy + dy * scale;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      g.fillStyle(color, alpha);
      g.fillTriangle(
        x + ux * 9 * u,
        y + uy * 9 * u,
        x - ux * 5 * u - uy * 7 * u,
        y - uy * 5 * u + ux * 7 * u,
        x - ux * 5 * u + uy * 7 * u,
        y - uy * 5 * u - ux * 7 * u,
      );
    };

    for (const { enemy, strength } of sensedEnemies(this.sim.player.pos, this.sim.enemies)) {
      const alert = enemy.mode === "chase" || enemy.mode === "attack";
      point(enemy.pos, alert ? 0xff3030 : ENEMY_GLOW, 0.9 * strength);
    }
    const main = this.sim.loot.find((entry) => entry.spot.main && !entry.taken);
    if (main) point(main.spot.pos, 0xffd23f, 0.9);
    if (this.sim.hasGold) {
      const zone = this.sim.arena.exit.zone;
      point({ x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 }, 0x5ee0a0, 0.95);
    }
  }

  /**
   * A pad's base ring and knob, kept faint so the map shows through. Idle, it is a
   * thin ring and a dot; held, it brightens. The aim dot rests toward where the gun points.
   */
  private drawPad(g: Phaser.GameObjects.Graphics, home: Point, pad: Pad | null, kind: "move" | "aim"): void {
    const { u } = this.layoutNow;
    const held = pad !== null;
    const radius = kind === "aim" ? AIM_RADIUS : STICK_RADIUS;
    const rest = kind === "aim" ? { x: Math.cos(this.aimAngle) * 0.5, y: Math.sin(this.aimAngle) * 0.5 } : { x: 0, y: 0 };
    const vector = held ? this.padVector(pad, radius) : rest;
    g.lineStyle(1.5 * u, 0xffffff, held ? 0.4 : 0.16);
    g.strokeCircle(home.x, home.y, radius * u);

    const kx = home.x + vector.x * radius * u;
    const ky = home.y + vector.y * radius * u;
    const tint = kind === "aim" ? COLORS.laser : 0xffffff;
    g.fillStyle(tint, held ? 0.5 : 0.22);
    g.fillCircle(kx, ky, (held ? KNOB_RADIUS : KNOB_RADIUS * 0.45) * u);
    if (held) {
      g.lineStyle(1.5 * u, 0xffffff, 0.6);
      g.strokeCircle(kx, ky, KNOB_RADIUS * u);
    }
  }
}
