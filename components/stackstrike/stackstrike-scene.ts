import * as Phaser from "phaser";
import { ARENA, PLAYER_GLOW } from "@/lib/stackstrike/content";
import { segmentRectHit } from "@/lib/stackstrike/geometry";
import {
  accuracy,
  createState,
  currentWeapon,
  enemyDef,
  STEP_SECONDS,
  step,
} from "@/lib/stackstrike/sim";
import type { DifficultyId, EnemyState, PlayerInput, SimEvent, SimState } from "@/lib/stackstrike/types";
import { beamPolygon, DOOR_GLOW, glowPolygon } from "@/lib/stackstrike/vision";

/**
 * The Phaser side of StackStrike: reads input, runs lib/stackstrike/sim.ts at
 * a fixed 60 Hz and draws what it says. No game rules in here, and no art yet:
 * everything is drawn with shapes so the feel can be judged before any sprites
 * exist.
 *
 * Built for a phone held sideways, laid out like StackAcres: fixed controls in
 * the bottom corners. Left thumb: a move stick. Right thumb: an aim pad that
 * points the gun and its red laser sight; dragging only aims, a tap anywhere
 * on the pad aims there and fires, and holding still keeps firing. RELOAD and
 * the weapon button sit around it. There is no hide button: pressing into a
 * corner is hiding. Desktop is the same game with WASD, mouse, R and 1-3.
 *
 * The player carries no light. The world is black, lit only by a small glow
 * round the player and by the enemies' flashlights: each beam, cut short by
 * walls, is erased out of the dark, and being inside one is what fills that
 * enemy's spotted meter. The laser is draw-only, so enemies never see it.
 * Enemies are drawn on top of the dark, glowing red, so the player always
 * knows where they are. A small map in the corner shows them too.
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
const ENEMY_GLOW = 0xff2a2a;

const DARKNESS = 0.95;
/** The dark is drawn at this share of screen resolution and stretched back up: light is soft anyway, and it is a full-screen fill. */
const DARK_SCALE = 0.5;

