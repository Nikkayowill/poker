import * as Phaser from "phaser";
import { ARENA, BARRELS, PICKUPS, PLAYER_GLOW, SENSE } from "@/lib/stackstrike/content";
import { StackStrikeAudio } from "./stackstrike-audio";
import { recordAim, releaseShot, type AimSample } from "@/lib/stackstrike/aim";
import { PLAYER_STRIDE, playerStep, readStrain, StepCounter, cuesFor, type Cue, type CueContext } from "@/lib/stackstrike/audio";
import { isDisc, isPoly, lineOfSight, segmentWallHit } from "@/lib/stackstrike/geometry";
import { PERKS } from "@/lib/stackstrike/content";
import { applyRun, loadoutFor, loadProgress, rankFor, saveProgress, type Progress, type RunResult } from "@/lib/stackstrike/progress";
import {
  accuracy,
  choosePerk,
  comboMultiplier,
  createState,
  currentWeapon,
  enemyDef,
  magazineSize,
  redrawOffer,
  skipOffer,
  STEP_SECONDS,
  step,
} from "@/lib/stackstrike/sim";
import type { DifficultyId, EnemyState, Light, LightTone, PickupKind, PlayerInput, SimEvent, SimState } from "@/lib/stackstrike/types";
import { ARM_PX, bodyToWorld, FISTS, GUN_ART, handOffset, handsOnGun, pixelScale, segmentBetween, SHOULDERS, solveArm, walkSway, type Pt as BodyPt } from "@/lib/stackstrike/sprites";
import { angleDiff, assistAim, glowPolygon, roomAt, sensedEnemies } from "@/lib/stackstrike/vision";

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
 * The world is dark, lit only by a small glow round the player, the room they
 * stand in and the lamps. It is a wave shooter: zombies walk in from the
 * spawns in numbered waves, the crowd grows every wave, and a brute lumbers in
 * every fifth. Kills fill an XP bar; each level pauses the fight on three cards
 * (three redraws a run, or skip). Zombies within sensing range are drawn glowing
 * green over the dark, through walls, fading toward the edge of the range; near
 * ones just off screen get an arrow on the edge. The laser is draw-only.
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

const ENEMY_COLORS: Record<string, number> = { walker: 0x7fbf6a, runner: 0xc9d96a, bloater: 0xb7e05a, armored: 0x8fb4d8, brute: 0x4f8a48 };

const ART = "/stackstrike/art";
/** Every zombie is one grey drawing with its arms out (made from the guard art by scripts/stackstrike-zombies.py), tinted green; the kind changes the shade. */
const ENEMY_TINT: Record<string, number> = { walker: 0x86d46a, runner: 0xcfe85a, bloater: 0xd2f06a, armored: 0xa9c7e6, brute: 0x4fa84a };
const PICKUP_COLORS: Record<PickupKind, number> = { health: 0x5ee0a0, bomb: 0xff9f43, frenzy: 0xffe066, double: 0xd58cff, shield: 0x63e6ff };

/** Leading upper arm, trigger upper arm, leading forearm, trigger forearm. Forearms end in a glove. */
type ArmRig = Phaser.GameObjects.Image[];
const ARM_TEXTURE_WIDTH = ARM_PX + 18;

interface EnemySprite {
  body: Phaser.GameObjects.Image;
  arms: ArmRig;
  last: Point;
  moving: boolean;
}
const ENEMY_GLOW = 0x7dff6a;

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
const ROOM_LIGHT = 0.12;
/** Rings a lamp's pool is drawn in, outermost first, each clearing a little more of the dark. */
const LAMP_RINGS = [1, 0.8, 0.6, 0.4, 0.2];
const LAMP_RING_ALPHA = 0.17;
const LAMP_TINT: Record<LightTone, number> = { warm: 0xffc880, cool: 0x9db8ff, red: 0xff4a38, blue: 0x62c8ff };

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

export class StackStrikeScene extends Phaser.Scene {
  private sim: SimState;
  private accumulator = 0;
  private diedAt = 0;
  /** When the card choice came up, so a thumb still down from the fight cannot pick one by accident. */
  private offerShownAt = 0;
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
  /** Rings and marks, drawn over the zombies' sprites. */
  private enemyTop!: Phaser.GameObjects.Graphics;
  private playerSprite!: Phaser.GameObjects.Image;
  private playerGun!: Phaser.GameObjects.Image;
  private playerArms!: ArmRig;

  private audio!: StackStrikeAudio;
  private muted = false;
  private playerSteps = new StepCounter(PLAYER_STRIDE);
  private lastPlayerPos: Point | null = null;
  private lastWeapon = 0;
  /** The names of the last sounds played, for tests. */
  private heard: string[] = [];
  private enemySprites = new Map<number, EnemySprite>();
  private tint!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private healthText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private offerTexts!: { header: Phaser.GameObjects.Text; titles: Phaser.GameObjects.Text[]; blurbs: Phaser.GameObjects.Text[]; redraw: Phaser.GameObjects.Text; skip: Phaser.GameObjects.Text };
  private bannerText!: Phaser.GameObjects.Text;
  private buttonLabels!: Record<ButtonName, Phaser.GameObjects.Text>;

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
  /** `?fps` in the address shows the frame rate, for checking a real phone. */
  private showFps = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("fps");

