# StackAcres rooms, the 13-minute day, and sleeping

Written 2026-09-23 with the change that redrew the house, barn and workshop and added the bed.

## What Kayo asked for

Better rooms inside the house, the barn and the workshop, with Stardew Valley's farmhouse as the bar. A bed
you can actually sleep in so time passes. A full day lasts 13 real minutes.

## The rooms

### How Stardew builds a room (research)

- Tiles are 16x16. Wallpaper is 16x48, so a back wall is three tiles tall. Floors come in 32x32 blocks
  (stardewvalleywiki.com Modding:Wallpaper_and_flooring). The starter farmhouse hangs its window at tile row 1
  and stands its first furniture at row 4 (decompiled `FarmHouse.cs`).
- The space outside a room is near-black, (5,3,4) (`Game1.bgColor`). A warm band runs round the room's edge.
  Sampled on Kayo's screenshot it has a plum outline, an orange band, a pale lip inside and a brown shadow line.
- Windows are 1x2 tiles. They throw a patch of daylight on the floor by day. That light goes out at dusk and
  lamps take over (`Game1.cs`: window lights only when it is not dark).
- A double bed is 3x4 tiles. Lamps are 1x3, rugs 3x2, house plants 1x2.
- Furniture casts a 40% black drop shadow.

### What we built

`art/stackacres-td/rich/lpc_rooms.py` builds each room from **LPC Revised** (Eliza Wyatt and the LPC artists,
github.com/ElizaWy/LPC). Every sheet it uses is OGA-BY 3.0, so it can ship commercially, including in the
iOS and Android wrappers, with credit. The sheets are vendored under `art/stackacres-td/lpc/interior/` and
listed in its `CREDITS.md`, which is also published at `/stackacres-td/rooms-CREDITS.md` and linked from the
Credits page.

Nothing is shaded by formula. The code cuts, tiles and places the pack's drawings. The only change to the art
is the room band: the pack's gold border is recoloured, shade for shade, to the orange sampled from Stardew.

The rooms are painted at the pack's 32px per tile and shown at half size, the same as the LPC terrain and
trees outside. They have twice the detail of the old rooms. `interiors.py` hands them to the rig as half-size
stand-ins carrying the full picture, like `lpc_trees.py` does.

- **The house** has a kitchen run with a sink, herbs and a bowl, and a cookstove with its pipe up the wall.
  There is a brick fireplace with a grandfather clock and a bookcase beside it, and a loveseat and two
  armchairs on a green rug. The supper table sits on a blue rug. The double bed has a plaid quilt, a
  nightstand lamp and a wardrobe. There are four curtained windows with flowers on the sills, and plants in
  every corner and either side of the door.
- **The barn** is Ray's shop. It has red board walls with timber posts and Ray's counter with produce on it.
  Market bins of grain run along the back wall, and there are produce crates, feed troughs on straw, tool
  racks and stacked crates and barrels.
- **The workshop** has tool racks along the wall and the carpenter's bench on a blue rug. It also has a
  spinning wheel and loom, a wire-drawing bench, a shavehorse and sawhorse with lumber, and a cookstove.

The tap targets are the same kinds as before:

| Tag | Where | What it does |
|---|---|---|
| `farmhouse` | kitchen counter, cookstove, larder chest | opens the house panel |
| `bed` | the bed | sleep (new) |
| `barn` | Ray's counter | opens the store |
| `workshop` | the carpenter's bench | opens the Workshop |

Each target stands on or beside a rug so a young player can find it. Rebuild with
`python3 art/stackacres-td/rich/export_rich.py --out <scratch> farmhouse barn workshop`, then copy the three
`areas/<room>/` folders into `public/stackacres-td/areas/`.

## Time and sleep

### Precedent (research)

- Stardew runs 6am to 2am in 14 min 20 s of real time (7 s per 10 game minutes). You can sleep at any hour, and
  the farm advances overnight because it is single-player.
- Fields of Mistria's default day is about 12.5 minutes. Sun Haven won't let you end the day before 6pm.
- Palia is always online. Its day is one real hour, it keeps running offline, and beds are decoration.
- Minecraft sleep skips to morning but "does not accelerate processes that take place over time such as the
  growth of crops". This is the only precedent that fits an always-online, server-authoritative game.

### What we built

- One game day, all 24 hours of it, lasts 13 real minutes, so a game hour is 32.5 seconds. The clock is shared
  world time: `(server now + the player's offset) mod 13 min`. See `lib/stackacres/clock.ts`.
- You can sleep from 6 PM to 6 AM. By day the bed says "Not sleepy yet. You can sleep from 6 PM."
- Sleeping moves only that player's clock offset, so it is 6:00 AM right away. It does not touch crop,
  animal or machine timers, energy, the daily limits or Gold. The farm economy stays on real time, as it was.
  This follows the Minecraft precedent above. The server checks the hour itself and writes the new offset with
  a compare-and-set, so a double tap can't move it twice.
- Daylight outside and inside follows the game clock. Indoors, by day the room is bright and the windows lay
  patches of sun on the floor (area.json `lights` of kind `sun`). At night the sun patches fade out and the
  lamps, lanterns, stove and fireplace glow.
- The time shows under the right end of the top bar, like "6:40 PM", in 10-minute steps, with a sun or a moon.
  It sits under the bar because inside it, the bar pushed the More button off a 736px-wide phone.
- The offset lives in `homestead_clock` (migration `20260927090000_stackacres_clock.sql`), which also adds a
  `clock` key to `stackacres_read_batch`. Apply it with the PR. If the code ships without it, sleeping fails.

### Open questions for Kayo

- Should sleeping also refill energy, as it does in Stardew? It doesn't today, because food is how energy comes
  back, and a free refill every 13 minutes would undercut the kitchen.
- Should sleeping fast-forward the farm? Not built, because it would change the economy, and a nightly skip
  would be worth about 4 minutes of growth every 13 minutes.
