# Source artwork

Masters for anything the app ships as an optimized derivative. Kept in the
repo because these are not reproducible: re-generating them yields different
people, so losing them means every existing avatar changes identity.

## Avatars

`art/avatars/<catalog-id>.png` — one transparent cut-out per character,
half-body, hands resting on a rail.

The filename is the contract. It must match an `id` in `avatarCosmetics`
(`lib/cosmetics/catalog.ts`); that is the only thing joining a character to
its artwork, and `lib/cosmetics/catalog.test.ts` fails if either derivative
is missing for an entry.

To add one: drop `art/avatars/avatar-<name>.png`, append the matching entry to
`avatarCosmetics`, then

    scripts/prepare-avatars.sh art/avatars

which writes `public/avatars/<id>.webp` (the figure, for store cards) and
`public/avatars/<id>-face.webp` (a head crop, for the small circles). Nothing
counts the roster, so the number of avatars is only ever what is in the array.

Re-run it after replacing any master; the derivatives are build output and are
committed only so a deploy needs no image tooling.