  private particles: Particle[] = [];
  /** Stains left where zombies fell and barrels went off. They fade. */
  private splats: { x: number; y: number; r: number; life: number; max: number; color: number; alpha: number }[] = [];
  /** A few text objects reused for the "+100" that floats up from a kill. */
  private popups: { text: Phaser.GameObjects.Text; x: number; y: number; life: number }[] = [];
  /** Who can be made out this frame, worked out once and shared by everything that draws zombies. */
  private sensed: { enemy: EnemyState; strength: number }[] = [];
  /** Lamp light shapes. The lamps and walls never move, so each is cut once. */
  /** Set when frames have been slow for a while: the scene then draws cheaper (fewer lamp rings and particles) for the rest of the session. */
  private lowQuality = false;
  private slowFor = 0;
  private lampCache = new Map<Light, { rings: Point[][]; edge: Point[]; core: Point[] }>();
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

  /** A fresh run in the compound, with the guns this rank has earned. */
  private newRun(): SimState {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const level = rankFor(this.progress.xp).level;
    return createState(seed, "vanguard", ARENA, this.options.difficulty, loadoutFor(level));
  }

  preload(): void {
    this.load.image("operative", `${ART}/operative.png`);
    this.load.image("zombie", `${ART}/zombie.png`);
    for (const kind of ["operative", "zombie"]) {
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
    this.levelText = text().setOrigin(0.5, 0);
    this.offerTexts = {
      header: text().setOrigin(0.5),
      titles: [0, 1, 2].map(() => text().setOrigin(0.5, 0).setAlign("center")),
      blurbs: [0, 1, 2].map(() => text().setOrigin(0.5, 0).setAlign("center").setFontStyle("normal")),
      redraw: text().setOrigin(0.5),
      skip: text().setOrigin(0.5),
    };
    for (let n = 0; n < 10; n += 1) this.popups.push({ text: text().setOrigin(0.5).setVisible(false), x: 0, y: 0, life: 0 });
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
      this.levelText,
      this.offerTexts.header,
      ...this.offerTexts.titles,
      ...this.offerTexts.blurbs,
      this.offerTexts.redraw,
      this.offerTexts.skip,
      ...this.popups.map((popup) => popup.text),
      ...Object.values(this.buttonLabels),
    ]);

