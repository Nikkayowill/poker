import {
  hairColor as resolveHairColor,
  mixColor,
  skinTone as resolveSkinTone,
  type AvatarConfig,
  type FaceId,
  type FacialHairId,
  type HairStyleId,
  type OutfitId,
} from "@/lib/avatar/catalog";

/**
 * A layered 2.5D bust, drawn as flat vector shapes stacked back to front.
 * Depth comes from occlusion and one consistent shade per material -- no
 * gradients, filters, or 3D, which keeps six of these cheap to animate on a
 * phone.
 *
 * Framed shoulders-up because that is how a seated player reads across a
 * table, and because the collar and hairline are the details that survive
 * being drawn at 40px in a seat.
 */

const HEAD =
  "M50 17c13 0 21.5 9.6 21.5 23.4 0 15.3-8.8 28.4-21.5 28.4S28.5 55.7 28.5 40.4C28.5 26.6 37 17 50 17Z";

/** Everything the layers need, derived once so the palette stays consistent. */
function palette(config: AvatarConfig, accent: string) {
  const skin = resolveSkinTone(config.skinTone);
  const hair = resolveHairColor(config.hairColor);
  return {
    skin: skin.value,
    skinShade: skin.shade,
    hair: hair.value,
    hairShade: hair.shade,
    // Cloth is the accent mixed well down toward the room's near-black: the
    // player's colour is still legible, but it reads as fabric under a lamp
    // rather than a highlighter.
    cloth: mixColor(accent, "#141a17", 0.68),
    clothLight: mixColor(accent, "#141a17", 0.52),
    trim: mixColor(accent, "#141a17", 0.2),
    linen: "#d9d5c8",
  };
}

type Palette = ReturnType<typeof palette>;

function HairBack({ style, p }: { style: HairStyleId; p: Palette }) {
  switch (style) {
    case "long":
      return (
        <path
          d="M25 46c0-19 11-31 25-31s25 12 25 31c0 15-1.6 27-3.4 38h-9c1.8-14 2.9-25 2.9-36 0-13.5-6.4-21-15.5-21s-15.5 7.5-15.5 21c0 11 1.1 22 2.9 36h-9C26.6 73 25 61 25 46Z"
          fill={p.hairShade}
        />
      );
    case "tied":
      // Sits above the crown so it actually breaks the silhouette -- placed
      // behind the head it was invisible, making this identical to a crop.
      return (
        <g fill={p.hairShade}>
          <ellipse cx="50" cy="12.5" rx="9.5" ry="8" />
          <path d="M44 19h12v6H44z" />
        </g>
      );
    case "curls":
      return <ellipse cx="50" cy="36" rx="25" ry="23" fill={p.hairShade} />;
    default:
      return null;
  }
}

function HairFront({ style, p }: { style: HairStyleId; p: Palette }) {
  switch (style) {
    case "shaved":
      // Not literally bald -- a shadow of growth keeps the silhouette from
      // reading as a featureless egg.
      return <path d={HEAD} fill={p.hair} opacity="0.3" clipPath="url(#rr-crown)" />;
    case "crop":
      return (
        <path
          d="M28.5 41c0-14.4 8.6-24 21.5-24s21.5 9.6 21.5 24c-.6-8.4-3.4-13-7.4-14.6-4.2 3-9 4.2-14.1 4.2s-9.9-1.2-14.1-4.2C31.9 28 29.1 32.6 28.5 41Z"
          fill={p.hair}
        />
      );
    case "sweep":
      // A deep side part with real volume on one side, so it reads as a
      // different cut from the crop rather than a slightly different fringe.
      return (
        <g fill={p.hair}>
          <path d="M28.6 46c-1.6-18 6.6-29 21.4-29 10.6 0 17.6 5 20.8 13.8-3.4-3.4-7.4-5.4-12-6-3.2 5.4-9.4 8.8-18.6 10.2-4 .6-6.6 1.8-8 3.6-1.4 1.8-2.4 4.4-3 7.8-.2-1.4-.4-1.4-.6.6Z" />
          <path d="M64.4 24.6c4.4 2.2 7 6.4 7.8 12.6.6-7.6-1-13-4.8-16.2l-3 3.6Z" />
        </g>
      );
    case "curls":
      return (
        <path
          d="M27 42c-1-9 1-16 5-20 2 2 4 2.6 6 1 2 2.4 4.6 3.2 7.4 2.4 1.6 2.4 4 3.4 7 3.4s5.4-1 7-3.4c2.8.8 5.4 0 7.4-2.4 2 1.6 4 1 6-1 4 4 6 11 5 20-.8-7.6-3-12-6-13.6-4.4 3.2-11 4.6-19.4 4.6s-15-1.4-19.4-4.6C30 30 27.8 34.4 27 42Z"
          fill={p.hair}
        />
      );
    case "tied":
      return (
        <path
          d="M28.5 41c0-14 8.6-24 21.5-24s21.5 10 21.5 24c-1-8.6-4.2-13-8.6-14.6-4 2.8-8.2 3.8-12.9 3.8s-8.9-1-12.9-3.8C32.7 28 29.5 32.4 28.5 41Z"
          fill={p.hair}
        />
      );
    case "long":
      return (
        <path
          d="M28.5 42c0-15.4 8.6-25 21.5-25s21.5 9.6 21.5 25c-1.2-9-4.4-13.6-8.6-15.2-4.2 3-8.8 4-12.9 4s-8.7-1-12.9-4C32.9 28.4 29.7 33 28.5 42Z"
          fill={p.hair}
        />
      );
    default:
      return null;
  }
}

