# The farm map design

Design renders of the whole Homestead: where every player starts, and how far a farm can grow.

- `previews/farm-day1.png` is day one: the yard in the middle, the lake running off the top of the map,
  and wild land all round to clear and explore.
- `previews/farm-later.png` is one player's farm a while later, to show the idea. It is not a layout
  the game builds.
- `previews/buildings.png` is the gable-roofed house, barn and workshop.
- `previews/lake-dock-view.png` is the dock at the game's own camera size.

`python3 farm_map.py` renders day one, `STAGE=later python3 farm_map.py` the later farm, and
`python3 ../rich/gable_buildings.py` the buildings sheet.

The game's map is not this render. It is `../areas/rig/homestead.py`, exported by
`../rich/export_rich.py homestead`, which draws the same buildings (`../rich/gable_buildings.py`), flowers
and dock (`../rich/farm_extras.py`) and leaves the wild land's trees, boulders and scrub to the engine
(`lib/stackacres/crop-field-obstacles.ts`), so each one can be cleared.

Everything but the buildings, flowers, dock and boat is the LPC terrain pack
(`../lpc/terrain/Attribution.txt`).

## The player-built Homestead

The newer direction: every farm starts with just the house, and the player places, paves, plants
and moves everything else. The land is clearings in the woods to find, not one open square.

- `previews/explore-day1.png` is day one. The house sits in a clearing. Gaps in the trees lead to
  oak woods with a fairy ring, a stone field and a hidden ring of standing stones. A footbridge
  crosses the stream to a meadow with the ruined old greenhouse, and past the pond is a berry
  thicket. There are no paths.
- `previews/explore-later.png` is one player's farm on the same land a while later, with the barn,
  workshop, paths, fields and orchard they put down.
- `previews/explore-view-bridge.png` and `explore-view-glade-gap.png` are what a phone shows at once.

`python3 explore.py` renders day one and the two views, and `STAGE=later python3 explore.py` renders the
later farm. The woods are single trees with a slight tint each, never the repeating `forest_tile()`
canopy, and they darken the further in you look. Like `farm_map.py`, this is a design render, not
the game's map.
