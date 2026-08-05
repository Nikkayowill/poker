import * as THREE from "three";
import { chipPalette, type ChipPalette } from "@/lib/scene/chip-physics";
import { MAX_TEXTURE_PX } from "@/lib/scene/scene-config";

/**
 * The chip's face and edge, painted rather than downloaded.
 *
 * These replace the four stacked `background-image` layers the CSS chip was
 * built from -- an outer rim, a dark inner groove, an eight-wedge inlay and a
 * bright core -- with the same anatomy drawn once into a canvas and uploaded
 * as a texture. Same look, and now it survives being seen at an angle, which
 * is the one thing a background-image chip could never do.
 *
 * Generated in-process on purpose. A chip face is three arcs and eight
 * wedges; shipping four PNGs of that would be four requests and a few
 * kilobytes each to arrive at a picture the GPU can be handed in under a
 * millisecond of 2D canvas work. It also means the palette lives in exactly
 * one place (`chip-physics.ts`) instead of in one place and in an art file.
 *
 * DELIBERATELY NO DENOMINATION TEXT. Every chip in this scene draws between
 * roughly 8 and 30 screen pixels across. Text that has to fit inside an 8px
 * core is a smear, not a "$100" -- the same call the CSS chips made, and the
 * pot's exact value has a legible home in `.pot-display` regardless.
 */

/**
 * 128px is comfortably enough for a disc that never exceeds ~30 screen
 * pixels, and it is a sixty-fourth of the memory MAX_TEXTURE_PX would allow.
 * Kept a power of two so mipmapping works, which is what stops the wedges
 * shimmering as chips slide.
 */
const FACE_PX = 128;

/** The wedge count on the chip's edge inlay, carried over from the CSS. */
const WEDGES = 8;

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

function canvas(width: number, height: number): { element: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for chip texture");
  return { element, ctx };
}

/**
 * The top of the chip, looking straight down at it.
 *
 * Drawn outside-in, which is the order the radii are stated in: the rim is
 * the whole disc, the groove is scored into it, the wedges are laid over the
 * remaining band, and the core covers the middle.
 */
function drawFace(ctx: CanvasRenderingContext2D, palette: ChipPalette): void {
  const centre = FACE_PX / 2;
  const radius = centre;

  ctx.clearRect(0, 0, FACE_PX, FACE_PX);

  // 100-89%: the outer rim, in the chip's primary colour.
  ctx.fillStyle = hex(palette.base);
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.fill();

  // 45-88%: the eight-wedge inlay, alternating base and accent. Clipped to an
  // annulus rather than drawn as pie slices over the whole face, so the core
  // below stays a clean disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.88, 0, Math.PI * 2);
  ctx.arc(centre, centre, radius * 0.45, 0, Math.PI * 2, true);
  ctx.clip("evenodd");
  for (let wedge = 0; wedge < WEDGES; wedge += 1) {
    ctx.fillStyle = wedge % 2 === 0 ? hex(palette.base) : hex(palette.accent);
    ctx.beginPath();
    ctx.moveTo(centre, centre);
    ctx.arc(
      centre,
      centre,
      radius,
      (wedge * Math.PI * 2) / WEDGES,
      ((wedge + 1) * Math.PI * 2) / WEDGES,
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 85-87%: the dark groove scored between the rim and the inlay. This is
  // what stops a chip reading as a flat sticker at a glance.
  ctx.strokeStyle = "rgba(10, 8, 4, 0.55)";
  ctx.lineWidth = radius * 0.03;
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.865, 0, Math.PI * 2);
  ctx.stroke();

  // 0-42%: the bright matte core.
  ctx.fillStyle = hex(palette.core);
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // A second, tighter groove around the core, for the same reason as the
  // first: two concentric scores read as moulded clay, one reads as a target.
  ctx.strokeStyle = "rgba(10, 8, 4, 0.28)";
  ctx.lineWidth = radius * 0.02;
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.43, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * The chip's edge, unrolled.
 *
 * The one part of a chip that a flat-on CSS disc never had to think about and
 * that this camera looks straight at: chips are seen from 39 degrees above
 * the felt, so a stack shows as much edge as face. Vertical accent bands at
 * the same eight-wedge cadence make a stack read as chips rather than as a
 * striped cylinder.
 */
function drawEdge(ctx: CanvasRenderingContext2D, palette: ChipPalette, width: number, height: number): void {
  ctx.fillStyle = hex(palette.base);
  ctx.fillRect(0, 0, width, height);

  const bandWidth = width / (WEDGES * 2);
  ctx.fillStyle = hex(palette.accent);
  for (let band = 0; band < WEDGES; band += 1) {
    // Inset vertically so the accent never touches the chip's rim, which is
    // what keeps the face's outer ring reading as continuous from any angle.
    ctx.fillRect(band * 2 * bandWidth, height * 0.22, bandWidth, height * 0.56);
  }

  // A darkening top and bottom lip, so stacked chips show a seam.
  const lip = ctx.createLinearGradient(0, 0, 0, height);
  lip.addColorStop(0, "rgba(0, 0, 0, 0.45)");
  lip.addColorStop(0.25, "rgba(0, 0, 0, 0)");
  lip.addColorStop(0.75, "rgba(0, 0, 0, 0)");
  lip.addColorStop(1, "rgba(0, 0, 0, 0.5)");
  ctx.fillStyle = lip;
  ctx.fillRect(0, 0, width, height);
}

export interface ChipMaterials {
  /** In CylinderGeometry's own group order: side, top, bottom. */
  materials: THREE.Material[];
  dispose: () => void;
}

/**
 * The three materials one denomination's chip is built from.
 *
 * `CylinderGeometry` emits its faces in three groups -- side, top, bottom --
 * so handing the mesh an array of three materials textures the edge and the
 * face independently without a custom shader or a second draw call.
 */
export function chipMaterials(denomination: number): ChipMaterials {
  const palette = chipPalette(denomination);

  const face = canvas(FACE_PX, FACE_PX);
  drawFace(face.ctx, palette);
  const faceTexture = new THREE.CanvasTexture(face.element);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  faceTexture.anisotropy = 4;

  const edge = canvas(FACE_PX, FACE_PX / 4);
  drawEdge(edge.ctx, palette, FACE_PX, FACE_PX / 4);
  const edgeTexture = new THREE.CanvasTexture(edge.element);
  edgeTexture.colorSpace = THREE.SRGBColorSpace;
  edgeTexture.wrapS = THREE.RepeatWrapping;

  // Roughness 0.6 per the spec: clay, not plastic and not chalk. It is what
  // gives the lamp a broad soft highlight across a stack instead of a hot
  // point on the top chip.
  const sideMaterial = new THREE.MeshStandardMaterial({ map: edgeTexture, roughness: 0.6, metalness: 0.05 });
  const faceMaterial = new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.6, metalness: 0.05 });

  return {
    materials: [sideMaterial, faceMaterial, faceMaterial],
    dispose: () => {
      faceTexture.dispose();
      edgeTexture.dispose();
      sideMaterial.dispose();
      faceMaterial.dispose();
    },
  };
}

