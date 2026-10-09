# Asset credits

## 0x72 DungeonTileset II

- File: `assets/0x72/dungeon-tileset-ii.png` (v1.7 sheet)
- Author: 0x72
- Source: https://0x72.itch.io/dungeontileset-ii
- License: CC0 1.0 Universal. Public domain, commercial use allowed, credit not required.
- License note: `assets/0x72/LICENSE.txt`
- Used for the survivor hero (wizard, recolored), imps, skeletons, ogre brutes, the big demon boss, necromancer hermit, dungeon floor tiles, and a few skulls.

The pack has idle and run clips (four frames) and no attack or death clips, no spell effects, and no XP gems. Its coins are gold, so they are not used as gems.

## Effects drawn for this game

XP gems, ash bolts, the ember trail, hit sparks, and death puffs are original 16px pixels drawn in code for Abyss Descent. They are not from another pack.

Kenney's packs (https://kenney.nl/assets, CC0) were checked as filler. The particle packs are not 16px tiles, and dropping a second tileset in beside 0x72 would fight the grid. The effects stay on the same pixel scale as the dungeon sheet, in the colours the phone crowd needs: cyan gems, lime bolts, white sparks.

Vow badge: original art by the team.

## Medieval demo audio (`assets/audio/medieval/`)

All clips are mono, re-encoded to `.ogg` (Vorbis) and `.m4a` (AAC) by `scripts/build-audio.sh`, which also trims, levels and (for a few) layers or re-pitches them. Licence texts: `assets/audio/medieval/LICENSE.txt`. Checked 9 Oct 2026.

| File | Source clip(s) | Pack | Author | Licence |
|---|---|---|---|---|
| hit1, hit2 | impactPunch_medium_000, _002 | Impact Sounds https://kenney.nl/assets/impact-sounds | Kenney | CC0 1.0 |
| sword1, sword2 | impactMetal_light_000, _002 | Impact Sounds | Kenney | CC0 1.0 |
| death1, death2 | impactWood_light_000, _003 | Impact Sounds | Kenney | CC0 1.0 |
| gem | impactGlass_light_001 (pitch rises per pickup in code) | Impact Sounds | Kenney | CC0 1.0 |
| hurt | impactPunch_heavy_000 | Impact Sounds | Kenney | CC0 1.0 |
| boss | impactBell_heavy_000 (octave down, echo) + impactMetal_heavy_000 | Impact Sounds | Kenney | CC0 1.0 |
| chest | metalLatch + handleCoins | RPG Audio https://kenney.nl/assets/rpg-audio | Kenney | CC0 1.0 |
| swing, cast, talk | knifeSlice, drawKnife2, bookFlip1 | RPG Audio | Kenney | CC0 1.0 |
| ui | click_002 | Interface Sounds https://kenney.nl/assets/interface-sounds | Kenney | CC0 1.0 |
| warn | bong_001 (pitched down) | Interface Sounds | Kenney | CC0 1.0 |
| level | jingles_PIZZI16 | Music Jingles https://kenney.nl/assets/music-jingles | Kenney | CC0 1.0 |
| victory | jingles_PIZZI02 + impactBell_heavy_001 | Music Jingles + Impact Sounds | Kenney | CC0 1.0 |
| defeat | jingles_PIZZI01 (pitched down) | Music Jingles | Kenney | CC0 1.0 |
| music | the_march_of_devils_dome_loop.wav ("Epic March Loop"), 0.5 s tail-to-head crossfade for a seamless loop | https://opengameart.org/content/epic-march-loop | Eldritch Grim | CC0 1.0 (page: "Attribution is appreciated but not required") |

Music: "Epic March Loop" by Eldritch Grim, from the full track "The March of Devils Dome" (https://opengameart.org/content/the-march-of-devils-dome). Credited here with thanks; CC0 does not require it.
