"""
prepare-stackacres-watering-can-icon.py

Prep for the drag-to-water token's own watering can, off the same
Gr8FarmPack that supplied the crop roster and the clutter props (see
prepare-stackacres-farmpack-crops.py / prepare-stackacres-farmpack-props.py).

This plate is the one the props script's own header lists as permanently out
of scope for it: "trowel/pitchfork/snips/watering can (tool-tier and
drag-to-water systems, not static props)". It has no PROP_FOOT/PROP_SIZE
placement on the isometric grid -- it is a UI icon only, drawn into a plain
24x24 canvas box by stackacres-art.ts's `wateringCanIcon`, the same
aspect-preserving fit `cropIcon` already uses for a crop's own portrait. So,
unlike the world-prop prep scripts, no ART_SCALE-multiple padding: trim to
the plate's own alpha bbox and nothing else.

Output: public/stackacres/sprites/watering-can.png. Then run `pnpm
assets:webp` -- this script writes PNG (Pillow's format), the encoder
converts to what stackacres-sprites.ts actually asks for and deletes the PNG
behind it.
"""

from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "assets-src" / "stackacres-farm-pack-oddblot" / "Gr8FarmPack" / "Watering .png"
DST = REPO / "public" / "stackacres" / "sprites" / "watering-can.png"


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    bbox = im.getbbox()
    if bbox is None:
        raise SystemExit("frame is fully transparent")
    trimmed = im.crop(bbox)
    DST.parent.mkdir(parents=True, exist_ok=True)
    trimmed.save(DST)
    print(f"watering-can: {SRC.name} -> {trimmed.width}x{trimmed.height}px")


if __name__ == "__main__":
    main()
