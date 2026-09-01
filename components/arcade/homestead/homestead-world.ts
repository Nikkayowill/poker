/**
 * The Mint's world: everything that never changes, painted once into a single
 * canvas texture at boot.
 *
 * Art direction is an outdoor farm at dusk, and the load-bearing word is
 * OUTDOOR. The first cut drew a violet slab on a transparent canvas, so the
 * app's dark ground showed through underneath and the whole treasury read as a
 * platform floating in a void -- while the copy beside it talked about
 * surveying the grounds and crews tending nodes. The fix is that the land now
 * runs off all four edges: there is no platform, no edge to fall off, and the
 * field is cut INTO ground that continues past the frame. Distance is sold by
 * a hazy hedgerow along the top rather than by a sky, which costs no vertical
 * room -- the tile grid already spans y 67..441 of a 470-tall stage, so a real
 * horizon band would have had to shrink the tiles, and they are already near
 * the touch-target floor on a landscape phone.
 *
 * Canvas2D rather than Phaser.Graphics on purpose: gradients, soft shadows and
 * per-pixel scatter are what make this look painted instead of assembled from
 * flat polygons, and a Graphics object re-walks its whole command list every
 * frame under WebGL while a baked texture is one quad. Everything here is
 * deterministic (see `noise`), so the same world paints on every mount.
 *
 * No Phaser import: this is plain 2D canvas, called by homestead-scene.ts.
 */

export const HOMESTEAD_WORLD_TEXTURE = "hs-world";

/**
 * Light comes low from the upper right, behind the windmill. Every highlight
 * faces it and every cast shadow falls down-left; keep new scenery consistent
 * with that or the diorama stops reading as one place under one sun.
 */
const SUN_X = 612;
const SUN_Y = 26;

/** The field's footprint, a hair larger than the 4x4 grid it borders. */
const FIELD_CX = 360;
const FIELD_CY = 252;
const FIELD_HALF_W = 302;
const FIELD_HALF_H = 194;

/** Where the windmill's blades pivot. The scene spins them from this point. */
export const HOMESTEAD_WINDMILL_HUB = { x: 632, y: 104 } as const;

/**
 * The farm has three times of day, picked from the player's own clock when the
 * scene boots. Only colour and light change: the land, the buildings and every
 * highlight direction stay exactly where they are, because re-lighting the
 * scene from a different angle would mean re-authoring every prop's shading
 * for three cases instead of one. What sells the hour is temperature, the mist
 * in the distance, and whether the lamps are doing any work.
 */
export type HomesteadPhase = "morning" | "dusk" | "night";

interface Tone {
  groundFar: string;
  groundUpper: string;
  groundMid: string;
  groundNear: string;
  groundDeep: string;
  grassLit: string;
  grassBlade: string;
  grassBladeLit: string;
  /** The sun or moon's own wash across the upper right. */
  sky: string;
  skyAlpha: number;
  /** The coloured bounce off everything else. */
  ambient: string;
  ambientAlpha: number;
  mistTop: string;
  mistMid: string;
  ridgeFar: string;
  treeline: string;
  hedge: string;
  hedgeRim: string;
  /** Multiplies every window and lamp: full at night, barely on at dawn. */
  lamps: number;
  fieldLight: string;
  vignette: string;
}

