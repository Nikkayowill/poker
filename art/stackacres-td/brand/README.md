# StackAcres brand: barn paint

The logo, icons and UI pieces for StackAcres, drawn as pixel art in Python.

    BALOO_TTF=/path/to/Baloo2-ExtraBold.ttf python3 export.py

writes the UI kit to `public/stackacres-td/ui/` and the logo to `public/brand/stackacres/`.
Baloo 2 ExtraBold is the static TTF from Google Fonts; the app only vendors the woff2.

| file | what it draws |
|---|---|
| `px.py` | the palette (sampled off the Homestead's art) and the pixel helpers |
| `mark.py` | the mark: a stack of poker chips with a field and a sprout on top |
| `wordmark.py` | "Stack" in white and "Acres" in harvest gold, arched, with a barn-red extrusion |
| `lockups.py` | wordmark + mark, stacked and in a row, and the app badge |
| `icons.py` | the 12px and 16px icons |
| `ui.py` | the 9-slice pieces: panel, tags, buttons, slots, cards, tabs, meter, joystick |
| `title.py` | the title screen backdrop, composited from the live Homestead export |

Everything is drawn at one art pixel per image pixel and shown at 2x, the same grid as the map.
`app/styles/52-stackacres.css` holds the slice sizes.
