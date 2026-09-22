# The people, built from LPC

The StackAcres cast is composited from the [Universal LPC Spritesheet Character
Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator).
It is a web app; this is the same art and the same JSON definitions driven from Python, so the whole
cast rebuilds from one command and a character is a list of clothes instead of a drawing job.

    git clone https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator.git ~/deps/lpc-generator
    python3 build.py              # everyone, into public/stackacres-td/characters/
    python3 build.py farmer ray   # just these
    python3 verify.py out         # draw the built sheets, the way the game reads them
    python3 review.py out         # the comparison pictures: today, three heights, the GIFs

`LPC_ROOT` points at the checkout if it is not `~/deps/lpc-generator`.

## The files

| file | what it is |
|---|---|
| `lpc.py` | the compositor. Layers, palettes, animations, the oversize tool sheets, the licence check |
| `cast.py` | who everyone is: their clothes, their colours, and `TARGET_HEIGHT` |
| `build.py` | the game's sheets. Frame layout, action mapping, palette reduction, `CREDITS.md` |
| `verify.py` | reads the built PNG and its tags back, so a layout mistake shows as a broken picture |
| `mockup.py` | drops sprites into a real area, the way the game draws it |
| `review.py` | the before and after pictures for a review page |

## Things that cost an hour to find out

- **A layer's colour is a file or a palette, never both.** An item with a `variants` list keeps its
  colours as files (`walk/green.png`); everything else is one sheet recoloured from
  `palette_definitions/`. The ramp the art is drawn in is named in `meta_<material>.json`, not the
  first key of the palette file.
- **Most clothes were only drawn for the six original LPC animations.** An apron has no `idle`
  sheet, so the garment vanishes on the standing pose unless its walk pose is held. `lpc.py` holds
  it and `report()` says which.
- **On the slim body, trousers stop at the knee** and the boot covers the rest, so trousers only
  read as trousers when the boot is the same colour.
- **The axe and the fishing rod live on 128px sheets** with their own frame order. `lpc.CUSTOM`
  carries that order and `custom_frames()` pulls the body from the standard animation underneath.
- **LPC draws people 50px tall; the game's frame is 48px with the feet on row 44.** 44 is the
  tallest that fits. Everything below 50 is a resize, so it is softer than the source.

## The sheet is a contract

`components/arcade/stackacres-td/scene.ts` names standing frames by index (`1`, `5`, `9`, `13`) and
`lib/stackacres-td/fishing-cast.ts` names the fish and harvest tags by index. A sheet has to come out
frame for frame like the one it replaces: 48x48, four to a row, tags walk, harvest, water, chop,
fish, shoot, then idle, four frames each, four directions. The player also gets an eight frame walk
appended, which the walk tags point at.

## Credit is not optional

The art is CC0, OGA-BY and CC-BY. All but CC0 ask for the artists to be named somewhere a player can
reach. `build.py` writes `CREDITS.md` next to the sheets, `components/info/credits-page.tsx` names
the artists and links it, and `Character.license_problems()` fails loudly on anything share-alike
only. One piece is: LPC's hoe is CC-BY-SA 3.0 and nothing else.
