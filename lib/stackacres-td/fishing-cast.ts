/**
 * The cast: everything between tapping the dock and the gauge coming up.
 *
 * Pure and renderer-free, the same split ./movement.ts and ./camera.ts keep
 * against the scene -- every number and every frame name a beat needs comes
 * out of this file, and components/arcade/stackacres-td/scene.ts owns only
 * GameObjects, tweens and timers.
 *
 * WHERE THE SKILL IS. lib/stackacres/fishing-gauge.ts is the part that can be
 * missed; this is the part that sets it up, and there is nothing to fail here.
 * It replaced the drag-the-rod-out-of-a-shaking-circle overlay, which asked
 * for a gesture before the fight and then a second, opposite gesture to end
 * it. One tap now starts the whole thing and the farmer acts it out on the
 * dock, so the only skill left in a cast is the gauge's own.
 *
 * FRAMES COME OUT OF THE RIG'S ONE FISHING TAG. Every character shares one
 * body with six animations per direction (public/stackacres-td/characters/
 * farmer.json), and `fish_left`/`fish_right` are four frames each: wind up,
 * swing, release, rod out. The art has no line; the scene draws it from the
 * rod tip (`ROD_TIP`, ./fishing-line.ts). The beats below are cut from those
 * four --
 * forward for the cast, the last frame held for the wait, the last two
 * ping-ponged for the fight, reversed for the reel. The beats stay separate
 * states rather than one long animation, because the wait ends on a roll and
 * the fight ends on the gauge's answer. A landed fish is its own art and pose
 * (./fish-catch.ts).
 *
 * The RNG is a parameter, same reason `pickCaughtFish` takes one: a test
 * hands it a fixed sequence instead of patching Math.random.
 */

/** Which way the farmer faces to cast. Sideways only: a rod thrown at the
 *  camera or away from it reads as nothing at all at this sprite size. */
export type CastSide = "left" | "right";

/** `landing` waits on the server to say which fish it was, and `show` is him
 *  holding it up (./fish-catch.ts). */
export type CastPhase = "aim" | "cast" | "nibble" | "tension" | "landing" | "show" | "reel" | "snap";

/** The rig's fishing tag, per direction, as first and last frame index. */
const FISH_TAG: Readonly<Record<CastSide, readonly [number, number]>> = {
  left: [72, 75],
  right: [76, 79],
};

/** How long the swing takes, start to rod-out. */
export const CAST_MS = 440;
/** Milliseconds per frame of the swing -- CAST_MS over the tag's four frames. */
export const CAST_FRAME_MS = CAST_MS / 4;
/** How fast the rod twitches while the fish is on. */
export const TENSION_FRAME_MS = 90;
/** The reel, and the recoil of a snapped line. */
export const REEL_FRAME_MS = 90;
export const SNAP_MS = 260;

/** How long a line sits quiet before something takes it. Short enough that
 *  the wait reads as suspense rather than as the game having stopped. */
export const NIBBLE_MIN_MS = 1500;
export const NIBBLE_MAX_MS = 3500;

/** How far north of his feet the float sits on the water, level with the dock's edge. */
export const FLOAT_DY = -2;
/** How far the bobber rides up and down while nothing is biting. */
export const BOBBER_BOB_PX = 1.5;
export const BOBBER_BOB_MS = 900;

/** How hard the bite shakes the view, in map pixels, and for how long. */
export const BITE_SHAKE_PX = 2;
export const BITE_SHAKE_MS = 220;

export interface CastAnim {
  readonly key: string;
  /** Frame indices in the rig's sheet, in play order. */
  readonly frames: readonly number[];
  readonly frameMs: number;
  /** -1 loops; 0 plays once. */
  readonly repeat: number;
  /** Ping-pong rather than restart, for the twitch. */
  readonly yoyo: boolean;
}

function range(from: number, to: number): number[] {
  const frames: number[] = [];
  for (let f = from; f <= to; f++) frames.push(f);
  return frames;
}

/**
 * Every animation the cast plays, for both sides, ready to hand to
 * `this.anims.create`. Registered once when the scene boots rather than built
 * per cast: an animation is a shared, keyed thing in Phaser, and re-creating
 * one mid-play is what makes a sprite blank for a frame.
 */
export function castAnims(): CastAnim[] {
  const anims: CastAnim[] = [];
  for (const side of ["left", "right"] as const) {
    const [first, last] = FISH_TAG[side];
    anims.push({ key: castAnimKey("cast", side), frames: range(first, last), frameMs: CAST_FRAME_MS, repeat: 0, yoyo: false });
    // The rod is already out and bent by the last two frames, so the fight is
    // those two rocking against each other.
    anims.push({ key: castAnimKey("tension", side), frames: [last - 1, last], frameMs: TENSION_FRAME_MS, repeat: -1, yoyo: true });
    anims.push({ key: castAnimKey("reel", side), frames: range(first, last).reverse(), frameMs: REEL_FRAME_MS, repeat: 0, yoyo: false });
  }
  return anims;
}

