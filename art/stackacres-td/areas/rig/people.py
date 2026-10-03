"""Who stands where. Every person is on the character rig now (characters/rig/wardrobe.py),
so an area places them with `Area.character(name, x, y)`; this module only names the cast.
Ray is drawn as himself: he is not a ghost (Kayo, 2026-09-16)."""

RIG_CHARACTERS = ["ray", "farmer"]
# Eight travelers left with the six districts they stood in (2026-09-28, lib/stackacres/story/travelers.ts's
# own header): Pierre and Ivy are what remain, both on the Homestead.
TRAVELERS = ["pierre", "ivy"]
CAST = RIG_CHARACTERS + TRAVELERS
