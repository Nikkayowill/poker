/**
 * The avatar catalog: every option a player can wear, defined in code rather
 * than the database. Adding a hairstyle is a new entry here plus a shape in
 * the renderer -- no migration, no seed data, and the compiler catches any
 * reference that doesn't exist.
 *
 * Art direction is adult stylized portraiture, not caricature: a restrained,
 * slightly desaturated palette, bold silhouettes that survive being drawn at
 * 40px in a seat, and character carried by shape rather than exaggeration.
 */

export interface AvatarOption<Id extends string> {
  id: Id;
  label: string;
}

export interface ColorOption<Id extends string> extends AvatarOption<Id> {
  value: string;
  /** A darker tone of the same colour, used for contact shadow and depth. */
  shade: string;
}

export type SkinToneId =
  | "porcelain" | "sand" | "honey" | "amber"
  | "sienna" | "umber" | "espresso" | "ebony";

export const skinTones: ColorOption<SkinToneId>[] = [
  { id: "porcelain", label: "Porcelain", value: "#f0d2bb", shade: "#d8b099" },
  { id: "sand", label: "Sand", value: "#e6ba97", shade: "#c99a76" },
  { id: "honey", label: "Honey", value: "#d69f73", shade: "#b67f55" },
  { id: "amber", label: "Amber", value: "#bd8352", shade: "#9c663b" },
  { id: "sienna", label: "Sienna", value: "#9e653c", shade: "#7e4c2a" },
  { id: "umber", label: "Umber", value: "#7a4a2a", shade: "#5d351b" },
  { id: "espresso", label: "Espresso", value: "#58341f", shade: "#412413" },
  { id: "ebony", label: "Ebony", value: "#3c2216", shade: "#2a170e" },
];

export type HairColorId =
  | "jet" | "coffee" | "chestnut" | "auburn"
  | "copper" | "wheat" | "ash" | "silver";

export const hairColors: ColorOption<HairColorId>[] = [
  { id: "jet", label: "Jet", value: "#1b1a1f", shade: "#0e0d11" },
  { id: "coffee", label: "Coffee", value: "#392a21", shade: "#241913" },
  { id: "chestnut", label: "Chestnut", value: "#5a3823", shade: "#3d2516" },
  { id: "auburn", label: "Auburn", value: "#7a3a21", shade: "#552514" },
  { id: "copper", label: "Copper", value: "#a1552b", shade: "#7a3c1c" },
  { id: "wheat", label: "Wheat", value: "#c6a063", shade: "#a07d45" },
  { id: "ash", label: "Ash", value: "#8b877f", shade: "#6b675f" },
  { id: "silver", label: "Silver", value: "#d2cfc8", shade: "#a9a59d" },
];

export type HairStyleId = "shaved" | "crop" | "sweep" | "curls" | "tied" | "long";

export const hairStyles: AvatarOption<HairStyleId>[] = [
  { id: "shaved", label: "Shaved" },
  { id: "crop", label: "Crop" },
  { id: "sweep", label: "Sweep" },
  { id: "curls", label: "Curls" },
  { id: "tied", label: "Tied back" },
  { id: "long", label: "Long" },
];

export type FaceId = "calm" | "sharp" | "wry" | "stoic" | "bright" | "weary";

export const faces: AvatarOption<FaceId>[] = [
  { id: "calm", label: "Calm" },
  { id: "sharp", label: "Sharp" },
  { id: "wry", label: "Wry" },
  { id: "stoic", label: "Stoic" },
  { id: "bright", label: "Bright" },
  { id: "weary", label: "Weary" },
];

export type FacialHairId = "clean" | "stubble" | "moustache" | "goatee" | "full";

export const facialHairs: AvatarOption<FacialHairId>[] = [
  { id: "clean", label: "Clean" },
  { id: "stubble", label: "Stubble" },
  { id: "moustache", label: "Moustache" },
  { id: "goatee", label: "Goatee" },
  { id: "full", label: "Full beard" },
];

export type OutfitId = "tee" | "shirt" | "jacket" | "roll" | "waistcoat";