export function castAnimKey(beat: "cast" | "tension" | "reel", side: CastSide): string {
  return `${beat}_${side}`;
}

/** The frame the rod sits out on: the last of the swing, held while nothing
 *  is biting and again the moment a line snaps. */
export function rodOutFrame(side: CastSide): string {
  return String(FISH_TAG[side][1]);
}

/** How long this cast waits before something takes it. */
export function rollNibbleMs(random: () => number = Math.random): number {
  return NIBBLE_MIN_MS + random() * (NIBBLE_MAX_MS - NIBBLE_MIN_MS);
}

/**
 * Which way he turns to cast: away from the water is wrong however he walked
 * up, so the side is read off where the water actually is rather than off the
 * heading that got him there.
 */
export function castSideFor(standX: number, waterX: number): CastSide {
  return waterX <= standX ? "left" : "right";
}

/** Where the float lands, `reach` map pixels out on the side he cast to (`castReach`). */
export function bobberSpot(stand: { x: number; y: number }, side: CastSide, reach: number): { x: number; y: number } {
  return { x: stand.x + (side === "left" ? -reach : reach), y: stand.y + FLOAT_DY };
}

/**
 * Which phases a tap or a Use press may back out of. Once the gauge is up the
 * fight owns the screen, and a reel or a snap is already over.
 *
 * Walking, the stick and the belt stay refused for every phase, the fight
 * included. The gauge binds the canvas itself in the capture phase, so a
 * press meant for it never reaches the map (see fishing-gauge-scene.ts's
 * header) -- but the thumb stick and the Use key are their own DOM elements
 * beside the canvas, and nothing about the gauge stops those.
 */
export function isCancellable(phase: CastPhase): boolean {
  return phase === "cast" || phase === "nibble";
}

/** How much of the top of the screen the HUD bar covers, in CSS pixels. */
export const CAST_HUD_CSS = 76;

/** From his feet up to the top of "+1 Trout" over a fish he holds up (./fish-catch.ts). */
export const CAST_SHOWN_ABOVE_FEET = 64;

/**
 * How far above the map's top edge the camera may go while he fishes.
 *
 * The dock runs almost to the top of the Homestead, so a camera held to the
 * map puts him, the fish over his head and its caption under the HUD bar, or
 * off the screen altogether. This is just enough room for all three to sit
 * below the bar; the scene fills it with a mirror of the lake.
 */
export function castHeadroom(feetY: number, hudArtPx: number): number {
  return Math.max(0, hudArtPx + CAST_SHOWN_ABOVE_FEET - feetY);
}

/**
 * Where the rod ends on each frame that draws it, from his feet, measured off
 * the sheet (./fishing-cast.test.ts checks each is a drawn rod pixel). The
 * rod runs past the 48px frame, so this is where the drawn rod stops, and the
 * line picks up from there. The first frame of each swing has the rod behind
 * him and no tip to hang a line from.
 */
export const ROD_TIP: Readonly<Record<string, { x: number; y: number }>> = {
  "73": { x: -24, y: -20 },
  "74": { x: -24, y: -16 },
  "75": { x: -24, y: -19 },
  "77": { x: 23, y: -21 },
  "78": { x: 23, y: -17 },
  "79": { x: 23, y: -19 },
};

/** The frame he holds while the power bar charges: rod up, ready to throw. */
export function aimFrame(side: CastSide): string {
  return String(FISH_TAG[side][0] + 1);
}

/** One sweep of the power bar, empty to full. Stardew's is 0.001 per ms, a second each way. */
export const CAST_SWEEP_MS = 1000;

/** The power bar `heldMs` into a charge: up to full, back down to empty, and round again. */
export function castPowerAt(heldMs: number): number {
  const t = Math.max(0, heldMs) / CAST_SWEEP_MS;
  const phase = t % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** How far out the float lands, in map pixels from where he stands: 1.5 tiles on the weakest cast to 5.5 on a full one. */
export const CAST_MIN_REACH = 24;
export const CAST_MAX_REACH = 88;

export function castReach(power: number): number {
  return CAST_MIN_REACH + (CAST_MAX_REACH - CAST_MIN_REACH) * Math.min(1, Math.max(0, power));
}

/** The frame of the swing the float leaves the rod on: the third, rod coming forward. */
export const CAST_RELEASE_FRAME = 2;

/** The float's throw: gravity (Stardew's 0.005 px/ms² over four for our tiles) and how high it arcs. */
export const CAST_GRAVITY = 0.00125;
export function castApex(reach: number): number {
  return 10 + reach * 0.25;
}

/** How long a line takes to reel back in when he backs out, and how long a snapped one hangs before he has himself back. */
export const REEL_IN_MS = 360;