const TONES: Readonly<Record<HomesteadPhase, Tone>> = {
  morning: {
    groundFar: "#6d92a0",
    groundUpper: "#568578",
    groundMid: "#478862",
    groundNear: "#316049",
    groundDeep: "#1e4136",
    grassLit: "#5aa06a",
    grassBlade: "rgba(72, 150, 100, 0.3)",
    grassBladeLit: "rgba(214, 210, 140, 0.26)",
    sky: "rgba(255, 240, 190, 0.62)",
    skyAlpha: 0.62,
    ambient: "rgba(120, 190, 220, 0.2)",
    ambientAlpha: 0.5,
    mistTop: "rgba(206, 226, 236, 0.62)",
    mistMid: "rgba(186, 214, 226, 0.26)",
    ridgeFar: "#7d97ac",
    treeline: "#4d7488",
    hedge: "#2c5350",
    hedgeRim: "rgba(255, 232, 150, 0.16)",
    lamps: 0.25,
    fieldLight: "rgba(255, 236, 170, 0.14)",
    vignette: "rgba(24, 48, 52, 0.3)",
  },
  dusk: {
    groundFar: "#2b3a55",
    groundUpper: "#2a4650",
    groundMid: "#284a41",
    groundNear: "#17302f",
    groundDeep: "#0f1f22",
    grassLit: "#3a7a55",
    grassBlade: "rgba(52, 112, 78, 0.3)",
    grassBladeLit: "rgba(178, 168, 104, 0.26)",
    sky: "rgba(255, 196, 96, 0.5)",
    skyAlpha: 0.5,
    ambient: "rgba(155, 63, 240, 0.22)",
    ambientAlpha: 0.5,
    mistTop: "rgba(126, 118, 196, 0.5)",
    mistMid: "rgba(110, 108, 178, 0.22)",
    ridgeFar: "#3a3a68",
    treeline: "#2b3555",
    hedge: "#1c3340",
    hedgeRim: "rgba(255, 186, 104, 0.13)",
    lamps: 1,
    fieldLight: "rgba(255, 198, 120, 0.15)",
    vignette: "rgba(6, 4, 18, 0.6)",
  },
  night: {
    groundFar: "#1b2440",
    groundUpper: "#1a2c3a",
    groundMid: "#17322f",
    groundNear: "#0e1f22",
    groundDeep: "#080f14",
    grassLit: "#25553f",
    grassBlade: "rgba(38, 84, 62, 0.3)",
    grassBladeLit: "rgba(140, 156, 168, 0.2)",
    sky: "rgba(150, 186, 255, 0.3)",
    skyAlpha: 0.4,
    ambient: "rgba(90, 70, 190, 0.2)",
    ambientAlpha: 0.45,
    mistTop: "rgba(78, 84, 150, 0.42)",
    mistMid: "rgba(68, 76, 134, 0.18)",
    ridgeFar: "#232746",
    treeline: "#1a2138",
    hedge: "#111f28",
    hedgeRim: "rgba(160, 190, 255, 0.1)",
    lamps: 1.35,
    fieldLight: "rgba(255, 198, 120, 0.1)",
    vignette: "rgba(2, 2, 10, 0.7)",
  },
};

/**
 * Which tone the player's own clock lands in. Deliberately read from the
 * device rather than UTC: the farm should look like the time where the player
 * actually is, and there is nothing here worth a timezone column for.
 */
export function homesteadPhaseFor(date = new Date()): HomesteadPhase {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour < 20) return "dusk";
  return "night";
}

/**
 * Set for the duration of one paint. The painter is synchronous and runs once
 * per mount, so a module-level current tone is simpler than threading a
 * parameter through twenty private functions -- and there is never a second
 * paint in flight to race it.
 */
let tone: Tone = TONES.dusk;

/** Deterministic value noise, so the scatter is identical on every mount. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function diamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - halfH);
  ctx.lineTo(cx + halfW, cy);
  ctx.lineTo(cx, cy + halfH);
  ctx.lineTo(cx - halfW, cy);
  ctx.closePath();
}

/** A soft warm pool of light, the cheapest way to say "a lamp is on here". */
function lightPool(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/**
 * An object's contact shadow. Radial, not a flat ellipse: a hard-edged fill
 * reads as a puddle lying next to the prop instead of shade under it, which is
 * exactly what the first pass looked like on every tree and post.
 */
function contactShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha = 0.5,
): void {
  const shade = ctx.createRadialGradient(x, y, 0, x, y, rx);
  shade.addColorStop(0, `rgba(6, 12, 16, ${alpha})`);
  shade.addColorStop(0.5, `rgba(6, 12, 16, ${alpha * 0.55})`);
  shade.addColorStop(1, "rgba(6, 12, 16, 0)");
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  ctx.fillStyle = shade;
  ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
  ctx.restore();
}

