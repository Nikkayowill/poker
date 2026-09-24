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
 * swing, release, rod out. The last two also draw the LINE, which is why the
 * scene draws none of its own -- see `LINE_END_DX`. The beats below are cut
 * from those four --
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
export type CastPhase = "cast" | "nibble" | "tension" | "landing" | "show" | "reel" | "snap";

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

/**
 * Where the float sits, as an offset from the farmer's own feet.
 *
 * MEASURED OFF THE ART, not chosen. The PixelLab cast (art/stackacres-td/
 * pixellab) draws its float at (-17, -2) from where he stands in the rod-out
 * frame. The build takes that float out of the art, because it's only in the
 * last frame and the fight would blink it, and this one sits where it was.
 *
 * The scene draws no line. `DOCK_CAST_SPOT` moved 5px south when this moved
 * 5px north, so the float lands on the same open water as before.
 */
export const LINE_END_DX = -17;
export const LINE_END_DY = -2;
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

/** Where the float lands: the end of the line the rig itself draws. */
export function bobberSpot(stand: { x: number; y: number }, side: CastSide): { x: number; y: number } {
  return { x: stand.x + (side === "left" ? LINE_END_DX : -LINE_END_DX), y: stand.y + LINE_END_DY };
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
