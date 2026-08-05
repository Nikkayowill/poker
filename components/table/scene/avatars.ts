import * as THREE from "three";
import { LAYERS, SEAT_RING, SHADOW_ANCHOR } from "@/lib/scene/scene-config";
import { ringPoint, seatPlacement } from "@/lib/scene/seat-ring";
import { lerp, lerpFactorForDelta } from "@/lib/scene/chip-physics";
import { radialFalloffTexture } from "./chip-texture";

/**
 * Layer C -- the people.
 *
 * The middle of the sandwich, and the only layer that reacts to the game.
 * Each player is one `THREE.Sprite`: a flat cut-out that the renderer keeps
 * square-on to the camera for free, which is exactly what a billboard is for.
 * The existing avatar artwork (`public/avatars/avatar-*.webp`, 512x630 to
 * 512x755) is already a half-body cut-out on transparency, so it goes onto a
 * sprite untouched -- there was never a modelling step to skip.
 *
 * WHY A SPRITE AND NOT A PLANE. A plane would need its rotation driven every
 * frame to face a camera that never moves, which sounds free and is not: it
 * would mean touching six matrices per frame in a loop whose entire purpose
 * is to not run. A sprite's billboarding happens in the vertex shader, so it
 * costs nothing and cannot drift out of sync with the camera.
 *
 * WHY alphaTest AND NOT transparent. A transparent sprite does not write
 * depth, and without depth writes the rim (Layer D) cannot cut across a
 * player's chest -- the whole illusion collapses and every avatar floats in
 * front of the rail. `alphaTest` keeps the cut-out's transparency while still
 * writing depth for the pixels that survive it, which is what makes the
 * sandwich work.
 */

/** What one seat needs to say about itself for this layer to draw it. */
export interface AvatarSeatView {
  id: string;
  /** Ring slot, 0 being the near edge -- the same index the DOM seats use. */
  slot: number;
  /** The half-body cut-out, or null to fall back to a monogram. */
  artworkUrl: string | null;
  /**
   * An uploaded photo, which wins over the cosmetic figure exactly as it does
   * on the DOM seat. It is a square crop with no cut-out, so it cannot stand
   * up as a body -- it is masked to a disc where the head would be, which is
   * the same compromise `.seat-figure-photo` makes for the same reason.
   */
  photoUrl: string | null;
  initials: string;
  accent: string;
  /** Folded, sat out, or away: present at the table but out of the hand. */
  dimmed: boolean;
  /** On the clock. */
  active: boolean;
  /** Empty seats keep their chair and lose their occupant. */
  occupied: boolean;
}

/**
 * How lit a player is.
 *
 * A sprite material ignores scene lighting entirely -- it is emissive by
 * construction -- so the lamp's falloff has to be applied by hand as a tint.
 * That turns out to be an advantage: it means "in the hand", "folded" and "on
 * the clock" can be *lighting* states rather than badges, which is a great
 * deal closer to how a real table communicates the same information.
 */
const TINT = {
  active: 1.0,
  idle: 0.66,
  dimmed: 0.3,
} as const;

/**
 * A small forward lean when the action reaches a player, and a settle back
 * when it leaves.
 *
 * The one piece of movement in this layer, and it is deliberately a
 * transition rather than a loop. A permanent idle bob would hold the render
 * loop awake forever, which is the exact thing `render-scheduler.ts` exists
 * to prevent -- a table would never sleep and the battery saving would be
 * fictional. A motion that *ends* costs a few hundred milliseconds of frames
 * when the turn changes and nothing at all in between.
 */
const ACTIVE_LEAN = 0.16;

/** Close enough to the target tint and lean to stop animating. */
const SETTLED = 0.004;

interface AvatarEntry {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  shadow: THREE.Mesh;
  shadowMaterial: THREE.MeshBasicMaterial;
  baseY: number;
  baseZ: number;
  tint: number;
  targetTint: number;
  lean: number;
  targetLean: number;
  /** The URL currently uploaded, so a re-sync does not re-fetch. */
  textureUrl: string | null;
}

/**
 * Monogram fallback, mirroring the DOM seat's own.
 *
 * The artwork can be missing, still loading, or 404 for a cosmetic that was
 * never uploaded, and a seat with a hole in it is worse than a seat with a
 * letter in it. Drawn on the seat's accent colour so it is still recognisably
 * that player rather than a grey disc.
 */