export function paintHomesteadWorld(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  phase: HomesteadPhase = "dusk",
): void {
  tone = TONES[phase];
  ctx.clearRect(0, 0, w, h);
  // Strict back-to-front by ground contact point. Everything before the field
  // bed stands beyond it, everything after stands nearer than it -- and no
  // prop's base may sit inside the field diamond, or it plants itself in the
  // middle of someone's crops.
  paintGround(ctx, w, h);
  paintDistance(ctx, w);
  paintWorn(ctx);
  paintVaultHouse(ctx);
  paintWindmill(ctx);
  paintTrees(ctx);
  paintFieldBed(ctx);
  paintPond(ctx);
  paintCart(ctx);
  paintFence(ctx, w, h);
  paintScatter(ctx, w, h);
  paintVignette(ctx, w, h);
}

/**
 * The land itself, edge to edge. The gradient is aerial perspective, not
 * decoration: far ground washes toward the haze colour and near ground sinks
 * to almost black, which is what makes a flat fill read as a receding plane.
 */
function paintGround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, tone.groundFar);
  ground.addColorStop(0.22, tone.groundUpper);
  ground.addColorStop(0.52, tone.groundMid);
  ground.addColorStop(0.84, tone.groundNear);
  ground.addColorStop(1, tone.groundDeep);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  // The sun's own wash across the upper right, and its bounce on the grass.
  lightPool(ctx, SUN_X, SUN_Y, 340, tone.sky, tone.skyAlpha);
  lightPool(ctx, 300, 150, 420, tone.ambient, tone.ambientAlpha);

  // Broad soft undulations, so the plane is not a single flat sheet.
  const rand = noise(0x51ac);
  ctx.save();
  for (let i = 0; i < 9; i += 1) {
    const x = rand() * w;
    const y = 40 + rand() * (h - 60);
    const rx = 90 + rand() * 190;
    const lift = rand() > 0.5;
    ctx.globalAlpha = 0.06 + rand() * 0.05;
    ctx.fillStyle = lift ? tone.grassLit : tone.groundDeep;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The top band: two hedgerows and a mist layer between them. This is the whole
 * "the fields keep going" trick, and it earns its 90px because that strip sits
 * above the grid's far corner and would otherwise be dead stage.
 */
function paintDistance(ctx: CanvasRenderingContext2D, w: number): void {
  /**
   * A row of overlapping canopies. `fade` is not decoration: a hedge filled
   * with one flat colour ends on the straight bottom edge of its own polygon,
   * and that drew a hard rule straight across the full width of the frame at
   * the near hedgerow's baseline. Fading the fill to transparent over the
   * band below lets the row sit down into the grass instead.
   */
  const bumps = (
    baseline: number,
    height: number,
    step: number,
    color: string,
    seed: number,
    fade = 0,
  ) => {
    const rand = noise(seed);
    const bottom = baseline + 30 + fade;
    if (fade > 0) {
      const blend = ctx.createLinearGradient(0, baseline, 0, bottom);
      blend.addColorStop(0, color);
      blend.addColorStop(0.35, color);
      blend.addColorStop(1, "rgba(28, 51, 64, 0)");
      ctx.fillStyle = blend;
    } else {
      ctx.fillStyle = color;
    }
    ctx.beginPath();
    ctx.moveTo(-20, bottom);
    for (let x = -20; x <= w + 20; x += step) {
      const top = baseline - height * (0.6 + rand() * 0.7);
      ctx.quadraticCurveTo(x + step * 0.5, top, x + step, baseline - height * 0.25);
    }
    ctx.lineTo(w + 20, bottom);
    ctx.closePath();
    ctx.fill();
  };

  // Furthest ridge, barely separated from the haze.
  bumps(46, 22, 58, tone.ridgeFar, 0x9a11);
  // A far treeline, cooler and darker.
  bumps(64, 30, 40, tone.treeline, 0x71cc);

  // Mist pooling in front of the far ridge, thickest at the horizon.
  const mist = ctx.createLinearGradient(0, 8, 0, 108);
  mist.addColorStop(0, tone.mistTop);
  mist.addColorStop(0.55, tone.mistMid);
  mist.addColorStop(1, "rgba(110, 108, 178, 0)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, 0, w, 112);

  // The near hedgerow, sitting on this side of the mist so it stays solid.
  bumps(88, 26, 34, tone.hedge, 0x4d20, 46);

  // A warm wash sitting ON the hedge tops. Drawn as free-floating arcs first
  // time out, which read as scratches in the sky rather than light on leaves.
  const rim = ctx.createLinearGradient(0, 62, 0, 92);
  rim.addColorStop(0, "rgba(255, 186, 104, 0)");
  rim.addColorStop(0.6, tone.hedgeRim);
  rim.addColorStop(1, "rgba(255, 186, 104, 0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 62, w, 30);
}

/**
 * A worn patch of bare earth where the cart is parked and where feet cross to
 * the vault house. This started as a full cart track curving up the left of
 * the frame, and no amount of narrowing saved it: a long pale ribbon crossing
 * the whole composition read as a hose, and it competed with the field for
 * the only strong line in the picture. What the scene actually needed from it
 * was "people walk here", which two scuffed patches say without drawing a
 * single line across the frame.
 */
function paintWorn(ctx: CanvasRenderingContext2D): void {
  const patch = (x: number, y: number, rx: number, ry: number, alpha: number) => {
    const worn = ctx.createRadialGradient(x, y, 0, x, y, rx);
    worn.addColorStop(0, `rgba(74, 58, 52, ${alpha})`);
    worn.addColorStop(0.6, `rgba(60, 48, 46, ${alpha * 0.5})`);
    worn.addColorStop(1, "rgba(60, 48, 46, 0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.fillStyle = worn;
    ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
    ctx.restore();
  };
  patch(104, 410, 92, 34, 0.5);
  patch(168, 168, 78, 30, 0.42);
}

/**
 * The field bed: the ground the sixteen plots are cut into, plus the low stone
 * kerb that holds it. The plots themselves are Phaser objects drawn on top of
 * this by homestead-scene.ts, since they change with play; this is only the bed.
 */
/**
 * How far the field's mass runs below its near corner. Sized to leave the
 * frame: the bed's near corner sits at y 446 of a 470-tall stage, so the point
 * of the taper lands well past the bottom edge and gets clipped.
 */
const SKIRT = 96;

/**
 * The field: a slab of earth whose mass tapers down and out of frame.
 *
 * Three attempts to get this right, and the shape is the whole answer. A flat
 * bed with raised tiles read as planters on a lawn. A bank of CONSTANT depth
 * under the near edges was worse -- it ended in a visible horizontal cut on
 * the left and right, which is just a plinth with extra steps. Digging the
 * field into a pit killed the plinth but took all the mass with it.
 *
 * What the homestead branch does, and what none of those did, is taper: the
 * mass is zero at the two side corners and deepest under the near corner, so
 * it never ends anywhere the eye can see it end. It simply narrows into the
 * ground on both sides and leaves the frame at the bottom. Two triangles lit
 * a stop apart, so the taper has an edge down the middle instead of reading
 * as one flat blob.
 *
 * It costs nothing in layout: the taper hugs the near edges and only gets deep
 * near the bottom centre, which is bare grass -- the cart and the trough sit
 * far enough out along the sides that it never reaches them.
 */
function paintFieldBed(ctx: CanvasRenderingContext2D): void {
  const top = { x: FIELD_CX, y: FIELD_CY - FIELD_HALF_H };
  const right = { x: FIELD_CX + FIELD_HALF_W, y: FIELD_CY };
  const bottom = { x: FIELD_CX, y: FIELD_CY + FIELD_HALF_H };
  const left = { x: FIELD_CX - FIELD_HALF_W, y: FIELD_CY };
  const point = { x: FIELD_CX, y: bottom.y + SKIRT };

  // Contact shadow where the mass narrows into the turf on either side.
  ctx.save();
  ctx.lineWidth = 16;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(6, 12, 14, 0.34)";
  ctx.beginPath();
  ctx.moveTo(left.x + 6, left.y + 4);
  ctx.lineTo(point.x, point.y - 30);
  ctx.lineTo(right.x - 6, right.y + 4);
  ctx.stroke();
  ctx.restore();

  // ---- the mass ----
  const wedge = (side: { x: number; y: number }, stops: [string, string]) => {
    ctx.beginPath();
    ctx.moveTo(side.x, side.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(point.x, point.y);
    ctx.closePath();
    const face = ctx.createLinearGradient(0, side.y, 0, point.y);
    face.addColorStop(0, stops[0]);
    face.addColorStop(1, stops[1]);
    ctx.fillStyle = face;
    ctx.fill();
  };
  // Left face turned away from the low sun, right face catching it.
  wedge(left, ["#241710", "#100a07"]);
  wedge(right, ["#3b2818", "#160e09"]);

  // Strata and grit, clipped to the mass so nothing spills onto the grass.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.clip();
  ctx.lineWidth = 1.6;
  for (const [depth, alpha] of [[16, 0.16], [34, 0.11], [54, 0.07]] as const) {
    ctx.strokeStyle = `rgba(163, 124, 84, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y + depth);
    ctx.lineTo(bottom.x, bottom.y + depth);
    ctx.lineTo(right.x, right.y + depth);
    ctx.stroke();
  }
  const grit = noise(0x6b21);
  for (let i = 0; i < 46; i += 1) {
    const along = grit();
    const onLeft = i % 2 === 0;
    const x = onLeft ? left.x + (bottom.x - left.x) * along : bottom.x + (right.x - bottom.x) * along;
    const y =
      (onLeft ? left.y + (bottom.y - left.y) * along : bottom.y + (right.y - bottom.y) * along) +
      6 + grit() * 70;
    ctx.fillStyle = `rgba(150, 116, 78, ${0.05 + grit() * 0.14})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + grit() * 3.5, 1.3 + grit() * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The break down the middle of the taper, so the two faces read as two.
  ctx.save();
  ctx.strokeStyle = "rgba(163, 124, 84, 0.14)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bottom.x, bottom.y);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.restore();

  // ---- the top face ----
  ctx.save();
  diamond(ctx, FIELD_CX, FIELD_CY, FIELD_HALF_W, FIELD_HALF_H);
  const bed = ctx.createLinearGradient(0, top.y, 0, bottom.y);
  bed.addColorStop(0, "#2a1d13");
  bed.addColorStop(1, "#1b120c");
  ctx.fillStyle = bed;
  ctx.fill();
  ctx.clip();
  // Shadow along the far rim, where the grass behind stands above the soil.
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(10, 7, 20, 0.5)";
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();
  ctx.restore();

  // The field is the one thing on this screen anybody touches, so it gets the
  // warmest light in the frame.
  lightPool(ctx, FIELD_CX + 40, FIELD_CY - 30, 300, tone.fieldLight, 0.85);

  // Turf breaking over the far rim, so the join is never a clean drawn line.
  ctx.save();
  diamond(ctx, FIELD_CX, FIELD_CY, FIELD_HALF_W, FIELD_HALF_H);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = tone.groundNear;
  ctx.beginPath();
  ctx.moveTo(left.x - 4, left.y);
  ctx.lineTo(top.x, top.y - 3);
  ctx.lineTo(right.x + 4, right.y);
  ctx.stroke();
  const tuft = noise(0x2c9d);
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (let i = 0; i < 40; i += 1) {
    const along = tuft();
    const onLeft = i % 2 === 0;
    const x = onLeft ? left.x + (top.x - left.x) * along : top.x + (right.x - top.x) * along;
    const y = onLeft ? left.y + (top.y - left.y) * along : top.y + (right.y - top.y) * along;
    ctx.strokeStyle = tuft() > 0.65 ? "rgba(178, 168, 104, 0.36)" : "rgba(52, 112, 78, 0.6)";
    const bend = (tuft() - 0.5) * 4;
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.quadraticCurveTo(x + bend, y + 6, x + bend * 1.6, y + 10);
    ctx.stroke();
  }
  ctx.restore();

  // Warm catch of light along the two rims that face the sun.
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 200, 110, 0.26)";
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(point.x, point.y - 40);
  ctx.stroke();
  ctx.restore();
}

/**
 * The windmill. Only the tower is baked here; homestead-scene.ts adds the blades
 * as one rotating sprite, which is the single piece of ambient motion worth a
 * draw call because a still windmill is what makes a diorama look frozen.
 */
function paintWindmill(ctx: CanvasRenderingContext2D): void {
  const { x, y: hubY } = HOMESTEAD_WINDMILL_HUB;
  const base = 196;
  const capY = hubY + 14;
  contactShadow(ctx, x - 12, base + 2, 32, 9, 0.42);

  ctx.fillStyle = "#241a3f";
  ctx.beginPath();
  ctx.moveTo(x - 19, base);
  ctx.lineTo(x - 9, capY);
  ctx.lineTo(x + 9, capY);
  ctx.lineTo(x + 19, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3b2b60";
  ctx.beginPath();
  ctx.moveTo(x + 3, capY);
  ctx.lineTo(x + 9, capY);
  ctx.lineTo(x + 19, base);
  ctx.lineTo(x + 9, base);
  ctx.closePath();
  ctx.fill();

  // Cap.
  ctx.fillStyle = "#4a3672";
  ctx.beginPath();
  ctx.moveTo(x - 14, capY + 2);
  ctx.quadraticCurveTo(x, hubY - 12, x + 14, capY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 210, 63, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 1, hubY - 10);
  ctx.quadraticCurveTo(x + 10, capY - 6, x + 14, capY + 2);
  ctx.stroke();

  // A lamp at its foot, tying it to the same warm light as the vault house.
  lightPool(ctx, x - 4, base - 14, 82, "rgba(255, 200, 96, 0.24)", 0.7 * tone.lamps);
}

function paintVaultHouse(ctx: CanvasRenderingContext2D): void {
  const x = 152;
  const y = 128;
  contactShadow(ctx, x - 6, y + 4, 62, 17, 0.4);

  // Stone body, lit face toward the sun on the right.
  ctx.fillStyle = "#241a3f";
  ctx.beginPath();
  ctx.moveTo(x - 44, y - 34);
  ctx.lineTo(x, y - 52);
  ctx.lineTo(x, y - 4);
  ctx.lineTo(x - 44, y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#392a5c";
  ctx.beginPath();
  ctx.moveTo(x, y - 52);
  ctx.lineTo(x + 44, y - 34);
  ctx.lineTo(x + 44, y + 12);
  ctx.lineTo(x, y - 4);
  ctx.closePath();
  ctx.fill();

  // Roof: two slopes off a ridge that runs back into the scene, so it reads
  // as a building rather than the flat diamond hat this was at first.
  ctx.fillStyle = "#372a56";
  ctx.beginPath();
  ctx.moveTo(x - 52, y - 32);
  ctx.lineTo(x - 8, y - 84);
  ctx.lineTo(x + 6, y - 78);
  ctx.lineTo(x - 40, y - 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#54407f";
  ctx.beginPath();
  ctx.moveTo(x + 6, y - 78);
  ctx.lineTo(x - 8, y - 84);
  ctx.lineTo(x + 40, y - 40);
  ctx.lineTo(x + 52, y - 32);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 210, 63, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 8, y - 84);
  ctx.lineTo(x + 6, y - 78);
  ctx.lineTo(x + 52, y - 32);
  ctx.stroke();

  // Chimney, off the ridge, catching the same rim light.
  ctx.fillStyle = "#2a1f47";
  ctx.fillRect(x - 26, y - 84, 9, 26);
  ctx.fillStyle = "#493768";
  ctx.fillRect(x - 19, y - 84, 3, 26);

  // The lit window, and the light it throws on the ground outside.
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.moveTo(x + 14, y - 26);
  ctx.lineTo(x + 28, y - 20);
  ctx.lineTo(x + 28, y - 2);
  ctx.lineTo(x + 14, y - 8);
  ctx.closePath();
  ctx.fill();
  lightPool(ctx, x + 22, y - 14, 74, "rgba(255, 206, 96, 0.42)", 0.75 * tone.lamps);
  lightPool(ctx, x + 30, y + 24, 60, "rgba(255, 196, 86, 0.24)", 0.7 * tone.lamps);
}

function paintTrees(ctx: CanvasRenderingContext2D): void {
  const tree = (x: number, y: number, scale: number, warm: number) => {
    contactShadow(ctx, x - 7 * scale, y + 3, 26 * scale, 8 * scale, 0.55);
    ctx.strokeStyle = "#1a1329";
    ctx.lineWidth = 3.5 * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2 * scale, y - 26 * scale);
    ctx.stroke();

    ctx.fillStyle = "#122b2a";
    ctx.beginPath();
    ctx.ellipse(x - 2 * scale, y - 40 * scale, 26 * scale, 21 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 14 * scale, y - 30 * scale, 16 * scale, 13 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sunlit crown, right side only.
    ctx.save();
    ctx.globalAlpha = warm * 0.7;
    ctx.fillStyle = "#356044";
    ctx.beginPath();
    ctx.ellipse(x + 6 * scale, y - 48 * scale, 15 * scale, 10 * scale, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = warm * 0.5;
    ctx.fillStyle = "#8d7440";
    ctx.beginPath();
    ctx.ellipse(x + 13 * scale, y - 52 * scale, 8 * scale, 5 * scale, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  tree(58, 176, 1.05, 0.5);
  tree(22, 236, 0.82, 0.4);
  tree(694, 246, 1.15, 0.75);
  tree(708, 314, 0.85, 0.7);
}

/** A trough at the near-right, catching the last of the light. */
function paintPond(ctx: CanvasRenderingContext2D): void {
  const cx = 646;
  const cy = 388;
  contactShadow(ctx, cx, cy + 4, 76, 26, 0.42);

  ctx.fillStyle = "#101f34";
  ctx.beginPath();
  ctx.ellipse(cx, cy, 70, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  const water = ctx.createLinearGradient(cx - 60, cy - 20, cx + 60, cy + 20);
  water.addColorStop(0, "#151f3d");
  water.addColorStop(0.6, "#1e2b4c");
  water.addColorStop(1, "#2c3d63");
  ctx.fillStyle = water;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 64, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  // Specular streaks: the sun's reflection, broken into ripples.
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "rgba(255, 206, 128, 0.6)";
  ctx.lineCap = "round";
  const rand = noise(0x2f8b);
  for (let i = 0; i < 5; i += 1) {
    const y = cy - 9 + i * 4.5;
    const half = 5 + rand() * 14;
    // Offset each streak independently, or five centred lines stack into
    // something that reads as a block of small print floating on the water.
    const mid = cx + 6 + (rand() - 0.5) * 34;
    ctx.lineWidth = 1 + rand() * 0.8;
    ctx.beginPath();
    ctx.moveTo(mid - half, y);
    ctx.lineTo(mid + half, y);
    ctx.stroke();
  }
  ctx.restore();

  // Reeds on the far lip.
  ctx.strokeStyle = "#14322f";
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 5; i += 1) {
    const x = cx - 46 + i * 11;
    ctx.beginPath();
    ctx.moveTo(x, cy - 14);
    ctx.quadraticCurveTo(x - 2, cy - 24, x + 3, cy - 30 - (i % 3) * 4);
    ctx.stroke();
  }
}

/** The gold cart at the near-left, parked where the track ends. */
function paintCart(ctx: CanvasRenderingContext2D): void {
  const x = 96;
  const y = 404;
  contactShadow(ctx, x - 4, y + 12, 54, 15, 0.45);

  ctx.fillStyle = "#2b2144";
  ctx.beginPath();
  ctx.moveTo(x - 42, y - 10);
  ctx.lineTo(x + 6, y - 24);
  ctx.lineTo(x + 42, y - 6);
  ctx.lineTo(x - 6, y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3d2f5e";
  ctx.beginPath();
  ctx.moveTo(x - 42, y - 10);
  ctx.lineTo(x - 6, y + 10);
  ctx.lineTo(x - 6, y + 22);
  ctx.lineTo(x - 42, y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#503e78";
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 10);
  ctx.lineTo(x + 42, y - 6);
  ctx.lineTo(x + 42, y + 6);
  ctx.lineTo(x - 6, y + 22);
  ctx.closePath();
  ctx.fill();

  // Spilling coins, the one saturated note down here.
  const rand = noise(0x77c3);
  for (let i = 0; i < 14; i += 1) {
    const cx = x - 26 + rand() * 58;
    const cy = y - 20 + rand() * 12;
    ctx.fillStyle = i % 3 === 0 ? "#ffe98a" : "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(cx, cy, 4.2, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  lightPool(ctx, x + 2, y - 16, 78, "rgba(255, 206, 96, 0.3)", 0.7 * tone.lamps);

  // Wheel.
  ctx.fillStyle = "#1b1430";
  ctx.beginPath();
  ctx.ellipse(x - 22, y + 16, 11, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#4a3a6e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x - 22, y + 16, 8, 8, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Posts along the near edges, cut off by the frame so the land keeps going. */
function paintFence(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const post = (x: number, y: number, scale: number) => {
    contactShadow(ctx, x - 4 * scale, y + 1, 9 * scale, 3 * scale, 0.4);
    ctx.fillStyle = "#241b3c";
    ctx.fillRect(x - 3 * scale, y - 26 * scale, 6 * scale, 26 * scale);
    ctx.fillStyle = "#3d2f5e";
    ctx.fillRect(x + 0.5 * scale, y - 26 * scale, 2.5 * scale, 26 * scale);
  };
  const rail = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.strokeStyle = "#2c2249";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  // Bottom-left run, walking out of frame.
  rail(-10, 452, 60, 434);
  rail(60, 434, 128, 452);
  post(-6, 456, 1.1);
  post(60, 438, 1.1);
  post(126, 458, 1.15);

  // Bottom-right run, past the pond.
  rail(w + 10, 430, 596, 452);
  post(w - 4, 434, 1.15);
  post(594, 456, 1.15);
  void h;
}

/** Grass tufts and pebbles, denser and larger toward the near edge. */
function paintScatter(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rand = noise(0xa17e);
  ctx.lineCap = "round";
  // Tufts, not individual blades. Evenly scattered single strokes read as
  // falling rain; grass grows in clumps, and clumping also leaves clean
  // negative space for the eye to rest between props.
  for (let clump = 0; clump < 46; clump += 1) {
    const cx = rand() * w;
    const cy = 100 + rand() * (h - 104);
    const inField =
      Math.abs(cx - FIELD_CX) / (FIELD_HALF_W + 12) + Math.abs(cy - FIELD_CY) / (FIELD_HALF_H + 10) < 1;
    if (inField) continue;
    const depth = (cy - 100) / (h - 100);
    const scale = 0.5 + depth * 0.9;
    const lit = cx > SUN_X - 320 && rand() > 0.55;
    ctx.strokeStyle = lit ? tone.grassBladeLit : tone.grassBlade;
    for (let blade = 0; blade < 3 + Math.floor(rand() * 3); blade += 1) {
      const x = cx + (rand() - 0.5) * 13;
      const y = cy + (rand() - 0.5) * 5;
      const bend = (rand() - 0.5) * 3.5;
      ctx.lineWidth = 1.2 * scale;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + bend, y - 3.5 * scale, x + bend * 1.7, y - 6 * scale);
      ctx.stroke();
    }
  }

  for (let i = 0; i < 26; i += 1) {
    const x = rand() * w;
    const y = 130 + rand() * (h - 140);
    const inField =
      Math.abs(x - FIELD_CX) / FIELD_HALF_W + Math.abs(y - FIELD_CY) / FIELD_HALF_H < 1.04;
    if (inField) continue;
    const r = 2 + rand() * 4;
    ctx.fillStyle = "rgba(24, 20, 42, 0.75)";
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.4, r * 1.2, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(96, 82, 132, 0.55)";
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Corner falloff, so the frame edges sink instead of ending abruptly. */
function paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.52, h * 0.28, w * 0.5, h * 0.52, h * 0.95);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, tone.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}
