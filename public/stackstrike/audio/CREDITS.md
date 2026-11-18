# StackStrike audio sources

Everything here is CC0 (public domain). Credit is not required; it is listed so anyone can check where a
sound came from. Licenses were read from each page's license field on 2026-11-18.
`scripts/stackstrike-audio.py` turns these downloads into the files in this folder.

## Guns

[The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) by Ylmir, CC0.
Real recordings, near-distance takes, cut into single shots.

| Sound here | Recording |
| --- | --- |
| `shot-pistol-*` (your pistol) | Walther PPQ 9mm, `X_39P`, low-passed and shortened so it sounds suppressed |
| `shot-smg-*` (your SMG) | Carl Gustav M45 9mm, `G_31P`, lightly low-passed |
| `shot-shotgun-*` (your shotgun) | Benelli Nova 12 gauge, `O_21P`, lightly low-passed |
| `shot-guard-*` (guards' pistols) | 1911 .45, `A_42P` and `A_34P`, left loud and open |

A little compression and a short low thump are added under each shot (see `punch` in the script).

## Music

[Electric City](https://opengameart.org/content/electric-city) by glitchart, CC0. Two loops of one theme:
part 1 ("relaxed, exploring, stealth") is `music-stealth.mp3`, part 2 ("combat, action") is `music-hunted.mp3`.
Both are leveled with ffmpeg `loudnorm` (hunted is louder on purpose) and encoded as 112 kbps MP3.

## Footsteps, hits and menu sounds

[Kenney](https://kenney.nl) sound packs, CC0, taken from the public GitHub mirrors
[kenney-impact-sounds-for-godot](https://github.com/Boyquotes/kenney-impact-sounds-for-godot) and
[kenney-interface-sounds](https://github.com/Calinou/kenney-interface-sounds).

- `step-soft-*` (you): `footstep_carpet`. `step-boot-*` (guards): `footstep_concrete`.
- `hit-enemy-*`: `impact_punch_medium`. `hit-player-*`: `impact_punch_heavy`. `kill-*`: `impact_soft_heavy`.
- `ricochet-*`: `impact_metal_light`, high-passed.
- `ui-click`, `ui-confirm`, `ui-back`: `click_002`, `confirmation_002`, `back_002`.

## Reloads, heartbeat, alarm

- `reload-pistol`: [Handgun Reload Sound Effect](https://opengameart.org/content/handgun-reload-sound-effect), CC0.
- `reload-smg`: `assaultriflereload1` from [Gun reload sounds](https://opengameart.org/content/gun-reload-sounds) by Joaken, CC0.
- `reload-shotgun`, `shotgun-rack`: `Shell in Chamber` and `Rack` from [Shotgun Reload Sound effects](https://opengameart.org/content/shotgun-reload-sound-effects), CC0.
- `heart-slow`, `heart-fast`: [Heartbeat sounds](https://opengameart.org/content/heartbeat-sounds) by estevinho, CC0 (seamless loops).
- `alarm`: [Short alarm](https://opengameart.org/content/short-alarm) by qubodup, CC0.
- `radio` borrows its crackle from `static1` in [Frequency Static Sound Effects](https://opengameart.org/content/frequency-static-sound-effects) by Gena Sealov, CC0.

## Made in code

`spotted`, `body-found`, `dead`, `escaped`, `pickup-small`, `pickup-main`, `radio` (the beeps), `empty-click`, `swap`
and `hide` are synthesized by `scripts/stackstrike-audio.py`, so they have no source file.

## Looked at and not used

Other CC0 tracks found on OpenGameArt that could be swapped in later (not in the game): EmptyCity (TinyWorlds),
Infiltration, Spy Loop, Covert Action, Tense Drive, Chase! (TheGrovesy), The Hunt, Panic mode, Spy running theme.
Some good stealth tracks are CC-BY or OGA-BY (for example Espionage and Midnight Creeping) and would need credit,
so they were left out.