export const outfits: AvatarOption<OutfitId>[] = [
  { id: "tee", label: "Tee" },
  { id: "shirt", label: "Open shirt" },
  { id: "jacket", label: "Jacket" },
  { id: "roll", label: "Roll neck" },
  { id: "waistcoat", label: "Waistcoat" },
];

/**
 * A player's chosen appearance. Stored as JSONB so a new category can be
 * added without a schema change; unknown or missing values fall back through
 * `normalizeAvatar`, so an older saved config never renders broken.
 */
export interface AvatarConfig {
  skinTone: SkinToneId;
  hairStyle: HairStyleId;
  hairColor: HairColorId;
  face: FaceId;
  facialHair: FacialHairId;
  outfit: OutfitId;
}

export const defaultAvatar: AvatarConfig = {
  skinTone: "honey",
  hairStyle: "crop",
  hairColor: "coffee",
  face: "calm",
  facialHair: "clean",
  outfit: "shirt",
};

function pick<Id extends string>(options: AvatarOption<Id>[], value: unknown, fallback: Id): Id {
  return options.some((option) => option.id === value) ? (value as Id) : fallback;
}

/** Coerces anything stored or sent by a client into a renderable config. */
export function normalizeAvatar(raw: unknown): AvatarConfig {
  const input = (raw ?? {}) as Partial<Record<keyof AvatarConfig, unknown>>;
  return {
    skinTone: pick(skinTones, input.skinTone, defaultAvatar.skinTone),
    hairStyle: pick(hairStyles, input.hairStyle, defaultAvatar.hairStyle),
    hairColor: pick(hairColors, input.hairColor, defaultAvatar.hairColor),
    face: pick(faces, input.face, defaultAvatar.face),
    facialHair: pick(facialHairs, input.facialHair, defaultAvatar.facialHair),
    outfit: pick(outfits, input.outfit, defaultAvatar.outfit),
  };
}

function channels(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Blends two colours. Used to turn a player's bright accent into cloth: worn
 * at full saturation across a whole torso it reads as a hi-vis jacket, which
 * is the opposite of the room this game is set in. Mixed down toward the
 * felt's near-black it keeps the identity while staying in the dark.
 */
export function mixColor(hex: string, toward: string, amount: number): string {
  const [r1, g1, b1] = channels(hex);
  const [r2, g2, b2] = channels(toward);
  const blend = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `#${[blend(r1, r2), blend(g1, g2), blend(b1, b2)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function skinTone(id: SkinToneId): ColorOption<SkinToneId> {
  return skinTones.find((tone) => tone.id === id) ?? skinTones[2];
}

export function hairColor(id: HairColorId): ColorOption<HairColorId> {
  return hairColors.find((color) => color.id === id) ?? hairColors[1];
}

/**
 * Six starter figures spanning the option space, offered as one-tap presets
 * so a new player gets a character they like without touching six controls.
 */
export const starterAvatars: { id: string; label: string; config: AvatarConfig }[] = [
  {
    id: "the-regular",
    label: "The Regular",
    config: { skinTone: "sand", hairStyle: "crop", hairColor: "coffee", face: "calm", facialHair: "stubble", outfit: "shirt" },
  },
  {
    id: "the-shark",
    label: "The Shark",
    config: { skinTone: "porcelain", hairStyle: "sweep", hairColor: "jet", face: "sharp", facialHair: "clean", outfit: "jacket" },
  },
  {
    id: "the-veteran",
    label: "The Veteran",
    config: { skinTone: "amber", hairStyle: "shaved", hairColor: "ash", face: "stoic", facialHair: "full", outfit: "roll" },
  },
  {
    id: "the-closer",
    label: "The Closer",
    config: { skinTone: "umber", hairStyle: "curls", hairColor: "jet", face: "bright", facialHair: "goatee", outfit: "waistcoat" },
  },
  {
    id: "the-quiet-one",
    label: "The Quiet One",
    config: { skinTone: "sienna", hairStyle: "tied", hairColor: "chestnut", face: "wry", facialHair: "clean", outfit: "tee" },
  },
  {
    id: "the-nightowl",
    label: "The Night Owl",
    config: { skinTone: "espresso", hairStyle: "long", hairColor: "auburn", face: "weary", facialHair: "clean", outfit: "jacket" },
  },
];
