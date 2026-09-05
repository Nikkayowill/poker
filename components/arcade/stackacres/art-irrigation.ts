/**
 * The irrigation network's textures: one connector shape per 4-bit
 * neighbour mask (0..15), the well head, and one 8-frame flow segment the
 * scene rotates once per arm so a hydrated pipe reads as water travelling
 * through it.
 *
 * Baked, not loaded and not drawn per frame -- the same trade every picture
 * in stackacres-art.ts makes: a Canvas2D painter into one power-of-two
 * canvas texture at ART_SCALE device pixels per unit, mippable on WebGL1,
 * then only ever scaled DOWN by the camera. A pipe sprite thereafter only
 * swaps which baked texture / frame it shows; nothing is re-rasterised as
 * the map pans.
 *
 * The painters draw in SCENE space (post-projection): a pipe lies flat on
 * the ground, so its hub is the tile's centre and its arms run along the
 * four projected diamond edges. `isoProject(dx, dy) = ((dx - dy), (dx + dy)
 * / 2)`, so the unit tile steps project to the four screen diagonals below.
 */

import * as Phaser from "phaser";

import { powerOfTwoCeil } from "@/lib/stackacres/world";
import {
  PIPE_FLOW_FRAMES,
  PIPE_TILE,
  WELL_TEXTURE_KEY,
  pipeFrameKey,
  type PipeMask,
} from "@/lib/stackacres/irrigation";
import { ART_FRAME, ART_SCALE } from "./stackacres-art";

/** The projected diamond of one tile is PIPE_TILE*2 wide and PIPE_TILE
 *  tall; pad for the raised rim and the shadow. */
const ART_W = PIPE_TILE * 2 + 10;
const ART_H = PIPE_TILE + 12;

/** Screen-space unit vectors for the four tile steps, bit order N, E, S, W
 *  -- straight out of isoProject((dx - dy), (dx + dy) / 2). */
const ARM_DIR: readonly { readonly x: number; readonly y: number }[] = [
  { x: 1, y: -0.5 }, // N: tile step (0,-1) -> up-right
  { x: 1, y: 0.5 }, // E: tile step (1, 0) -> down-right
  { x: -1, y: 0.5 }, // S: tile step (0, 1) -> down-left
  { x: -1, y: -0.5 }, // W: tile step (-1,0) -> up-left
];

/** The screen-space angle each arm lies along -- one rotated flow segment
 *  sprite per set bit is placed at this angle (see the scene wiring in
 *  DESIGN.md). Derived from ARM_DIR so it can never drift from the mask. */
export const PIPE_ARM_ANGLE: readonly number[] = ARM_DIR.map((d) => Math.atan2(d.y, d.x));

/** One flow-segment texture serves every arm, rotated. Its own small strip
 *  rather than a strip per connector mask keeps pipe texture memory near
 *  8 MB instead of ~70 MB (16 masks x an 8-frame ART_W-wide strip at
 *  ART_SCALE 8 is 4 MB each). */
export const FLOW_SEG_KEY = "irrigation:flow-seg";
const FLOW_SEG_LEN = PIPE_TILE; // hub to the shared tile edge
const FLOW_SEG_THICK = PIPE_TILE * 0.5;

const PIPE_BODY = "#6f7f8b";
const PIPE_RIM = "#9fb0bd";
const PIPE_SHADOW = "rgba(22, 32, 39, 0.26)";
const WATER_CORE = "#2f9fe0";
const WATER_HILITE = "#c6e9fb";
const STONE_DARK = "#5a5147";
const STONE_LIGHT = "#8a7d6b";
const WATER_WELL = "#2b6f9c";

const ARM_REACH = PIPE_TILE; // meets the neighbour tile's arm at the shared edge

type Painter = (ctx: CanvasRenderingContext2D, frame: number) => void;

interface Bake {
  readonly key: string;
  /** Frame size in art units (before the ART_SCALE canvas scale). */
  readonly unitW: number;
  readonly unitH: number;
  readonly frames: number;
  readonly paint: Painter;
}

function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function strokeArms(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mask: PipeMask,
  width: number,
  reach: number,
): void {
  ctx.lineWidth = width;
  for (let bit = 0; bit < 4; bit += 1) {
    if ((mask & (1 << bit)) === 0) continue;
    const dir = ARM_DIR[bit];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dir.x * reach, cy + dir.y * reach);
    ctx.stroke();
  }
}

/** The pipe body for a connector mask. Origin is the canvas top-left; the
 *  tile centre is (ART_W/2, ART_H/2). */
