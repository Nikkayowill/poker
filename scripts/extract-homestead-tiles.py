"""Cut the named Homestead tiles out of Kenney's CC0 Tiny Farm tilemap.

Kept as a script rather than run by hand so the mapping from a tile's game
meaning to its index in the sheet is written down somewhere. Re-running it is
how you swap the art: point SRC at a different pack, fix the indices, done.

Source: https://kenney.nl/assets/tiny-farm (CC0 1.0 -- free for commercial use,
credit appreciated but not required). 12 columns of 16x16 tiles.

Crop rows are regular: for a crop starting at row R, R*12+4 is the sprout,
R*12+5 the half-grown plant and R*12+6 the ripe one in the ground.
"""

from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
# Not committed -- unzip kenney_tiny-farm.zip next to this script to re-run.
SRC = Path("tiny-farm/Tilemap/tilemap_packed.png")
OUT = REPO / "public" / "homestead" / "tiles"
COLS = 12
TILE = 16

TILES: dict[str, int] = {
    # Ground. `soil` is an idle bed, `soil-rich` the darker worked version that
    # sits under anything growing.
    "soil": 63,
    "soil-rich": 51,
    "scrub": 39,
    "muck": 89,
    # Sprout Row -> carrots. Three stages, sprout to ripe.
    "sprout-1": 4,
    "sprout-2": 5,
    "sprout-3": 6,
    # Cash Crop -> corn.
    "cash_crop-1": 28,
    "cash_crop-2": 29,
    "cash_crop-3": 30,
    # Livestock. The pack has no pig, so the middle pen is a sheep and the
    # catalogue label says so; the stock id stays `pig`.
    "hen": 122,
    "pig": 120,
    "cattle": 121,
    # Toolbelt icons, from the same pack so the dock and the field share one
    # visual language.
    "tool-inspect": 109,
    "tool-plant": 81,
    "tool-harvest": 88,
    "tool-feed": 73,
    "tool-clear": 87,
    # Store and HUD.
    "feed-sack": 74,
    "trough-empty": 72,
    # Produce, as it appears in the bag and on the sell list. The pack has a
    # harvested item for each crop, and a milk pail, but nothing for eggs or
    # fleece -- the nearest candidate (125) reads as a bread loaf. Those two
    # borrow their animal instead, the shorthand a shop list uses when it shows
    # the creature rather than the thing it gave. The label sits beside the
    # icon and carries the meaning.
    "item-carrot": 8,
    "item-corn": 32,
    "item-eggs": 122,
    "item-milk": 124,
    "item-wool": 120,
    # The currency. A wheat sheaf stands in for a bushel.
    "bushels": 68,
}


def main() -> None:
    sheet = Image.open(SRC).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, index in TILES.items():
        col, row = index % COLS, index // COLS
        box = (col * TILE, row * TILE, col * TILE + TILE, row * TILE + TILE)
        sheet.crop(box).save(OUT / f"{name}.png")
    print(f"wrote {len(TILES)} tiles to {OUT}")


if __name__ == "__main__":
    main()