    // The HUD and the dark are drawn by their own camera at 1:1 so the world
    // camera's zoom never scales them.
    this.hudCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.hudLayer);
    this.hudCamera.ignore(this.worldLayer);

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
        offerRects: () => this.offerRects(),
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
    // Frames slower than about 30 fps for two seconds' worth: draw cheaper.
    this.slowFor = deltaMs > 34 ? this.slowFor + frame : Math.max(0, this.slowFor - frame * 2);
    if (this.slowFor > 2) this.lowQuality = true;
    this.accumulator += frame;
    while (this.accumulator >= STEP_SECONDS) {
      this.accumulator -= STEP_SECONDS;
      const input = this.readInput();
      this.reloadQueued = false;
      this.selectQueued = null;
      const before = this.sim.status;
      step(this.sim, input);
      for (const event of this.sim.events) {
        this.react(event);
        this.hear(this.cueContext(), event);
      }
      if (before !== "dead" && this.sim.status === "dead") {
        this.diedAt = this.time.now;
        this.result = applyRun(this.progress, this.sim);
        this.progress = this.result.progress;
        saveProgress(this.progress);
      }
      if (before === "playing" && this.sim.status === "perk") {
        // Hands off the glass: whatever the thumbs were doing, the cards take over.
        this.moveStick = null;
        this.aimPad = null;
        this.fireBuffer = 0;
        this.offerShownAt = this.time.now;
        break;
      }
    }

    this.updateAudio(frame);
    this.fireBuffer = Math.max(0, this.fireBuffer - frame);
    if (this.hint.left > 0) this.hint.left -= frame;
    this.updateParticles(frame);
    this.updateCamera(frame);
    this.sensed = sensedEnemies(this.sim.player.pos, this.sim.enemies);
    this.updatePopups(frame);
    this.drawWorld();
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
    if (playing && player.moving && this.playerSteps.advance(moved) > 0) this.playCues([playerStep(ctx.roll)]);

    if (player.weaponIndex !== this.lastWeapon) {
      this.lastWeapon = player.weaponIndex;
      if (playing) this.playCues([{ name: "swap", volume: 0.6, rate: 1, pan: 0, delay: 0 }]);
    }

    this.audio.update(frame, {
      hunted: enemies.length > 0,
      strain: readStrain(player.health, player.maxHealth),
      ending: status === "dead" ? "dead" : "none",
    });
  }

  /* ----------------------------------------------------------------- input */

  private setupInput(): void {
    this.input.addPointer(2);
    this.input.mouse?.disableContextMenu();

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
      keyboard.on("keydown-R", () => {
        if (this.sim.status === "dead") this.restart();
        else if (this.sim.status === "perk") redrawOffer(this.sim);
        else this.reloadQueued = true;
      });
      keyboard.on("keydown-X", () => {
        if (this.sim.status === "perk") skipOffer(this.sim);
      });
      const number = (index: number): void => {
        if (this.sim.status === "perk") choosePerk(this.sim, index);
        else this.selectQueued = index;
      };
      keyboard.on("keydown-ONE", () => number(0));
      keyboard.on("keydown-TWO", () => number(1));
      keyboard.on("keydown-THREE", () => number(2));
    }

    this.input.on("wheel", (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.cycleWeapon(dy > 0 ? 1 : -1);
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.paused) return;
      if (this.sim.status === "perk") {
        this.tapOffer(pointer.x, pointer.y);
        return;
      }
      if (this.sim.status === "dead") {
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

  /** Where the three cards and the two buttons sit on screen. */
  private offerRects(): { cards: { x: number; y: number; w: number; h: number }[]; redraw: { x: number; y: number; w: number; h: number }; skip: { x: number; y: number; w: number; h: number } } {
    const { u, width, height } = this.layoutNow;
    const gap = 12 * u;
    const w = Math.min(190 * u, (width - 48 * u - gap * 2) / 3);
    const h = 118 * u;
    const left = (width - (w * 3 + gap * 2)) / 2;
    const top = height / 2 - 78 * u;
    const cards = [0, 1, 2].map((n) => ({ x: left + n * (w + gap), y: top, w, h }));
    const bw = 130 * u;
    const bh = 34 * u;
    const by = top + h + 16 * u;
    return {
      cards,
      redraw: { x: width / 2 - bw - gap / 2, y: by, w: bw, h: bh },
      skip: { x: width / 2 + gap / 2, y: by, w: bw, h: bh },
    };
  }

  /** A tap on the card screen: pick a card, redraw the hand, or skip. */
  private tapOffer(x: number, y: number): void {
    if (this.time.now - this.offerShownAt < 350) return;
    const inside = (r: { x: number; y: number; w: number; h: number }): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const rects = this.offerRects();
    const card = rects.cards.findIndex(inside);
    if (card >= 0) choosePerk(this.sim, card);
    else if (inside(rects.redraw)) redrawOffer(this.sim);
    else if (inside(rects.skip)) skipOffer(this.sim);
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
    }
    this.enemySprites.clear();
    this.result = null;
    this.audio.reset();
    this.playerSteps.reset();
    this.lastPlayerPos = null;
    this.lastWeapon = this.sim.player.weaponIndex;
    this.aimAngle = 0;
    this.fireBuffer = 0;
    this.hint.left = 0;
    this.particles = [];
    this.splats = [];
    for (const entry of this.popups) {
      entry.life = 0;
      entry.text.setVisible(false);
    }
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
        this.burst(event.pos.x, event.pos.y, 3, 0xffe066, 60, 0.08);
        break;
      case "hit":
        this.burst(event.pos.x, event.pos.y, 5, event.target === "enemy" ? 0xc8ffb8 : 0xff4d4d, 120, 0.25);
        if (event.target === "player") this.cameras.main.shake(90, 0.004);
        break;
      case "wall":
        this.burst(event.pos.x, event.pos.y, 3, 0x9fb0c8, 80, 0.2);
        break;
      case "kill": {
        const color = ENEMY_COLORS[event.defId] ?? 0x7fbf6a;
        this.burst(event.pos.x, event.pos.y, 12, color, 200, 0.5);
        const def = enemyDef(event.defId);
        this.addSplat(event.pos.x, event.pos.y, def.radius * 1.2, color, 0.3, 7);
        const mult = event.points / def.score;
        this.popup(event.pos, `+${event.points}`, mult >= 3 ? "#ffd23f" : mult >= 2 ? "#ffe9a8" : "#d9ffcf", def.id === "brute" ? 22 : 14);
        break;
      }
      case "barrel":
        this.burst(event.pos.x, event.pos.y, 50, 0xff8a3d, 460, 0.65);
        this.addSplat(event.pos.x, event.pos.y, BARRELS.blastRadius * 0.45, 0x0b0b0b, 0.55, 14);
        this.cameras.main.shake(220, 0.008);
        break;
      case "burst":
        this.burst(event.pos.x, event.pos.y, this.lowQuality ? 14 : 30, 0xb7e05a, 300, 0.55);
        this.addSplat(event.pos.x, event.pos.y, event.radius * 0.5, 0x9fd13a, 0.32, 9);
        this.cameras.main.shake(120, 0.005);
        break;
      case "waveclear":
        this.banner = { text: `WAVE ${event.number} CLEARED\n+${event.bonus}`, left: 2.4, size: 26 };
        break;
      case "pickup": {
        this.burst(event.pos.x, event.pos.y, 14, PICKUP_COLORS[event.kind], 150, 0.6);
        const text = { health: "+HEALTH", bomb: "BOOM", frenzy: "ADRENALINE", double: "DOUBLE POINTS", shield: "SHIELD" }[event.kind];
        this.hint = { text, left: 1.6 };
        break;
      }
      case "wave": {
        const brute = event.number % 5 === 0;
        this.banner = { text: brute ? `WAVE ${event.number}\nA BRUTE IS COMING` : `WAVE ${event.number}`, left: 2.2, size: 30 };
        break;
      }
      case "levelup":
        this.hint = { text: `LEVEL ${event.level}`, left: 1.6 };
        break;
      case "bomb":
        this.burst(event.pos.x, event.pos.y, 60, 0xffb347, 520, 0.7);
        this.cameras.main.shake(260, 0.01);
        this.cameras.main.flash(180, 255, 220, 160);
        break;
      case "dead":
        this.cameras.main.shake(300, 0.012);
        break;
      case "reload":
        break;
    }
  }

  private addSplat(x: number, y: number, r: number, color: number, alpha: number, life: number): void {
    this.splats.push({ x, y, r, life, max: life, color, alpha });
    if (this.splats.length > 70) this.splats.splice(0, this.splats.length - 70);
  }

  /** A short "+100" that floats up from where something fell. */
  private popup(at: Point, label: string, color: string, size: number): void {
    const free = this.popups.find((entry) => entry.life <= 0) ?? this.popups.reduce((oldest, entry) => (entry.life < oldest.life ? entry : oldest));
    free.x = at.x;
    free.y = at.y;
    free.life = 0.9;
    free.text.setText(label).setColor(color).setFontSize(Math.round(size * this.layoutNow.u)).setVisible(true);
  }

  private updatePopups(frame: number): void {
    for (const entry of this.popups) {
      if (entry.life <= 0) continue;
      entry.life -= frame;
      if (entry.life <= 0) {
        entry.text.setVisible(false);
        continue;
      }
      entry.y -= 38 * frame;
      const at = this.worldToScreen(entry.x, entry.y);
      entry.text.setPosition(at.x, at.y).setAlpha(Math.min(1, entry.life * 3));
    }
    for (const splat of this.splats) splat.life -= frame;
    this.splats = this.splats.filter((splat) => splat.life > 0);
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
    const cap = this.lowQuality ? 120 : 400;
    if (this.particles.length > cap) this.particles.splice(0, this.particles.length - cap);
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
    this.levelText.setFontSize(Math.round(11 * u)).setOrigin(0.5, 1).setPosition(width / 2, height - insets.bottom - 22 * u);
    const rects = this.offerRects();
    this.offerTexts.header.setFontSize(Math.round(16 * u)).setPosition(width / 2, rects.cards[0].y - 24 * u);
    rects.cards.forEach((card, n) => {
      const pad = 10 * u;
      this.offerTexts.titles[n].setFontSize(Math.round(15 * u)).setPosition(card.x + card.w / 2, card.y + 14 * u).setWordWrapWidth(card.w - pad * 2);
      this.offerTexts.blurbs[n].setFontSize(Math.round(12 * u)).setPosition(card.x + card.w / 2, card.y + 46 * u).setWordWrapWidth(card.w - pad * 2);
    });
    this.offerTexts.redraw.setFontSize(Math.round(13 * u)).setPosition(rects.redraw.x + rects.redraw.w / 2, rects.redraw.y + rects.redraw.h / 2);
    this.offerTexts.skip.setFontSize(Math.round(13 * u)).setPosition(rects.skip.x + rects.skip.w / 2, rects.skip.y + rects.skip.h / 2);
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
      g.lineStyle(2, COLORS.wallEdge, 1);
      if (isDisc(wall)) {
        g.fillCircle(wall.x, wall.y, wall.r);
        g.strokeCircle(wall.x, wall.y, wall.r);
      } else if (isPoly(wall)) {
        g.fillPoints(wall.points, true);
        g.strokePoints(wall.points, true);
      } else {
        g.fillRect(wall.x, wall.y, wall.w, wall.h);
        g.strokeRect(wall.x, wall.y, wall.w, wall.h);
      }
    }

  }

  private drawWorld(): void {
    const g = this.world;
    const { projectiles, player } = this.sim;
    g.clear();

    for (const splat of this.splats) {
      const fade = splat.life / splat.max;
      g.fillStyle(splat.color, splat.alpha * Math.min(1, fade * 1.6));
      g.fillCircle(splat.x, splat.y, splat.r);
      g.fillCircle(splat.x + splat.r * 0.7, splat.y - splat.r * 0.3, splat.r * 0.45);
      g.fillCircle(splat.x - splat.r * 0.5, splat.y + splat.r * 0.6, splat.r * 0.35);
    }
    for (const barrel of this.sim.barrels) {
      const { x, y } = barrel.pos;
      g.fillStyle(0x000000, 0.35);
      g.fillCircle(x + 2, y + 3, BARRELS.radius);
      g.fillStyle(0xc4532a, 1);
      g.fillCircle(x, y, BARRELS.radius);
      g.lineStyle(2, 0x3a1608, 1);
      g.strokeCircle(x, y, BARRELS.radius);
      g.fillStyle(0xe8793a, 1);
      g.fillCircle(x, y, BARRELS.radius * 0.62);
      g.fillStyle(0xffd23f, 1);
      g.fillRect(x - 2, y - 6, 4, 8);
      g.fillCircle(x, y + 6, 2);
    }

    this.drawPlayerSprite();
    // A faint ring round the player, in the frenzy colour while adrenaline lasts.
    const shielded = this.sim.shieldLeft > 0;
    const ringColor = shielded ? PICKUP_COLORS.shield : this.sim.frenzyLeft > 0 ? PICKUP_COLORS.frenzy : 0xffffff;
    g.lineStyle(shielded ? 4 : 2, ringColor, shielded ? 0.55 + 0.4 * Math.sin(this.time.now / 90) ** 2 : this.sim.frenzyLeft > 0 ? 0.7 : 0.12);
    g.strokeCircle(player.pos.x, player.pos.y, player.radius + (shielded ? 12 : 9));

    // Bullets are bright whatever the light, so they can be followed.
    for (const shot of projectiles) {
      const tail = 0.025;
      g.lineStyle(2.5, COLORS.playerShot, 1);
      g.lineBetween(shot.pos.x - shot.vel.x * tail, shot.pos.y - shot.vel.y * tail, shot.pos.x, shot.pos.y);
    }

    for (const particle of this.particles) {
      g.fillStyle(particle.color, particle.life / particle.max);
      g.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
  }

  /** The four arm pieces for one character, hidden until posed. */
  private makeArms(kind: "operative" | "zombie"): ArmRig {
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
    const alpha = 1;
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
   * One sprite per zombie that can be made out: the guard's drawing tinted green,
   * arms out in front, shuffling a little as it walks. They sit over the dark in
   * screen space, like the glows beneath them.
   */
  private syncEnemySprites(): void {
    const zoom = this.zoom;
    const seconds = this.time.now / 1000;
    const visible = new Map<number, number>();
    for (const { enemy, strength } of this.sensed) visible.set(enemy.id, strength);

    for (const enemy of this.sim.enemies) {
      let sprite = this.enemySprites.get(enemy.id);
      if (!sprite) {
        const body = this.add.image(0, 0, "zombie");
        const arms = this.makeArms("zombie");
        const at = this.hudLayer.getIndex(this.enemyTop);
        this.hudLayer.addAt(body, at);
        arms.forEach((arm, index) => this.hudLayer.addAt(arm, at + 1 + index));
        sprite = { body, arms, last: { ...enemy.pos }, moving: false };
        this.enemySprites.set(enemy.id, sprite);
      }
      const fade = visible.get(enemy.id);
      if (fade === undefined) {
        sprite.body.setVisible(false);
        for (const arm of sprite.arms) arm.setVisible(false);
        sprite.last = { ...enemy.pos };
        continue;
      }
      const def = enemyDef(enemy.defId);
      const moved = Math.hypot(enemy.pos.x - sprite.last.x, enemy.pos.y - sprite.last.y) > 0.05;
      sprite.moving = moved;
      sprite.last = { ...enemy.pos };
      const sway = walkSway(seconds + enemy.id * 0.37, moved) * 1.6;
      const scale = pixelScale(def.radius) * zoom;
      const at = this.worldToScreen(enemy.pos.x, enemy.pos.y);
      const bodyAngle = enemy.facing + sway;
      sprite.body.setVisible(true).setPosition(at.x, at.y).setRotation(bodyAngle).setScale(scale).setAlpha(fade);
      this.poseArms(sprite.arms, at, bodyAngle, enemy.facing, scale, FISTS);
      const tint = ENEMY_TINT[enemy.defId] ?? 0x9fd18a;
      for (const part of [sprite.body, ...sprite.arms]) {
        part.setAlpha(fade);
        if (enemy.hurt > 0) part.setTintFill(0xffffff);
        else part.setTint(tint);
      }
    }

    const alive = new Set(this.sim.enemies.map((enemy) => enemy.id));
    for (const [id, sprite] of this.enemySprites) {
      if (alive.has(id)) continue;
      sprite.body.destroy();
      for (const arm of sprite.arms) arm.destroy();
      this.enemySprites.delete(id);
    }
  }

  /**
   * Every zombie within sensing range glows green over the dark, and the pickups
   * on the floor glow in their own colour, so the player is never guessing where
   * things are. A brute carries a health bar, since it takes a lot of shooting.
   */
  private drawEnemies(): void {
    const g = this.enemyGfx;
    const { pickups, barrels, player } = this.sim;
    const { width, height } = this.layoutNow;
    const zoom = this.zoom;
    const top = this.enemyTop;
    for (const layer of [g, top]) layer.setPosition(width / 2 - this.cam.x * zoom, height / 2 - this.cam.y * zoom).setScale(zoom);
    g.clear();
    top.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 220);

    for (const pickup of pickups) {
      // Blinks over the last few seconds before it is gone.
      if (pickup.left < 3 && Math.floor(pickup.left * 6) % 2 === 0) continue;
      const color = PICKUP_COLORS[pickup.kind];
      const { x, y } = pickup.pos;
      g.fillStyle(color, 0.1 + 0.1 * pulse);
      g.fillCircle(x, y, PICKUPS.radius * 2.2);
      g.fillStyle(color, 0.95);
      g.fillCircle(x, y, PICKUPS.radius * 0.55);
      g.lineStyle(2, 0xffffff, 0.8);
      g.strokeCircle(x, y, PICKUPS.radius * 0.55);
      g.fillStyle(0x10141a, 1);
      const r = PICKUPS.radius * 0.3;
      if (pickup.kind === "health") {
        g.fillRect(x - r, y - r * 0.3, r * 2, r * 0.6);
        g.fillRect(x - r * 0.3, y - r, r * 0.6, r * 2);
      } else if (pickup.kind === "bomb") {
        g.fillCircle(x, y, r);
      } else if (pickup.kind === "double") {
        // Two stacked bars: x2.
        g.fillRect(x - r, y - r * 0.9, r * 2, r * 0.6);
        g.fillRect(x - r, y + r * 0.3, r * 2, r * 0.6);
      } else if (pickup.kind === "shield") {
        g.fillTriangle(x - r, y - r * 0.8, x + r, y - r * 0.8, x, y + r);
      } else {
        g.fillTriangle(x + r * 0.2, y - r, x - r * 0.8, y + r * 0.2, x + r * 0.1, y + r * 0.2);
        g.fillTriangle(x - r * 0.2, y + r, x + r * 0.8, y - r * 0.2, x - r * 0.1, y - r * 0.2);
      }
    }

    // A barrel in the dark is easy to miss and easy to wreck, so it glows warning-orange when it is near.
    for (const barrel of barrels) {
      const away = Math.hypot(barrel.pos.x - player.pos.x, barrel.pos.y - player.pos.y);
      if (away > SENSE.range) continue;
      g.fillStyle(0xff8a3d, 0.08 + 0.06 * pulse);
      g.fillCircle(barrel.pos.x, barrel.pos.y, BARRELS.radius * 2.6);
      g.lineStyle(2, 0xffb36b, 0.55);
      g.strokeCircle(barrel.pos.x, barrel.pos.y, BARRELS.radius + 4);
    }

    for (const { enemy, strength: fade } of this.sensed) {
      const def = enemyDef(enemy.defId);
      const { x, y } = enemy.pos;
      for (const [scale, alpha] of [
        [2.4, 0.1],
        [1.5, 0.2],
      ] as const) {
        g.fillStyle(ENEMY_GLOW, alpha * fade);
        g.fillCircle(x, y, def.radius * scale);
      }
      g.lineStyle(2, ENEMY_GLOW, 0.8 * fade);
      g.strokeCircle(x, y, def.radius + 1);
      if (def.burst && Math.hypot(x - player.pos.x, y - player.pos.y) < def.burst.radius * 3) {
        // How far its burst reaches, drawn while it is near enough to matter.
        g.lineStyle(2, 0xd2f06a, (0.25 + 0.2 * pulse) * fade);
        g.strokeCircle(x, y, def.burst.radius);
      }
      if (def.armor < 1) {
        // Riot gear: a steel ring that says shots will not all count.
        g.lineStyle(3, 0xa9c7e6, 0.95 * fade);
        g.strokeCircle(x, y, def.radius + 4);
      }
      if (def.id === "brute" && enemy.health < enemy.maxHealth) {
        const w = def.radius * 2;
        top.fillStyle(0x000000, 0.7);
        top.fillRect(x - w / 2 - 1, y - def.radius - 12, w + 2, 6);
        top.fillStyle(0xff6b6b, 1);
        top.fillRect(x - w / 2, y - def.radius - 11, w * (enemy.health / enemy.maxHealth), 4);
      }
    }
  }

  /** Blacks the screen out, then erases the lamps, the room the player is in and the glow around them. */
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

    this.drawLamps(erase);

    // The glow keeps the area right around the player readable.
    const glow = glowPolygon(player.pos, arena.walls);
    erase(glow, 0.85);
    erase(glowPolygon(player.pos, arena.walls, PLAYER_GLOW.radius * 0.5), 0.9);

    this.drawLaser();
  }

  /**
   * Every lamp that is on screen: its pool clears the dark in rings that stop at walls, and a faint tint
   * on top shows its colour. The sim's `lightAt` uses the same lamps, so the dark you see is the dark you can hide in.
   */
  private drawLamps(erase: (poly: Point[], alpha: number) => void): void {
    const { arena } = this.sim;
    const reach = Math.hypot(this.scale.width, this.scale.height) / (2 * this.zoom);
    for (const light of arena.lights) {
      if (Math.hypot(light.pos.x - this.cam.x, light.pos.y - this.cam.y) > reach + light.radius) continue;
      let shapes = this.lampCache.get(light);
      if (!shapes) {
        shapes = {
          rings: LAMP_RINGS.map((ring) => glowPolygon(light.pos, arena.walls, light.radius * ring, 40)),
          edge: glowPolygon(light.pos, arena.walls, light.radius, 40),
          core: glowPolygon(light.pos, arena.walls, light.radius * 0.45, 32),
        };
        this.lampCache.set(light, shapes);
      }
      if (this.lowQuality) {
        // Half the rings, each twice as strong, and no colour wash: the pool looks much the same for far less work.
        shapes.rings.forEach((ring, index) => {
          if (index % 2 === 0) erase(ring, LAMP_RING_ALPHA * 2);
        });
        continue;
      }
      for (const ring of shapes.rings) erase(ring, LAMP_RING_ALPHA);
      this.tint.fillStyle(LAMP_TINT[light.tone], 0.07);
      this.tint.fillPoints(shapes.edge.map((p) => this.worldToScreen(p.x, p.y)), true);
      this.tint.fillPoints(shapes.core.map((p) => this.worldToScreen(p.x, p.y)), true);
    }
  }

  /**
   * A laser sight, so the player can see where a shot will go on a dark map.
   * It is drawn over the darkness and only on this screen: the sim never reads
   * it, so no enemy can see it. Stops at the first wall.
   */
  private drawLaser(): void {
    const { player, arena } = this.sim;
    if (this.sim.status !== "playing") return;
    const reach = Math.min(currentWeapon(this.sim).range, LASER_RANGE);
    const from = {
      x: player.pos.x + Math.cos(player.aim) * (player.radius + 4),
      y: player.pos.y + Math.sin(player.aim) * (player.radius + 4),
    };
    const far = { x: player.pos.x + Math.cos(player.aim) * reach, y: player.pos.y + Math.sin(player.aim) * reach };
    let nearest = 1;
    for (const wall of arena.walls) {
      const t = segmentWallHit(from, far, wall);
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
    const { player, status, wave, combo, xp } = this.sim;
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
    g.fillRect(barX, barY, barWidth * Math.max(0, player.health / player.maxHealth), 10 * u);
    this.healthText.setText(`HP ${Math.ceil(player.health)}`);

    // Weapon and ammo under the health bar, with the reload bar beneath when reloading.
    const ammo = player.ammo[player.weaponIndex];
    this.weaponText.setText(player.reloadLeft > 0 ? `${weapon.name}  RELOADING` : `${weapon.name}  ${ammo}/${magazineSize(this.sim, weapon)}`);
    if (player.reloadLeft > 0) {
      const progress = 1 - player.reloadLeft / weapon.reloadDuration;
      const reloadY = insets.top + 54 * u + 18 * u;
      g.fillStyle(0x000000, 0.6);
      g.fillRect(barX, reloadY, barWidth, 5 * u);
      g.fillStyle(0xffe066, 1);
      g.fillRect(barX, reloadY, barWidth * progress, 5 * u);
    }

    // Streak and power-ups, under the weapon.
    const parts: string[] = [];
    if (combo.count >= 2) parts.push(`${combo.count} STREAK x${comboMultiplier(combo.count)}`);
    if (this.sim.frenzyLeft > 0) parts.push(`ADRENALINE ${Math.ceil(this.sim.frenzyLeft)}s`);
    if (this.sim.doubleLeft > 0) parts.push(`DOUBLE POINTS ${Math.ceil(this.sim.doubleLeft)}s`);
    if (this.sim.shieldLeft > 0) parts.push(`SHIELD ${Math.ceil(this.sim.shieldLeft)}s`);
    if (this.hint.left > 0) parts.push(this.hint.text);
    if (this.showFps) parts.push(`${Math.round(this.game.loop.actualFps)} fps${this.lowQuality ? " low" : ""}`);
    this.statusText.setText(parts.join("  ·  "));
    this.statusText.setColor(this.sim.shieldLeft > 0 ? "#63e6ff" : this.sim.doubleLeft > 0 ? "#d58cff" : this.sim.frenzyLeft > 0 ? "#ffe066" : "#9fe870");

    // Wave and score, top right.
    const left = wave.queue.length + this.sim.enemies.length;
    const next = left === 0 && wave.breakLeft > 0 ? `WAVE ${wave.number + 1} IN ${Math.ceil(wave.breakLeft)}` : `${left} zombie${left === 1 ? "" : "s"} left`;
    this.objectiveText.setText(`WAVE ${Math.max(1, wave.number)}\n${this.sim.score} pts\n${next}`);

    // XP bar along the bottom, between the two pads.
    const bw = Math.min(260 * u, width * 0.3);
    const bx = (width - bw) / 2;
    const by = height - insets.bottom - 18 * u;
    g.fillStyle(0x000000, 0.55);
    g.fillRect(bx, by, bw, 8 * u);
    g.fillStyle(0x63e6ff, 1);
    g.fillRect(bx, by, bw * Math.min(1, xp.into / xp.needed), 8 * u);
    this.levelText.setText(`LEVEL ${xp.level}`);

    // Banner: wave starts flash briefly; the end screen says how it went.
    const ended = status === "dead";
    if (ended) {
      this.bannerText.setText(
        `OVERRUN\nWave ${wave.number}  ·  ${this.sim.score} pts  ·  ${this.sim.kills} down\nBest streak ${this.sim.best.combo}  ·  ${Math.round(accuracy(this.sim) * 100)}% accuracy\n${this.rankLine()}\n${this.touch ? "Tap" : "Press R or click"} to try again`,
      );
    } else {
      this.bannerText.setText(this.banner.left > 0 && status === "playing" ? this.banner.text : "");
    }
    this.bannerText.setFontSize(Math.round((ended ? 22 : this.banner.size ?? 28) * u));
    if (ended) {
      g.fillStyle(0x000000, 0.5);
      g.fillRect(0, 0, width, height);
    }
    this.bannerText.setAlpha(ended ? 1 : Math.min(1, this.banner.left * 2));

    this.drawVignette(g);
    this.drawOffer(g);
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

  /** A red edge that pulses when health is low and flashes when something bites, so a close call is felt without reading the bar. */
  private drawVignette(g: Phaser.GameObjects.Graphics): void {
    const { player, status } = this.sim;
    if (status !== "playing") return;
    const ratio = player.health / player.maxHealth;
    const low = Math.max(0, 1 - ratio / 0.4);
    const bite = player.hurt > 0 ? player.hurt / 0.15 : 0;
    const strength = Math.max(low * (0.6 + 0.25 * Math.sin(this.time.now / 140)), bite * 0.55);
    if (strength < 0.03) return;
    const { u, width, height } = this.layoutNow;
    for (let n = 0; n < 6; n += 1) {
      const t = (8 + n * 12) * u;
      g.fillStyle(0xff2020, strength * 0.1);
      g.fillRect(0, 0, width, t);
      g.fillRect(0, height - t, width, t);
      g.fillRect(0, t, t, height - t * 2);
      g.fillRect(width - t, t, t, height - t * 2);
    }
  }

  /** The level-up card screen: a dimmed field, three cards, and redraw and skip. */
  private drawOffer(g: Phaser.GameObjects.Graphics): void {
    const { offer, status } = this.sim;
    const show = status === "perk" && offer !== null;
    const { header, titles, blurbs, redraw, skip } = this.offerTexts;
    for (const text of [header, ...titles, ...blurbs, redraw, skip]) text.setVisible(show);
    if (!show || !offer) return;
    const { u, width, height } = this.layoutNow;
    const rects = this.offerRects();
    g.fillStyle(0x000000, 0.62);
    g.fillRect(0, 0, width, height);
    header.setText(`LEVEL ${this.sim.xp.level}  ·  PICK ONE`);
    rects.cards.forEach((card, n) => {
      const perk = PERKS[offer.cards[n]];
      const present = perk !== undefined;
      titles[n].setVisible(present);
      blurbs[n].setVisible(present);
      if (!perk) return;
      const owned = this.sim.perks[perk.id] ?? 0;
      g.fillStyle(0x1b2733, 0.95);
      g.fillRoundedRect(card.x, card.y, card.w, card.h, 10 * u);
      g.lineStyle(2 * u, perk.kind === "chaos" ? 0xffd23f : 0x63e6ff, 0.9);
      g.strokeRoundedRect(card.x, card.y, card.w, card.h, 10 * u);
      titles[n].setText(owned > 0 ? `${perk.name}\nLv ${owned + 1}` : perk.name);
      blurbs[n].setText(perk.blurb).setY(card.y + (owned > 0 ? 64 : 46) * u);
      if (this.touch === false) {
        g.fillStyle(0x63e6ff, 0.9);
        g.fillCircle(card.x + 14 * u, card.y + card.h - 14 * u, 8 * u);
      }
    });
    const button = (rect: { x: number; y: number; w: number; h: number }, on: boolean): void => {
      g.fillStyle(0x1b2733, on ? 0.95 : 0.5);
      g.fillRoundedRect(rect.x, rect.y, rect.w, rect.h, 8 * u);
      g.lineStyle(1.5 * u, 0xffffff, on ? 0.7 : 0.25);
      g.strokeRoundedRect(rect.x, rect.y, rect.w, rect.h, 8 * u);
    };
    const canRedraw = this.sim.redraws > 0;
    button(rects.redraw, canRedraw);
    button(rects.skip, true);
    redraw.setText(`REDRAW (${this.sim.redraws})`).setAlpha(canRedraw ? 1 : 0.4);
    skip.setText("SKIP");
  }

  /** What the run earned, for the end screen. */
  private rankLine(): string {
    const result = this.result;
    if (!result) return "";
    const rank = rankFor(result.progress.xp);
    const head = `+${result.xp} XP  ·  RANK ${rank.level}${rank.needed > 0 ? `  (${rank.needed - rank.into} to go)` : "  (MAX)"}`;
    return result.unlocked.length > 0 ? `${head}\nUNLOCKED: ${result.unlocked.join(", ")}` : head;
  }

  /** Arrows on the screen edge for the zombies and pickups just out of view. */
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

    for (const { enemy, strength } of this.sensed) point(enemy.pos, ENEMY_GLOW, 0.85 * strength);
    for (const pickup of this.sim.pickups) point(pickup.pos, PICKUP_COLORS[pickup.kind], 0.9);
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