function drawConnector(ctx: CanvasRenderingContext2D, mask: PipeMask): void {
  const cx = ART_W / 2;
  const cy = ART_H / 2;
  const hub = PIPE_TILE * 0.34;
  const gauge = PIPE_TILE * 0.42;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Contact shadow, offset down the screen.
  ctx.save();
  ctx.translate(0, PIPE_TILE * 0.16);
  ctx.strokeStyle = PIPE_SHADOW;
  ctx.fillStyle = PIPE_SHADOW;
  strokeArms(ctx, cx, cy, mask, gauge, ARM_REACH);
  circlePath(ctx, cx, cy, hub);
  ctx.fill();
  ctx.restore();

  // An isolated tile still has to read as a pipe: a short capped stub.
  const bodyMask = mask === 0 ? 0b0011 : mask;
  const reach = mask === 0 ? PIPE_TILE * 0.42 : ARM_REACH;

  ctx.strokeStyle = PIPE_BODY;
  strokeArms(ctx, cx, cy, bodyMask, gauge, reach);
  ctx.fillStyle = PIPE_BODY;
  circlePath(ctx, cx, cy, hub);
  ctx.fill();

  // Rim highlight along the top of each arm and the hub.
  ctx.strokeStyle = PIPE_RIM;
  strokeArms(ctx, cx, cy, bodyMask, gauge * 0.4, reach);
  ctx.fillStyle = PIPE_RIM;
  circlePath(ctx, cx, cy, hub * 0.44);
  ctx.fill();
}

/**
 * One arm's worth of flowing water at phase `p` (0..1), drawn along screen
 * +x from an origin at the hub end (x = 0) out to x = FLOW_SEG_LEN. The
 * scene places one of these per set bit, rotated by `PIPE_ARM_ANGLE[bit]`,
 * origin (0, 0.5), additively over the pipe.
 *
 * The canvas is FLOW_SEG_LEN wide and FLOW_SEG_THICK tall, centred
 * vertically. Dashes travel toward +x (away from the hub) as `p` rises.
 */