/** Sizes below are CSS pixels; multiply by `u` for the canvas. */
const STICK_RADIUS = 54;
const KNOB_RADIUS = 24;
/** A thumb landing within this many pad radii of a pad uses the pad; farther out it floats from where it landed. */
const PAD_GRAB = 1.5;
const AIM_DEADZONE = 0.3;
const BUTTON_RADIUS = 30;
/** A thumb has to move this far (CSS pixels) from where it landed before it counts as a drag. */
const DRAG_SLOP = 10;
/** A touch on the aim pad this short, with no drag, is a tap: one shot. */
const TAP_MS = 260;
/** Held still on the aim pad past this, with no drag, it keeps firing. */
const HOLD_FIRE_MS = 320;
/** A tap keeps asking to fire this long, so the weapon's cooldown cannot swallow it. */
const FIRE_BUFFER_SECONDS = 0.1;
const MAX_FRAME_SECONDS = 0.1;
const RESTART_LOCKOUT_MS = 700;
/** World units the phone view fits top to bottom. Small, so figures read on a small screen. */
const PHONE_VIEW_HEIGHT = 330;
const CAMERA_FOLLOW_RATE = 12;
/** How far the laser sight reaches, in world units. */
const LASER_RANGE = 520;
/** The corner map, in CSS pixels wide; its height follows the arena. */
const MAP_WIDTH = 120;

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
  downAt: number;
  /** Where the thumb first landed. A tap is judged from here, not from the pad's centre. */
  downX: number;
  downY: number;
  /** Moved well away from where it landed: it is aiming, not tapping. */
  dragged: boolean;
  /** Started on the pad's fixed base, rather than floating from where it landed. */
  fixed: boolean;
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
  private tint!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private healthText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private buttonLabels!: Record<ButtonName, Phaser.GameObjects.Text>;
  private moveCaption!: Phaser.GameObjects.Text;
  private aimCaption!: Phaser.GameObjects.Text;

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
  private banner = { text: "", left: 0 };

  constructor(private readonly options: SceneOptions) {
    super("stackstrike");
    this.touch = options.touch;
    this.sim = createState(1, "vanguard", ARENA, options.difficulty);
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
    this.worldLayer.add([floor, this.world]);

    // Darkness first in the HUD layer so the controls draw on top of it.
    // Origin at the corner: a render texture otherwise centres on its position.
    this.dark = this.add
      .renderTexture(0, 0, Math.ceil(this.scale.width * DARK_SCALE), Math.ceil(this.scale.height * DARK_SCALE))
      .setOrigin(0, 0)
      .setScale(1 / DARK_SCALE);
    this.lightBrush = this.make.graphics({ x: 0, y: 0 }, false);
    this.enemyGfx = this.add.graphics();
    this.tint = this.add.graphics();
    this.hud = this.add.graphics();
    const text = (): Phaser.GameObjects.Text =>
      this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontStyle: "bold", color: COLORS.hud });
    this.healthText = text();
    this.statusText = text();
    this.weaponText = text().setOrigin(0.5, 1);
    this.waveText = text().setOrigin(1, 0).setAlign("right");
    this.bannerText = text().setOrigin(0.5).setAlign("center");
    this.buttonLabels = {
      reload: text().setOrigin(0.5).setText("RELOAD"),
      swap: text().setOrigin(0.5),
    };
    this.moveCaption = text().setOrigin(0.5).setText("MOVE");
    this.aimCaption = text().setOrigin(0.5).setText("TAP TO FIRE");
    this.hudLayer.add([
      this.dark,
      this.enemyGfx,
      this.tint,
      this.hud,
      this.healthText,
      this.statusText,
      this.weaponText,
      this.waveText,
      this.bannerText,
      this.moveCaption,
      this.aimCaption,
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

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __stackstrike?: unknown }).__stackstrike = {
        scene: this,
        state: () => this.sim,
      };
    }
  }

  /** Freezes the fight, for a portrait phone or a menu. Held sticks are let go. */
  setPaused(paused: boolean): void {
    this.paused = paused;
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
      for (const event of this.sim.events) this.react(event);
      if (wasPlaying && this.sim.status === "dead") this.diedAt = this.time.now;
    }

    this.fireBuffer = Math.max(0, this.fireBuffer - frame);
    if (this.hint.left > 0) this.hint.left -= frame;
    this.updateParticles(frame);
    this.updateCamera(frame);
    this.drawWorld();
    this.updateBeams();
    this.drawDark();
    this.drawEnemies();
    this.drawHud();
    if (this.banner.left > 0) this.banner.left -= frame;
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
      const near = Math.hypot(pointer.x - home.x, pointer.y - home.y) <= STICK_RADIUS * PAD_GRAB * u;
      const pad: Pad = {
        id: pointer.id,
        originX: near ? home.x : pointer.x,
        originY: near ? home.y : pointer.y,
        x: pointer.x,
        y: pointer.y,
        downAt: this.time.now,
        downX: pointer.x,
        downY: pointer.y,
        dragged: false,
        fixed: near,
      };
      if (left) {
        if (!this.moveStick) this.moveStick = pad;
      } else if (!this.aimPad) {
        this.aimPad = pad;
        // A tap on the pad aims where it landed, so a tap off-centre shoots that way.
        this.aimFromPad(pad);
      }
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      for (const pad of [this.moveStick, this.aimPad]) {
        if (pad?.id === pointer.id) {
          pad.x = pointer.x;
          pad.y = pointer.y;
        }
      }
    });

    const release = (pointer: Phaser.Input.Pointer): void => {
      if (this.moveStick?.id === pointer.id) this.moveStick = null;
      if (this.aimPad?.id === pointer.id) {
        // A quick touch that never dragged is a tap: fire once, where the gun already points.
        if (!this.aimPad.dragged && this.time.now - this.aimPad.downAt <= TAP_MS) {
          this.fireBuffer = FIRE_BUFFER_SECONDS;
        }
        this.aimPad = null;
      }
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
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

  private padVector(pad: Pad | null): Point {
    if (!pad) return { x: 0, y: 0 };
    const radius = STICK_RADIUS * this.layoutNow.u;
    const dx = (pad.x - pad.originX) / radius;
    const dy = (pad.y - pad.originY) / radius;
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
      // The gun and the laser follow the thumb wherever it is on the pad.
      this.aimFromPad(this.aimPad);
      const slop = DRAG_SLOP * this.layoutNow.u;
      if (Math.hypot(this.aimPad.x - this.aimPad.downX, this.aimPad.y - this.aimPad.downY) > slop) {
        this.aimPad.dragged = true;
      }
      // Dragging only aims. A thumb held still keeps firing, wherever it landed.
      if (!this.aimPad.dragged && this.time.now - this.aimPad.downAt > HOLD_FIRE_MS) fire = true;
    } else if (!this.touch) {
      const pointer = this.input.mousePointer;
      const world = this.screenToWorld(pointer.x, pointer.y);
      this.aimAngle = Math.atan2(world.y - player.pos.y, world.x - player.pos.x);
      fire = fire || pointer.leftButtonDown();
    }

    return {
      move,
      aim: this.aimAngle,
      fire,
      reload: this.reloadQueued,
      selectWeapon: this.selectQueued,
    };
  }

  /** Points the gun where the thumb is, unless it is on the pad's centre. */
  private aimFromPad(pad: Pad): void {
    const vector = this.padVector(pad);
    if (Math.hypot(vector.x, vector.y) > AIM_DEADZONE) this.aimAngle = Math.atan2(vector.y, vector.x);
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
      const dist = Math.hypot(x - buttons[name].x, y - buttons[name].y);
      if (dist <= reach && dist < bestDistance) {
        best = name;
        bestDistance = dist;
      }
    }
    return best;
  }

  private restart(): void {
    this.sim = createState((Math.random() * 2 ** 31) >>> 0, "vanguard", ARENA, this.options.difficulty);
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
      case "wave":
        this.banner = { text: `WAVE ${event.wave}`, left: 1.6 };
        break;
      case "spotted":
        this.cameras.main.shake(140, 0.003);
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
      aimHome: { x: right - 100 * u, y: padY },
      buttons: {
        reload: { x: right - 46 * u, y: padY - (STICK_RADIUS + 52) * u },
        swap: { x: right - 122 * u, y: padY - (STICK_RADIUS + 58) * u },
      },
    };

    this.hudCamera.setSize(width, height);
    this.dark.resize(Math.ceil(width * DARK_SCALE), Math.ceil(height * DARK_SCALE));

    // A phone shows a small slice of the arena so figures are big enough to
    // read; a desktop window shows more.
    const zoom = this.touch
      ? Phaser.Math.Clamp(height / PHONE_VIEW_HEIGHT, 0.8 * u, 3 * u)
      : Phaser.Math.Clamp(Math.min(width / 900, height / 560), 0.55 * u, 2 * u);
    this.cameras.main.setZoom(zoom);

    const small = Math.round(15 * u);
    const left = insets.left + 16 * u;
    this.healthText.setFontSize(small).setPosition(left, insets.top + 12 * u);
    this.weaponText.setFontSize(Math.round(13 * u)).setOrigin(0, 0).setPosition(left, insets.top + 54 * u);
    this.statusText.setFontSize(Math.round(12 * u)).setPosition(left, insets.top + 76 * u);
    this.waveText.setFontSize(small).setPosition(width - insets.right - 16 * u, insets.top + 12 * u);
    this.bannerText.setPosition(width / 2, height * 0.3);
    for (const name of BUTTON_NAMES) {
      this.buttonLabels[name].setFontSize(Math.round(11 * u)).setPosition(this.layoutNow.buttons[name].x, this.layoutNow.buttons[name].y);
    }
    const caption = Math.round(9 * u);
    const captionY = STICK_RADIUS * 0.66 * u;
    this.moveCaption.setFontSize(caption).setPosition(this.layoutNow.moveHome.x, this.layoutNow.moveHome.y + captionY);
    this.aimCaption.setFontSize(caption).setPosition(this.layoutNow.aimHome.x, this.layoutNow.aimHome.y + captionY);
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

    // Doors, set into the outer wall: where the enemy comes in.
    for (const entry of arena.entries) {
      const { x, y, w, h } = entry.door;
      g.fillStyle(COLORS.door, 1);
      g.fillRect(x, y, w, h);
      g.lineStyle(2, COLORS.doorEdge, 1);
      g.strokeRect(x, y, w, h);
      g.lineStyle(1.5, COLORS.doorEdge, 0.6);
      if (w > h) for (let dx = x + 12; dx < x + w - 6; dx += 14) g.lineBetween(dx, y + 4, dx, y + h - 4);
      else for (let dy = y + 12; dy < y + h - 6; dy += 14) g.lineBetween(x + 4, dy, x + w - 4, dy);
    }
  }

  private drawWorld(): void {
    const g = this.world;
    const { player, enemies, projectiles, arena } = this.sim;
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 180);
    g.clear();

    // The doors the next wave (or this one) comes through, so the player can plan for them.
    for (const entry of arena.entries) {
      if (!this.sim.incoming.includes(entry.id)) continue;
      const { x, y, w, h } = entry.door;
      g.fillStyle(0xff4d4d, 0.22 + 0.3 * pulse);
      g.fillRect(x, y, w, h);
      const nx = entry.pos.x - (x + w / 2);
      const ny = entry.pos.y - (y + h / 2);
      const length = Math.hypot(nx, ny) || 1;
      const dx = nx / length;
      const dy = ny / length;
      for (let k = 0; k < 2; k += 1) {
        const tipX = entry.pos.x + dx * (12 + k * 18);
        const tipY = entry.pos.y + dy * (12 + k * 18);
        g.fillStyle(0xff4d4d, 0.35 + 0.4 * pulse);
        g.fillTriangle(
          tipX,
          tipY,
          tipX - dx * 11 + -dy * 11,
          tipY - dy * 11 + dx * 11,
          tipX - dx * 11 - -dy * 11,
          tipY - dy * 11 - dx * 11,
        );
      }
    }

    g.fillStyle(player.hurt > 0 ? COLORS.playerHurt : COLORS.player, player.hidden ? 0.6 : 1);
    g.fillCircle(player.pos.x, player.pos.y, player.radius);
    g.lineStyle(5, 0x14161a, 1);
    g.lineBetween(
      player.pos.x,
      player.pos.y,
      player.pos.x + Math.cos(player.aim) * (player.radius + 12),
      player.pos.y + Math.sin(player.aim) * (player.radius + 12),
    );
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
    g.setPosition(width / 2 - this.cam.x * zoom, height / 2 - this.cam.y * zoom).setScale(zoom);
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 220);

    for (const enemy of enemies) {
      const def = enemyDef(enemy.defId);
      const base = ENEMY_COLORS[enemy.defId] ?? 0xff00ff;
      const alert = enemy.mode === "chase" || enemy.mode === "attack";
      const { x, y } = enemy.pos;

      // Its flashlight: a wide soft beam with a brighter core near the lamp.
      const beam = this.beams.get(enemy.id);
      if (beam) {
        const tint = alertColor(alert ? 1 : enemy.awareness);
        g.fillStyle(tint, 0.1 + 0.14 * (alert ? 1 : enemy.awareness));
        g.fillPoints(beam, true);
        g.fillStyle(tint, 0.1 + 0.1 * (alert ? 1 : enemy.awareness));
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
        g.fillStyle(ENEMY_GLOW, Math.min(1, alpha * strength));
        g.fillCircle(x, y, def.radius * scale);
      }

      g.fillStyle(enemy.hurt > 0 ? 0xffffff : base, 1);
      g.fillCircle(x, y, def.radius);
      g.lineStyle(2, ENEMY_GLOW, 0.9);
      g.strokeCircle(x, y, def.radius + 1);
      if (alert || enemy.mode === "search" || enemy.mode === "suspicious") {
        g.lineStyle(3, alert ? 0xff3030 : 0xffd23f, 1);
        g.strokeCircle(x, y, def.radius + 5);
      }
      g.lineStyle(4, 0x0b0b0d, 1);
      g.lineBetween(
        x,
        y,
        x + Math.cos(enemy.facing) * (def.radius + 8),
        y + Math.sin(enemy.facing) * (def.radius + 8),
      );

      // The detection meter over its head: it fills as it works out you are there.
      const meterWidth = def.radius * 2 + 6;
      const meterLeft = x - meterWidth / 2;
      const meterTop = y - def.radius - 20;
      if (alert) {
        g.fillStyle(0xff3030, 1);
        g.fillRect(x - 1.5, meterTop - 6, 3, 7);
        g.fillRect(x - 1.5, meterTop + 3, 3, 3);
      } else if (enemy.awareness > 0.02) {
        g.fillStyle(0x000000, 0.7);
        g.fillRect(meterLeft - 1, meterTop - 1, meterWidth + 2, 6);
        g.fillStyle(alertColor(enemy.awareness), 1);
        g.fillRect(meterLeft, meterTop, meterWidth * enemy.awareness, 4);
      }
      if (enemy.health < enemy.maxHealth) {
        const barWidth = def.radius * 2;
        const left = x - def.radius;
        const top = y - def.radius - 12;
        g.fillStyle(0x000000, 0.6);
        g.fillRect(left, top, barWidth, 4);
        g.fillStyle(0x7ee787, 1);
        g.fillRect(left, top, barWidth * (enemy.health / enemy.maxHealth), 4);
      }
    }
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
    for (const enemy of this.sim.enemies) {
      const def = enemyDef(enemy.defId);
      this.beams.set(enemy.id, beamPolygon(enemy.pos, enemy.facing, this.sim.arena.walls, def.detectionRange, def.fieldOfView, 28));
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

    // Doors are always faintly lit; the ones about to be used are bright. That is how you watch them come in.
    for (const entry of arena.entries) {
      const active = this.sim.incoming.includes(entry.id);
      erase(circlePoints(entry.pos.x, entry.pos.y, DOOR_GLOW * (active ? 1 : 0.7)), active ? 0.8 : 0.3);
    }

    // Each enemy's flashlight lights the floor it sweeps, brightest near the lamp.
    for (const enemy of this.sim.enemies) {
      const def = enemyDef(enemy.defId);
      const poly = this.beams.get(enemy.id);
      if (!poly) continue;
      erase(poly, 0.3);
      erase(beamPolygon(enemy.pos, enemy.facing, arena.walls, def.detectionRange * 0.6, def.fieldOfView * 0.75, 20), 0.3);
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

    // Wave and score.
    const alive = this.sim.enemies.length + this.sim.spawnQueue.length;
    this.waveText.setText(
      `Wave ${this.sim.wave}  ·  ${this.sim.score} pts\n${alive > 0 ? `${alive} hostile${alive === 1 ? "" : "s"}` : "Clear"}`,
    );

    // Banner: planning time announces the doors; a death screen says how it went.
    const planning = status === "playing" && this.sim.intermission > 0;
    if (status === "dead") {
      this.bannerText.setText(
        `ELIMINATED\nWave ${this.sim.wave}  ·  ${this.sim.score} pts  ·  ${Math.round(accuracy(this.sim) * 100)}% accuracy\n${this.touch ? "Tap" : "Press R or click"} to restart`,
      );
      this.bannerText.setFontSize(Math.round(22 * u));
      g.fillStyle(0x000000, 0.5);
      g.fillRect(0, 0, width, height);
    } else if (planning) {
      const labels = this.sim.arena.entries
        .filter((entry) => this.sim.incoming.includes(entry.id))
        .map((entry) => entry.label)
        .join("  +  ");
      this.bannerText.setText(`WAVE ${this.sim.wave + 1} INCOMING\n${labels}\nin ${Math.ceil(this.sim.intermission)}`);
      this.bannerText.setFontSize(Math.round(17 * u));
    } else {
      this.bannerText.setFontSize(Math.round(30 * u));
      this.bannerText.setText(this.banner.left > 0 ? this.banner.text : "");
    }
    this.bannerText.setAlpha(status === "dead" || planning ? 1 : Math.min(1, this.banner.left * 2));

    this.drawMap(g);

    // Touch controls.
    const playing = status === "playing";
    const showControls = this.touch && playing;
    this.moveCaption.setVisible(showControls);
    this.aimCaption.setVisible(showControls);
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

    this.buttonLabels.swap.setText(weapon.name.toUpperCase());
    for (const name of BUTTON_NAMES) {
      const at = buttons[name];
      g.fillStyle(0xffffff, 0.12);
      g.fillCircle(at.x, at.y, BUTTON_RADIUS * u);
      g.lineStyle(2 * u, 0xffffff, 0.45);
      g.strokeCircle(at.x, at.y, BUTTON_RADIUS * u);
    }
  }

  /**
   * A small map in the top-right corner: the walls, the doors, you, and every
   * enemy as a red dot, so the whole floor can be read at a glance.
   */
  private drawMap(g: Phaser.GameObjects.Graphics): void {
    const { u, width, insets } = this.layoutNow;
    const { arena, player, enemies } = this.sim;
    const w = MAP_WIDTH * u;
    const scale = w / arena.width;
    const h = arena.height * scale;
    const left = width - insets.right - 16 * u - w;
    const top = insets.top + 50 * u;
    const at = (x: number, y: number): Point => ({ x: left + x * scale, y: top + y * scale });

    g.fillStyle(0x000000, 0.55);
    g.fillRect(left - 2 * u, top - 2 * u, w + 4 * u, h + 4 * u);
    g.lineStyle(1 * u, 0xffffff, 0.3);
    g.strokeRect(left - 2 * u, top - 2 * u, w + 4 * u, h + 4 * u);

    g.fillStyle(COLORS.wallEdge, 0.55);
    for (const wall of arena.walls) g.fillRect(left + wall.x * scale, top + wall.y * scale, Math.max(1, wall.w * scale), Math.max(1, wall.h * scale));

    for (const entry of arena.entries) {
      const door = entry.door;
      const incoming = this.sim.incoming.includes(entry.id);
      g.fillStyle(incoming ? 0xff4d4d : COLORS.doorEdge, incoming ? 1 : 0.8);
      g.fillRect(left + door.x * scale, top + door.y * scale, Math.max(2 * u, door.w * scale), Math.max(2 * u, door.h * scale));
    }

    // Where the screen is looking.
    const halfW = this.layoutNow.width / (2 * this.zoom);
    const halfH = this.layoutNow.height / (2 * this.zoom);
    const view = at(this.cam.x - halfW, this.cam.y - halfH);
    g.lineStyle(1 * u, 0xffffff, 0.35);
    g.strokeRect(view.x, view.y, halfW * 2 * scale, halfH * 2 * scale);

    for (const enemy of enemies) {
      const dot = at(enemy.pos.x, enemy.pos.y);
      const alert = enemy.mode === "chase" || enemy.mode === "attack";
      g.fillStyle(ENEMY_GLOW, 0.3);
      g.fillCircle(dot.x, dot.y, 5 * u);
      g.fillStyle(alert ? 0xffffff : ENEMY_GLOW, 1);
      g.fillCircle(dot.x, dot.y, 2.6 * u);
      if (alert) {
        g.lineStyle(1.2 * u, ENEMY_GLOW, 1);
        g.strokeCircle(dot.x, dot.y, 4.2 * u);
      }
    }

    const me = at(player.pos.x, player.pos.y);
    g.fillStyle(player.hidden ? COLORS.shadow : COLORS.player, 1);
    g.fillCircle(me.x, me.y, 3 * u);
    g.lineStyle(1.5 * u, COLORS.player, 0.9);
    g.lineBetween(me.x, me.y, me.x + Math.cos(player.aim) * 8 * u, me.y + Math.sin(player.aim) * 8 * u);
  }

  /** A pad's base ring and knob. Idle, the aim knob rests toward where the gun points. */
  private drawPad(g: Phaser.GameObjects.Graphics, home: Point, pad: Pad | null, kind: "move" | "aim"): void {
    const { u } = this.layoutNow;
    const held = pad !== null;
    const rest = kind === "aim" ? { x: Math.cos(this.aimAngle) * 0.42, y: Math.sin(this.aimAngle) * 0.42 } : { x: 0, y: 0 };
    const vector = held ? this.padVector(pad) : rest;
    g.fillStyle(0xffffff, held ? 0.14 : 0.09);
    g.fillCircle(home.x, home.y, STICK_RADIUS * u);
    g.lineStyle(2 * u, 0xffffff, held ? 0.7 : 0.4);
    g.strokeCircle(home.x, home.y, STICK_RADIUS * u);

    const kx = home.x + vector.x * STICK_RADIUS * u;
    const ky = home.y + vector.y * STICK_RADIUS * u;
    g.fillStyle(kind === "aim" ? COLORS.beamTint : 0xffffff, held ? 0.55 : 0.3);
    g.fillCircle(kx, ky, KNOB_RADIUS * u);
    g.lineStyle(2 * u, 0xffffff, held ? 0.8 : 0.55);
    g.strokeCircle(kx, ky, KNOB_RADIUS * u);
    if (kind === "aim") {
      // A crosshair on the knob: this is the thing you aim, and tap, to shoot.
      const arm = KNOB_RADIUS * 0.55 * u;
      g.lineStyle(1.5 * u, 0xffffff, 0.8);
      g.lineBetween(kx - arm, ky, kx + arm, ky);
      g.lineBetween(kx, ky - arm, kx, ky + arm);
      g.strokeCircle(kx, ky, KNOB_RADIUS * 0.3 * u);
    }
  }
}