function Face({ face, p }: { face: FaceId; p: Palette }) {
  const ink = "#231913";
  // Brow angle carries expression at small sizes; the eyes stay simple so
  // they never turn to mush when scaled down.
  const brows: Record<FaceId, { l: string; r: string }> = {
    calm: { l: "M38.4 36.6h8.2", r: "M53.4 36.6h8.2" },
    sharp: { l: "M38.4 38l8.2-2.6", r: "M53.4 35.4l8.2 2.6" },
    wry: { l: "M38.4 37.8l8.2-1.8", r: "M53.4 34.6l8.2 1.2" },
    stoic: { l: "M37.8 36h9", r: "M53.2 36h9" },
    bright: { l: "M38.4 35.6l8.2-1.2", r: "M53.4 34.4l8.2 1.2" },
    weary: { l: "M38.4 35.2l8.2 2", r: "M53.4 37.2l8.2-2" },
  };
  const mouths: Record<FaceId, string> = {
    calm: "M44.6 57.4h10.8",
    sharp: "M44.6 57.6h10.8",
    wry: "M44.6 57.6c4 2.4 8 1.6 10.8-1.8",
    stoic: "M44 57.4h12",
    bright: "M44.2 56c4 3.8 8.6 3.8 12.6 0",
    weary: "M44.6 58.6c4-2 7.6-2 10.8 0",
  };
  const lidded = face === "stoic" || face === "weary";

  return (
    <g>
      <g stroke={ink} strokeWidth="2.3" strokeLinecap="round" fill="none" opacity="0.92">
        <path d={brows[face].l} />
        <path d={brows[face].r} />
      </g>
      {lidded
        ? (
          <g stroke={ink} strokeWidth="2.6" strokeLinecap="round">
            <path d="M39.6 44.6h7.4" />
            <path d="M53 44.6h7.4" />
          </g>
        )
        : (
          <g fill={ink}>
            <ellipse cx="43.2" cy="44.6" rx="2.9" ry={face === "bright" ? 3.4 : 2.9} />
            <ellipse cx="56.8" cy="44.6" rx="2.9" ry={face === "bright" ? 3.4 : 2.9} />
          </g>
        )}
      {/* A single stroke reads better than a nose shape at this scale. */}
      <path d="M50 47.6v5" stroke={p.skinShade} strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d={mouths[face]} stroke={ink} strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </g>
  );
}

function FacialHair({ style, p }: { style: FacialHairId; p: Palette }) {
  switch (style) {
    case "stubble":
      return (
        <path
          d="M30.6 45c2 15.6 9.4 23.8 19.4 23.8S67.4 60.6 69.4 45c1.4 16.6-6.4 27.8-19.4 27.8S29.2 61.6 30.6 45Z"
          fill={p.hair}
          opacity="0.3"
        />
      );
    case "moustache":
      return <path d="M42.6 54c2.8-1.8 5-2.4 7.4-2.4s4.6.6 7.4 2.4c-2.2 1.8-4.8 2.6-7.4 2.6s-5.2-.8-7.4-2.6Z" fill={p.hair} />;
    case "goatee":
      return (
        <g fill={p.hair}>
          <path d="M42.6 54c2.8-1.8 5-2.4 7.4-2.4s4.6.6 7.4 2.4c-2.2 1.8-4.8 2.6-7.4 2.6s-5.2-.8-7.4-2.6Z" />
          <path d="M44.4 61.2c1.8-.8 3.7-1.2 5.6-1.2s3.8.4 5.6 1.2c-1 5-3.2 7.8-5.6 7.8s-4.6-2.8-5.6-7.8Z" />
        </g>
      );
    case "full":
      return (
        <g fill={p.hair}>
          <path d="M30.2 43c2 16.4 9.4 25.8 19.8 25.8S67.8 59.4 69.8 43c1.6 18.4-6 30.4-19.8 30.4S28.6 61.4 30.2 43Z" />
          <path d="M42.6 53.6c2.8-1.8 5-2.4 7.4-2.4s4.6.6 7.4 2.4c-2.2 1.8-4.8 2.6-7.4 2.6s-5.2-.8-7.4-2.6Z" />
        </g>
      );
    default:
      return null;
  }
}