function drawFlowSegment(ctx: CanvasRenderingContext2D, p: number): void {
  const midY = FLOW_SEG_THICK / 2;
  const gauge = FLOW_SEG_THICK * 0.5;
  const dash = FLOW_SEG_LEN * 0.42;

  ctx.lineCap = "round";
  ctx.lineWidth = gauge;
  ctx.strokeStyle = WATER_CORE;
  ctx.setLineDash([dash, dash]);
  ctx.lineDashOffset = -p * dash * 2; // negative -> dashes move toward +x
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(FLOW_SEG_LEN, midY);
  ctx.stroke();

  // A brighter leading edge on each dash so the direction reads.
  ctx.setLineDash([dash * 0.28, dash * 1.72]);
  ctx.lineWidth = gauge * 0.55;
  ctx.strokeStyle = WATER_HILITE;
  ctx.lineDashOffset = -p * dash * 2 - dash * 0.2;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(FLOW_SEG_LEN, midY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWell(ctx: CanvasRenderingContext2D): void {
  const cx = ART_W / 2;
  const cy = ART_H / 2;
  const rx = PIPE_TILE * 0.82;
  const ry = PIPE_TILE * 0.42;

  // Stone ring (an ellipse, since it sits on the ground plane).
  ctx.fillStyle = STONE_DARK;
  ctx.beginPath();
  ctx.ellipse(cx, cy + PIPE_TILE * 0.1, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = WATER_WELL;
  ctx.beginPath();
  ctx.ellipse(cx, cy + PIPE_TILE * 0.05, rx * 0.66, ry * 0.66, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = STONE_LIGHT;
  ctx.lineWidth = PIPE_TILE * 0.12;
  ctx.beginPath();
  ctx.ellipse(cx, cy + PIPE_TILE * 0.1, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // A small gable over the shaft so it is legible at a distance.
  ctx.strokeStyle = STONE_LIGHT;
  ctx.lineWidth = PIPE_TILE * 0.14;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.7, cy + ry * 0.3);
  ctx.lineTo(cx - rx * 0.7, cy - PIPE_TILE * 0.9);
  ctx.moveTo(cx + rx * 0.7, cy + ry * 0.3);
  ctx.lineTo(cx + rx * 0.7, cy - PIPE_TILE * 0.9);
  ctx.stroke();
  ctx.fillStyle = STONE_DARK;
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy - PIPE_TILE * 0.7);
  ctx.lineTo(cx, cy - PIPE_TILE * 1.25);
  ctx.lineTo(cx + rx, cy - PIPE_TILE * 0.7);
  ctx.closePath();
  ctx.fill();
}

/**
 * Bakes one painter as a horizontal strip of `frames` frames, the exact
 * `bakeTexture` recipe from stackacres-art.ts: a power-of-two canvas at
 * ART_SCALE device px per art unit, each frame clipped and registered by
 * index. Frame 0 also answers to `ART_FRAME`, so a call site that does not
 * care about animation can `add.image(x, y, key, ART_FRAME)` like every
 * other baked sprite.
 */
function bake(scene: Phaser.Scene, spec: Bake): void {
  if (scene.textures.exists(spec.key)) return;

  const fw = Math.ceil(spec.unitW * ART_SCALE);
  const fh = Math.ceil(spec.unitH * ART_SCALE);
  const texture = scene.textures.createCanvas(
    spec.key,
    powerOfTwoCeil(fw * spec.frames),
    powerOfTwoCeil(fh),
  );
  if (!texture) return;

  const ctx = texture.context;
  for (let frame = 0; frame < spec.frames; frame += 1) {
    ctx.save();
    ctx.translate(frame * fw, 0);
    ctx.beginPath();
    ctx.rect(0, 0, fw, fh);
    ctx.clip();
    ctx.scale(ART_SCALE, ART_SCALE);
    spec.paint(ctx, frame);
    ctx.restore();
    texture.add(frame, 0, frame * fw, 0, fw, fh);
  }
  texture.add(ART_FRAME, 0, 0, 0, fw, fh);
  texture.refresh();
}

/** Bakes every irrigation texture: 16 connectors, the well, one flow
 *  segment. Call once in `create()`, after the other `bake*` calls.
 *  Idempotent. */
export function bakeIrrigation(scene: Phaser.Scene): void {
  for (let mask = 0; mask < 16; mask += 1) {
    bake(scene, {
      key: pipeFrameKey(mask),
      unitW: ART_W,
      unitH: ART_H,
      frames: 1,
      paint: (ctx) => drawConnector(ctx, mask),
    });
  }
  bake(scene, { key: WELL_TEXTURE_KEY, unitW: ART_W, unitH: ART_H, frames: 1, paint: drawWell });
  bake(scene, {
    key: FLOW_SEG_KEY,
    unitW: FLOW_SEG_LEN,
    unitH: FLOW_SEG_THICK,
    frames: PIPE_FLOW_FRAMES,
    paint: (ctx, frame) => drawFlowSegment(ctx, frame / PIPE_FLOW_FRAMES),
  });
}

/* ------------------------------------------------------------------------ *
 * OPTIONAL: a single-pass flow shader, as an alternative to the baked flow
 * strip. The strip above is the idiomatic choice for this codebase (no
 * WebGL1 caveats, mippable, no per-object uniforms). This is here for the
 * case where one scrolling shader over every hydrated pipe at once is
 * wanted instead -- register it once, then `flowSprite.setPipeline(
 * PipeFlowPipeline.KEY)` and skip the per-frame setFrame loop.
 * ------------------------------------------------------------------------ */

const FLOW_FRAG = `
#define SHADER_NAME PIPE_FLOW_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uTime;
varying vec2 outTexCoord;
varying vec4 outTint;

void main(void) {
  vec4 base = texture2D(uMainSampler, outTexCoord);
  // A bright band sweeps along the projected +x/-y screen diagonal (outward
  // from a well drawn to the west) and is added over the pipe's own alpha.
  float along = (outTexCoord.x - outTexCoord.y) * 22.0 - uTime * 5.5;
  float band = 0.5 + 0.5 * sin(along);
  vec3 water = mix(vec3(0.18, 0.62, 0.88), vec3(0.78, 0.91, 0.98), band);
  vec3 rgb = base.rgb + water * base.a * outTint.a;
  gl_FragColor = vec4(rgb, base.a) * vec4(outTint.rgb, 1.0);
}`;

export class PipeFlowPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  static readonly KEY = "PipeFlow";

  private elapsed = 0;

  constructor(game: Phaser.Game) {
    super({ game, fragShader: FLOW_FRAG });
  }

  onPreRender(): void {
    this.elapsed += this.game.loop.delta / 1000;
    this.set1f("uTime", this.elapsed);
  }
}

/** Register the pipeline on the game once, before any sprite asks for it. */
export function registerPipeFlowPipeline(game: Phaser.Game): void {
  const pipelines = game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer
    ? game.renderer.pipelines
    : null;
  if (pipelines && !pipelines.has(PipeFlowPipeline.KEY)) {
    pipelines.add(PipeFlowPipeline.KEY, new PipeFlowPipeline(game));
  }
}