/**
 * A soft radial falloff, used for the avatars' ground shadows and the felt's
 * own centre glow.
 *
 * `size` is asserted against the cap rather than trusted: this is the one
 * generator here that a future caller might reasonably ask for a big version
 * of, and a 2048px blur costs 16MB of VRAM to say exactly what a 256px one
 * says once it has been stretched over a shadow.
 */
export function radialFalloffTexture(size = 128, innerAlpha = 1, colour = "0, 0, 0"): THREE.CanvasTexture {
  const clamped = Math.min(size, MAX_TEXTURE_PX);
  const { element, ctx } = canvas(clamped, clamped);
  const centre = clamped / 2;
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  gradient.addColorStop(0, `rgba(${colour}, ${innerAlpha})`);
  gradient.addColorStop(0.55, `rgba(${colour}, ${innerAlpha * 0.45})`);
  gradient.addColorStop(1, `rgba(${colour}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, clamped, clamped);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The carpet, as a repeating tile.
 *
 * A dark geometric diamond lattice -- the pattern every card room on earth
 * has on its floor, and the reason is the same here as there: a plain dark
 * plane under a spotlight bands visibly, and a busy low-contrast pattern
 * hides the banding without ever being something the eye stops on.
 *
 * 256px tiled, not a 1024px photo. The spec's cap is 1024; this is a
 * sixteenth of it, costs no request at all, and tiles seamlessly by
 * construction rather than by hoping an art file does.
 */
export function carpetTexture(): THREE.CanvasTexture {
  const size = 256;
  const { element, ctx } = canvas(size, size);

  ctx.fillStyle = "#140f10";
  ctx.fillRect(0, 0, size, size);

  // Two overlaid diagonal lattices at different pitches, which is what makes
  // a tile stop looking like a tile once it is repeated across a floor.
  ctx.strokeStyle = "rgba(120, 62, 48, 0.14)";
  ctx.lineWidth = 2;
  for (let offset = -size; offset < size * 2; offset += 32) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + size, size);
    ctx.moveTo(offset + size, 0);
    ctx.lineTo(offset, size);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(180, 140, 90, 0.07)";
  ctx.lineWidth = 1;
  for (let offset = -size; offset < size * 2; offset += 64) {
    ctx.beginPath();
    ctx.moveTo(offset + 16, 0);
    ctx.lineTo(offset + 16 + size, size);
    ctx.moveTo(offset + 16 + size, 0);
    ctx.lineTo(offset + 16, size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(14, 14);
  return texture;
}