function Outfit({ outfit, p }: { outfit: OutfitId; p: Palette }) {
  // Shallower and narrower than a full torso: this is a bust, so the
  // shoulders should suggest a body rather than fill the frame.
  const shoulders = "M13 100c0-13.6 15-21.5 37-21.5S87 86.4 87 100Z";
  return (
    <g>
      <path d={shoulders} fill={p.cloth} />
      {outfit === "tee" && (
        <>
          <path d="M41.6 79c2.2 4.4 5 6.6 8.4 6.6s6.2-2.2 8.4-6.6c-2.7-.6-5.5-.9-8.4-.9s-5.7.3-8.4.9Z" fill={p.skinShade} />
          <path d="M41.6 79c2.2 4.4 5 6.6 8.4 6.6s6.2-2.2 8.4-6.6" stroke={p.clothLight} strokeWidth="1.6" fill="none" />
        </>
      )}
      {outfit === "shirt" && (
        <>
          <path d="M43.4 78.8 50 90.6l6.6-11.8c-2.1-.4-4.3-.6-6.6-.6s-4.5.2-6.6.6Z" fill={p.skinShade} />
          <path d="M43.4 78.8 36 82.6 41.4 100h4.2l-2.2-21.2Z" fill={p.linen} />
          <path d="M56.6 78.8 64 82.6 58.6 100h-4.2l2.2-21.2Z" fill={p.linen} />
        </>
      )}
      {outfit === "jacket" && (
        <>
          <path d="M44.6 78.6 50.6 100h-9.4l-4.2-18.8c2.6-1.2 5.3-2.1 8.2-2.6Z" fill={p.clothLight} />
          <path d="M55.4 78.6 49.4 100h9.4l4.2-18.8c-2.6-1.2-5.3-2.1-8.2-2.6Z" fill={p.clothLight} />
          <path d="M45.4 78.4h9.2c-1.5 4.4-3.1 7.4-4.6 9-1.5-1.6-3.1-4.6-4.6-9Z" fill={p.trim} />
        </>
      )}
      {outfit === "roll" && (
        <path d="M38.6 79.6c3.4 3.8 7.2 5.8 11.4 5.8s8-2 11.4-5.8c-3.6-1-7.4-1.5-11.4-1.5s-7.8.5-11.4 1.5Z" fill={p.clothLight} />
      )}
      {outfit === "waistcoat" && (
        <>
          <path d="M42.4 78.6 50.4 100H41l-4.6-18.6c1.9-1.1 3.9-2 6-2.8Z" fill={p.linen} opacity="0.92" />
          <path d="M57.6 78.6 49.6 100H59l4.6-18.6c-1.9-1.1-3.9-2-6-2.8Z" fill={p.linen} opacity="0.92" />
          <path d="M45.4 78.4h9.2c-1.4 4.2-3 7-4.6 8.6-1.6-1.6-3.2-4.4-4.6-8.6Z" fill={p.trim} />
        </>
      )}
    </g>
  );
}

export function PlayerAvatar({
  config,
  accent,
  size = 64,
  idle = false,
  className,
}: {
  config: AvatarConfig;
  /** The player's chosen accent, worn as their clothing colour. */
  accent: string;
  size?: number | string;
  idle?: boolean;
  className?: string;
}) {
  const p = palette(config, accent);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={[className, idle ? "avatar-idle" : null].filter(Boolean).join(" ")}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="rr-crown">
          <path d="M28.5 40.4C28.5 26.6 37 17 50 17s21.5 9.6 21.5 23.4c0 2.2-.2 4.3-.6 6.4H29.1c-.4-2.1-.6-4.2-.6-6.4Z" />
        </clipPath>
      </defs>

      <g className="avatar-body">
        <Outfit outfit={config.outfit} p={p} />
      </g>

      <g className="avatar-head">
        <HairBack style={config.hairStyle} p={p} />
        <path d="M43.4 58h13.2v20H43.4z" fill={p.skin} />
        {/* The jaw's contact shadow sits over the neck, which is what sells depth. */}
        <path d="M43.4 58h13.2v6.6c-4.4 2.6-8.8 2.6-13.2 0V58Z" fill={p.skinShade} opacity="0.6" />
        <ellipse cx="28.8" cy="45.6" rx="3.6" ry="5" fill={p.skin} />
        <ellipse cx="71.2" cy="45.6" rx="3.6" ry="5" fill={p.skin} />
        <path d={HEAD} fill={p.skin} />
        <Face face={config.face} p={p} />
        <FacialHair style={config.facialHair} p={p} />
        <HairFront style={config.hairStyle} p={p} />
      </g>
    </svg>
  );
}
