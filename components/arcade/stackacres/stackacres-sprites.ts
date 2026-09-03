/**
 * The four sprites that ship as images rather than as painter code.
 *
 * WHY THIS EXISTS. Everything else in StackAcres is drawn by a function in
 * stackacres-art.ts, and that is still the default: a painter is on the
 * `RAMPS` palette by construction, recolours by swapping a ramp (which is how
 * `tree1/2/3` are one painter and three ramps), and costs nothing to ship.
 * These four are the exception, generated rather than drawn, and they buy a
 * silhouette the painters were not getting -- the cow and the hen especially,
 * which were circles with rounded-rect legs.
 *
 * WHAT THEY COST, so nobody has to rediscover it: they are off `RAMPS`, they
 * carry gradients where the rest of the farm is flat, and they cannot be
 * recoloured. Do not reach for this module to add a variant. A new animal in
 * a different colour is a painter, not a fifth PNG.
 *
 * HOW THEY REACH A CANVAS. Every surface in StackAcres draws a painter into a
 * 2D context -- the Phaser world through `bakeTexture`, the toolbelt and seed
 * strip through `paintIcon`, the lobby card through stackacres-cover-art.tsx.
 * So these are exposed the same way: stackacres-art.ts wraps each of the four
 * painters so it draws the image once the image is here and its own shapes
 * until then. Nothing at a draw site had to change.
 *
 * The module is imported by Node tests through the painter module, so it must
 * never touch `Image` at import time.
 */

export const SPRITE_ART = {
  cow: "/stackacres/sprites/cow.png",
  hen: "/stackacres/sprites/hen.png",
  barn: "/stackacres/sprites/barn.png",
  windmill: "/stackacres/sprites/windmill.png",
} as const;

export type SpriteName = keyof typeof SPRITE_ART;

export const SPRITE_NAMES = Object.keys(SPRITE_ART) as readonly SpriteName[];

export function isSpriteName(name: string): name is SpriteName {
  return name in SPRITE_ART;
}

/** The Phaser texture key the raw file is loaded under. Deliberately not the
 *  painter's own name: the name has to stay the power-of-two canvas texture
 *  the scene bakes, so every `add.image(..., ART_FRAME)` call site keeps
 *  working untouched. */
export function spriteLoadKey(name: SpriteName): string {
  return `sprite:${name}`;
}

const loaded = new Map<SpriteName, HTMLImageElement>();
const waiting = new Set<() => void>();
let started = false;

/**
 * Starts fetching all four. Safe to call from anywhere and any number of
 * times; a no-op on the server and after the first call.
 */
export function loadSprites(): void {
  if (started || typeof window === "undefined" || typeof Image === "undefined") return;
  started = true;
  for (const name of SPRITE_NAMES) {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      loaded.set(name, img);
      for (const cb of [...waiting]) cb();
    };
    // A sprite that fails to load is not an error worth breaking the farm
    // over: the painter it wraps is still there and still draws.
    img.onerror = () => {};
    img.src = SPRITE_ART[name];
  }
}

/** The decoded image, or null while it is still coming. */
export function spriteImage(name: SpriteName): HTMLImageElement | null {
  loadSprites();
  const img = loaded.get(name);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Calls back every time another sprite arrives, so a canvas that already
 * painted the fallback can paint again. Returns its own unsubscribe.
 */
export function onSpriteReady(cb: () => void): () => void {
  loadSprites();
  waiting.add(cb);
  return () => waiting.delete(cb);
}

/** True once every sprite has arrived — lets a caller stop re-subscribing. */
export function allSpritesReady(): boolean {
  return SPRITE_NAMES.every((n) => spriteImage(n) !== null);
}
