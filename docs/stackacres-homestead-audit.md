# The Homestead, played through

2026-09-22, against main at `eea981dc`. A fresh guest profile: 2,000 Gold, a trowel, a scythe, six
starter soil squares, nothing else. Walked the whole map, went into every building, and played the
opening goal to the point where it completes.

Every other district is hidden behind `HOMESTEAD_ONLY` in `components/arcade/stackacres-td/scene.ts`,
so the Homestead and the Crop Fields are the whole game right now. This is a list of what is weak
about them, worst first.

## 1. The Crop Fields are an empty green field

Walk north through the gate and there is nothing there. No beds, no fence, no path, no tree, no
rock, no landmark of any kind. Noise-textured grass to the edge in every direction, and a farmer
standing in the middle of it.

Seven of the eleven travelers are gated on "Break ground in the Crop Fields" (`story.travelers`, on
a new profile). It is where the farming is meant to happen and where the story funnels the player.
It is currently blank ground.

This one is worth more than everything else on this list combined.

## 2. The Homestead is roughly half empty

Every building sits along the top edge. The southern half, between the road and the pond and the
ground around the hen pen, is bare grass with scattered flower and pebble details. A player can
walk for ten seconds and pass nothing they can touch.

The whole map is 704x512 px with 309 props, and 12 of those props are tagged as something a player
can interact with: 4 trees, 4 forage bushes, a well, a signpost, a dock, a pen.

## 3. The starter farm is one small bed, and it does not read as soil

Six soil squares (`soilTiles`, origin `starter`), tucked into the lower left. The bed art reads as
brown horizontal slats, closer to a wooden pallet or a boardwalk than to dug earth. On the opening
screen of a farming game, aimed at a young audience, that is the one object that should be instantly
legible for what it is.

## 4. The hen pen is a large empty yard

A fence, a coop, and nothing inside it. It takes up a good share of the south-east quarter.

## 5. Ray is not in his own shop

His welcome says "The barn is my supply store." He then stands out on the road while the counter
inside the barn is unattended. The barn interior is one of the best-looking rooms in the game and
nobody is in it.

## 6. The player and Ray look almost identical

Two farmers of the same size, both in hats and work clothes in the same palette, standing a few
tiles apart on arrival. On a phone in landscape it is genuinely hard to tell which one is you.

## 7. Five of the nine exits lead nowhere

`public/stackacres-td/areas/homestead/area.json` has exits to barn, workshop, farmhouse, oldfields,
fold, oak, mine, coast and townsquare. The last five are hidden. The roads still run to the map edge
and stop, so a player who follows one gets a dead end with no explanation.

## 8. The goal badge drops the half that says where to go

The full first-chapter line is "The Mill still wants 15 more Wood. Chop the trees around the farm."
The badge on the HUD shows only the first sentence. The part that answers "where" is the part that
gets cut.

## 9. Ray's welcome describes things the player does not have

"Plant wheat in your beds" on a profile whose `seedStock` is empty, with one six-square bed. The
Mill he mentions does not exist yet either, which is what the first goal is for.

## 10. Energy does nothing in the opening

Chopping all four trees is twelve swings and costs zero energy. The bar sits at 100 the whole time
while occupying the top of the screen. Only fishing (5) and land clearing (2, currently unreachable)
spend any.

## What works, and should not be touched

- **The barn and workshop interiors.** Warm light through the windows, shelves, barrels, a
  workbench, a stove, a rug. Easily the best-looking rooms in the game.
- **The opening goal loop.** Four trees, three swings each, 20 Wood against the Mill's 15, and the
  badge flips to "You can put up the Mill now." About two minutes, and nothing about it is
  confusing.
- **The edges of the map.** The treeline, the pond and the river all read well.

## How this was measured

A throwaway Playwright spec against the memory-mode dev server: fresh profile, admin grant, then
`scene.placeFarmer` to stand in each quarter of the Homestead, in the Crop Fields and in each of the
three rooms, screenshotting each. The opening goal was played through the actions API and the badge
text read back off the HUD. The spec was not kept; it asserted nothing worth keeping.
