# Farmer idle, top-down

One idle pose for the player farmer, made twice on 2026-09-21 so the two art
sources could be compared at game size.

| file | source | cost |
|---|---|---|
| **`farmer-idle-retouched.png`** | **the one to use.** dev+LoRA render, hand-retouched to 31px | free |
| `farmer-idle-schnell-31px.png` | schnell render at the right size, no retouch; a real alternative | free |
| `farmer-idle-spritecook.png` | SpriteCook `gpt-image-2` low, 2K | 2 credits (the last on the free tier) |
| `farmer-idle-rig.png` | the existing rig, `walk_down` frame 0, for comparison | free |
| `oversized-41px/` | the first two sprites, kept only as a record - see below | free |

`compare-with-cast.png` stands the retouched sprite next to two shipped cast
members and the rig farmer, on a shared feet line. `compare.png` is the older
three-way of the raw generator output.

**Everything here was 30% too tall until the retouch.** The cast is 31px on
y=14..45 and 14-16 wide - Stardew draws a 16x32 character on a 16x16 tile, so a
body is ~1.9 tiles, and every sprite in `public/stackacres-td/characters/`
measures exactly that. The first sprites were built 41px tall and would have
towered over everyone. `oversized-41px/` keeps them only so the mistake is
legible; do not ship them.

Both were told the camera by an uploaded strip of the rig's own top-down
frames rather than by words. Describing the projection does not hold it: the
model draws a side face and the sprite goes isometric. Same trap PixelLab and
the SpriteCook props hit.

## SpriteCook

`source/farmer-view-reference.png` in `../spritecook/` is four of the rig's
farmer frames (front rest, front pass, side, back) at 8x, uploaded and passed
as `reference_asset_id`. Output came back 38x38 and needed no cleanup. 2K at
`quality="low"` costs the same 2 credits as 1K, so take the bigger one.

## FLUX on the 4050

Pipeline at `~/.local/share/flux-sprite-test/task-farmer-idle/` (not in git,
it needs the 16GB model cache). Two stages, as the earlier tasks there:
`encode_farmer.py` puts T5-XXL in 4-bit on the GPU alone, `render_farmer.py`
runs the GGUF transformer with sequential offload, about 20s a seed at 640px.
`post_farmer.py` does the rest.

Nothing in the prompt asks for pixel art. Asking schnell for pixels gives soft
fake-pixel mush that survives neither the downscale nor the palette step. It
asks for a flat cartoon figure on white at 640px, and `post_farmer.py` makes
the sprite:

1. Key the plate by flooding inward from the border with the border's own
   modal colour. A global white test eats the hat's pale straw, and one seed
   came back on pale green rather than white.
2. Strip the ground pad. FLUX bakes turf or shadow under the figure and it
   survives the flood where the boots enclose it. Pale and washed out is what
   separates a pad from boot leather: `sat < 25 and lum > 110` in the bottom
   band. A plain brightness test takes the boot highlights too.
3. Box-resize to 41px tall on premultiplied alpha, then re-threshold. Resizing
   straight RGBA bleeds transparent black into the rim.
4. Median-cut to 48 colours. **Not DB16** - that rule is overturned for the
   top-down art, and DB16 has no mid blue, so the denim snapped to grey.
5. Place on 48x48 with feet at y=44, centred on x=23.5: the rig's frame
   contract, so it drops into a sheet slot.

Six seeds all landed usable. 47 has the brown skin closest to the rig's
farmer; 23 is the cleanest silhouette.

## Not done

These are stills. Neither is wired into a sheet or the game, and neither has
the other three directions or any of the rig's six actions.

## What did not work: FLUX.1-dev plus a pixel-art LoRA

2026-09-21, same day. The schnell sprite above is still the best one, and this
section exists so the next person does not spend the afternoon re-running it.

Downloaded dev Q4_K_S (6.8GB) and three pixel-art LoRAs, on the reasoning that
schnell's weak steering was the ceiling. Measured, in order:

- **Resolution does not help; proportion does.** 768x1152 gave far more source
  detail (plaid weave, boot laces, overall stitching) and read WORSE at 48px,
  because FLUX drifted to realistic 1:5 anatomy. At this size the head is most
  of what survives, so a smaller head loses regardless of detail.
  `experiments/compare-resolution.png`.
- **schnell's 4-step distillation is a real ceiling.** 8 steps measured
  identical to 4 at twice the time.
- **dev does obey the chibi instruction**, which schnell would not - real CFG
  at guidance 3.5 produced the correct 1:3 head and a symmetric idle.
  `experiments/dev-lora-source-best-proportions.png` is the best-composed
  source render of the day.
- **And it still loses at 48px.** `experiments/compare-dev-vs-schnell.png`.
  Every dev variant comes out washed out with a blank face next to schnell's.

The reason is consistent across all of it: **at 48px, contrast and silhouette
beat detail and fidelity.** schnell's crude high-contrast cartoon with a heavy
outline is accidentally the right bias. dev renders softer, better-shaded art,
and soft shading becomes mush at 41px tall. The Pokemon-trainer LoRA was worst
of all - it draws genuine pixels (block grid detected at 4px) but its dithered
shading turns to noise and its trained camera fights a square-on front view.

Two things worth keeping from the attempt:

- **LoRA on a GGUF transformer works** in diffusers 0.40, but the adapter must
  load BEFORE `enable_sequential_cpu_offload()`; afterwards the submodules are
  not resident for peft to walk.
- **Both FLUX.1-dev config repos are gated, the weights are not.** Derive the
  config from the cached schnell one and set `guidance_embeds: true`; the
  architectures are otherwise identical.

The remaining gain is not in the model. It is a hand-retouch pass over a clean
render, which is the path the cast faces already established.


## The retouch pass

`retouch_farmer.py`, in the spirit of `../pixellab/retouch.py`: named decisions
over a source that is never written. Run it against
`experiments/dev-lora-source-best-proportions.png`.

Generation got the silhouette and the proportion. It could not get saturation,
separation or an edge, and those are what a 31px sprite is made of. Seven fixes:

1. **Despeckle the keying fringe** before anything reads colour, or the crumbs
   survive as bright specks.
2. **Regions by row, colour by luminance into a three-tone ramp, split at each
   material's own terciles.** Fixed fractions of the range were the first
   attempt and the whole overalls came out one flat dark slab: a few specular
   pixels stretched the range and pushed every ordinary pixel under the cut.
3. **Column position splits bib from sleeve; blue-vs-warm splits hand from
   denim.** Hue alone was tried first and turned the entire shirt into bib,
   because the render shades the sleeves a blue-grey.
4. **Eyes as a light/dark pair.** Brown skin, so a pupil alone lands near the
   skin value and smears - the same failure as Ray's and Brayden's faces.
5. **A hair band under the brim**, so the head is not a bare skin oval.
6. **A seam down the overalls and between the boots.** The reduction fused both
   into one block. The body is 6px across there so the seam cannot sit dead
   centre; 1px off reads as a figure standing with one leg turned, which is
   what standing looks like.
7. **No mouth.** At 31px it is a smudge, and Stardew leaves it off.

Two things that had to be redone:

- **The outline goes outward around a 29px body, not inward around a 31px one.**
  Inward was the first attempt and on a 15px-wide figure it ate both arms - at
  that width the outermost ring *is* the arm.
- **The outline is selective, not flat black.** Each edge pixel is its
  neighbours' colour driven 72% toward the outline tone, so straw keeps a brown
  edge and denim a blue one. A uniform near-black ring read heavier and deader
  than the shipped cast.

`experiments/compare-retouch-value.png` is the honest scoreboard: the retouch
rescues the dev render completely, but **schnell at the correct size, with no
retouch at all, is a genuine contender** - brighter and friendlier, though
softer and without an edge. Both are kept.