function monogramTexture(initials: string, accent: string): THREE.CanvasTexture {
  const size = 256;
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  const ctx = element.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(1, "#15181d");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.font = `600 ${size * 0.34}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials.slice(0, 2).toUpperCase(), size / 2, size / 2 + size * 0.02);
  }
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class AvatarLayer {
  private readonly entries = new Map<string, AvatarEntry>();
  private readonly loader = new THREE.TextureLoader();
  /** One upload per artwork file, however many seats are wearing it. */
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly shadowTexture: THREE.Texture;
  private seatCount: number;

  constructor(
    private readonly group: THREE.Group,
    seatCount: number,
    /** Called when a texture arrives, so the sleeping loop can draw it. */
    private readonly onChanged: () => void,
  ) {
    this.seatCount = seatCount;
    this.shadowTexture = radialFalloffTexture(128, SHADOW_ANCHOR.opacity);
  }

  /** Reconcile the layer against the current snapshot. */
  sync(views: AvatarSeatView[], seatCount: number): void {
    this.seatCount = seatCount;
    const seen = new Set<string>();

    for (const view of views) {
      if (!view.occupied) continue;
      seen.add(view.id);
      const entry = this.entries.get(view.id) ?? this.create(view);
      this.place(entry, view);

      const wantedTint = view.dimmed ? TINT.dimmed : view.active ? TINT.active : TINT.idle;
      const wantedLean = view.active ? ACTIVE_LEAN : 0;
      if (entry.targetTint !== wantedTint || entry.targetLean !== wantedLean) {
        entry.targetTint = wantedTint;
        entry.targetLean = wantedLean;
        this.onChanged();
      }
      this.applyTexture(entry, view);
    }

    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.destroy(entry);
      this.entries.delete(id);
      this.onChanged();
    }
  }

  private create(view: AvatarSeatView): AvatarEntry {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      // See the note at the top: this, not `transparent` alone, is what lets
      // the rim clip a player rather than being drawn behind them.
      alphaTest: 0.35,
      depthWrite: true,
      depthTest: true,
      fog: true,
    });
    const sprite = new THREE.Sprite(material);
    // Anchor at the base, not the middle. SEAT_RING.figureSink is measured
    // from the bottom of the artwork, and the default (0.5, 0.5) centre would
    // bury half of every player under the floor.
    sprite.center.set(0.5, 0);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: SHADOW_ANCHOR.opacity,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;

    this.group.add(sprite);
    this.group.add(shadow);

    const entry: AvatarEntry = {
      sprite,
      material,
      shadow,
      shadowMaterial,
      baseY: 0,
      baseZ: 0,
      tint: TINT.idle,
      targetTint: TINT.idle,
      lean: 0,
      targetLean: 0,
      textureUrl: null,
    };
    this.entries.set(view.id, entry);
    return entry;
  }

  private place(entry: AvatarEntry, view: AvatarSeatView): void {
    const placement = seatPlacement(view.slot, this.seatCount);
    entry.baseY = placement.position.y;
    entry.baseZ = placement.position.z;
    entry.sprite.position.set(placement.position.x, placement.position.y, placement.position.z);

    // The shadow sits on the floor under the chair, not under the sprite's
    // base -- the sprite hangs from the rail, so its own foot is nowhere near
    // the ground.
    const ground = ringPoint(view.slot, this.seatCount, LAYERS.avatar.ringScale, SHADOW_ANCHOR.y);
    entry.shadow.position.set(ground.x, SHADOW_ANCHOR.y, ground.z);
    entry.shadow.scale.set(SHADOW_ANCHOR.radius, SHADOW_ANCHOR.radius * 0.7, 1);
  }

  private applyTexture(entry: AvatarEntry, view: AvatarSeatView): void {
    // A photo wins outright, matching the DOM seat's own precedence.
    const url = view.photoUrl ?? view.artworkUrl;
    if (url === entry.textureUrl) return;
    entry.textureUrl = url;

    const fallback = () => {
      const texture = monogramTexture(view.initials, view.accent);
      entry.material.map = texture;
      entry.material.needsUpdate = true;
      this.sizeSprite(entry, 1);
      this.onChanged();
    };

    if (!url) {
      fallback();
      return;
    }

    const cached = this.textures.get(url);
    if (cached) {
      entry.material.map = cached;
      entry.material.needsUpdate = true;
      this.sizeSprite(entry, aspectOf(cached));
      this.onChanged();
      return;
    }

    if (view.photoUrl && url === view.photoUrl) {
      this.loadPhoto(entry, url, view);
      return;
    }

    this.loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        // The artwork is already 512px on its long edge, comfortably inside
        // MAX_TEXTURE_PX, so there is nothing to downscale here -- but
        // mipmaps still matter: a far seat draws its 512px cut-out into
        // maybe 60 screen pixels, and without them the edges crawl.
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        this.textures.set(url, texture);
        // The seat may have changed hands while this was in flight.
        if (entry.textureUrl !== url) return;
        entry.material.map = texture;
        entry.material.needsUpdate = true;
        this.sizeSprite(entry, aspectOf(texture));
        this.onChanged();
      },
      undefined,
      // A missing cosmetic file is an ordinary state here, not an exception:
      // the DOM seat has always fallen back to a monogram for exactly this.
      () => { if (entry.textureUrl === url) fallback(); },
    );
  }

  /**
   * An uploaded photo, masked to a disc.
   *
   * Drawn through a canvas rather than handed to the texture loader, because
   * a square photo on a billboard is a floating rectangle -- there is no
   * cut-out to make a body out of. Cropped square from the centre first, so a
   * portrait upload is not squeezed into a circle.
   *
   * Loaded with `crossOrigin` set: avatars come from Supabase Storage on a
   * different origin, and an image drawn into a canvas without CORS taints it
   * and makes the upload throw rather than merely look wrong.
   */
  private loadPhoto(entry: AvatarEntry, url: string, view: AvatarSeatView): void {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (entry.textureUrl !== url) return;
      const size = 256;
      const element = document.createElement("canvas");
      element.width = size;
      element.height = size;
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
      ctx.clip();
      const side = Math.min(image.width, image.height);
      ctx.drawImage(
        image,
        (image.width - side) / 2,
        (image.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      ctx.restore();
      const texture = new THREE.CanvasTexture(element);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(url, texture);
      entry.material.map = texture;
      entry.material.needsUpdate = true;
      // A disc, not a body: sized square and shorter than a figure, so it
      // sits where a head would rather than filling a whole seat.
      entry.sprite.scale.set(SEAT_RING.figureHeight * 0.62, SEAT_RING.figureHeight * 0.62, 1);
      this.onChanged();
    };
    image.onerror = () => {
      if (entry.textureUrl !== url) return;
      const texture = monogramTexture(view.initials, view.accent);
      entry.material.map = texture;
      entry.material.needsUpdate = true;
      this.sizeSprite(entry, 1);
      this.onChanged();
    };
    image.src = url;
  }

  /** Height is fixed; width comes from the artwork, so nobody gets stretched. */
  private sizeSprite(entry: AvatarEntry, aspect: number): void {
    entry.sprite.scale.set(SEAT_RING.figureHeight * aspect, SEAT_RING.figureHeight, 1);
  }

  /**
   * Advance the tint and lean transitions. Returns whether anything moved,
   * which is what tells the scheduler it may not sleep yet.
   */
  update(deltaMs: number): boolean {
    const factor = lerpFactorForDelta(deltaMs, 0.14);
    let moved = false;
    for (const entry of this.entries.values()) {
      if (Math.abs(entry.tint - entry.targetTint) > SETTLED) {
        entry.tint = lerp(entry.tint, entry.targetTint, factor);
        moved = true;
      } else {
        entry.tint = entry.targetTint;
      }
      if (Math.abs(entry.lean - entry.targetLean) > SETTLED) {
        entry.lean = lerp(entry.lean, entry.targetLean, factor);
        moved = true;
      } else {
        entry.lean = entry.targetLean;
      }
      entry.material.color.setScalar(entry.tint);
      // The lean is toward the table, which from a fixed camera reads as
      // rising slightly and coming forward -- so it is applied on both axes
      // rather than as a rotation a billboard would discard anyway.
      entry.sprite.position.y = entry.baseY + entry.lean * 0.5;
      entry.sprite.position.z = entry.baseZ - Math.sign(entry.baseZ || 1) * entry.lean;
      entry.shadowMaterial.opacity = SHADOW_ANCHOR.opacity * (0.4 + 0.6 * entry.tint);
    }
    return moved;
  }

  private destroy(entry: AvatarEntry): void {
    this.group.remove(entry.sprite);
    this.group.remove(entry.shadow);
    entry.material.dispose();
    entry.shadowMaterial.dispose();
    entry.shadow.geometry.dispose();
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.destroy(entry);
    this.entries.clear();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.shadowTexture.dispose();
  }
}

function aspectOf(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image?.height) return 1;
  return image.width / image.height;
}
