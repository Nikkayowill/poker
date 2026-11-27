"""Derives the zombie art from the guard art: same drawing, colour drained and lifted so the
scene can tint it green. Run from the repo root: python3 scripts/stackstrike-zombies.py"""
from PIL import Image, ImageOps

ART = "public/stackstrike/art"

for name in ("guard", "arm-guard-upper", "arm-guard-fore"):
    src = Image.open(f"{ART}/{name}.png").convert("RGBA")
    grey = ImageOps.grayscale(src.convert("RGB"))
    # Lift the shadows so a tint does not turn the whole thing black.
    lifted = grey.point(lambda v: min(255, int(70 + v * 0.8)))
    out = Image.merge("RGBA", (lifted, lifted, lifted, src.getchannel("A")))
    out.save(f"{ART}/{name.replace('guard', 'zombie')}.png", optimize=True)
    print("wrote", name.replace("guard", "zombie"))
