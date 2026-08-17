# Source artwork

Masters for anything the app ships as an optimized derivative. Kept in the
repo because these are not reproducible: re-generating them yields different
people, so losing them means every existing character changes identity.

## Seats (2.5D racetrack table) — also the avatar roster

`art/seats/<character>/<angle>.png` — a character shot at one or more turns
away from facing the camera (0, 20, 40deg...), always turning toward
screen-left; see `scripts/prepare-seat-art.py`'s own docstring for the full
framing/keying contract.

One id space serves two jobs now, deliberately not two separate systems: this
bucket dresses the five opponent seats on the racetrack table AND is the
`avatarCosmetics` catalog's own artwork (`lib/cosmetics/catalog.ts`'s
`characterAvatarCosmetics`, sold and equipped through `/collection`). Buying
a character in the store and being drawn as that character at your own seat
are the same claim — see `lib/scene/seat-art.ts` and `avatarFigure`/
`avatarFace`'s own comments for how a purchase lands at a table.

The filename is the contract. A character's id must match an entry in
`characterAvatarOffers` (`lib/cosmetics/catalog.ts`) or the catalog build
throws; a character needs only its `0.png` to be playable and purchasable —
`pickSeatArt` falls back to it for every seat, and the store's angle preview
just shows the one plate, until wider turns exist.

    scripts/prepare-seat-art.py art/seats

writes `public/table2d5/seats/<character>/<angle>.webp` and regenerates
`lib/scene/seat-art.generated.ts`.
