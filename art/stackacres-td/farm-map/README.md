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
