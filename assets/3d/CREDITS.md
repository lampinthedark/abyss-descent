# Horde field credits

## Placeholder figures

The people, goblins, rats, skeletons, spiders, armour, and loot icons in this page are original stand-ins drawn in code for the test. They are not from a tileset. Each body is 64 source pixels tall, anchored at the feet, with eight directions and walk, attack, hit, and death frames.

The frame map is `assets/3d/atlas/placeholders.json`. A private atlas can replace them later without renderer changes: set `mapUrl` (and optionally `imageUrl`) in `js/spike3d/atlas-config.js`. The remote JSON can include an `image` URL and an explicit `frames` table using the same ids (`sheet/anim/dir/frame`).

Tier metals on the hero are Rustbound, Cinderiron, Verdite, Tidesteel, and Sunforged. Those names are placeholders. Armour is tinted only by that tier. Rarity colours are used on ground loot, not on armour.

Measured with CIEDE2000 against the flat placeholder colours:

- Rustbound `#8c3a26` against the sand path `#f2e4c0` is about 52 (needs 15).
- Tidesteel `#6e8caa` against bone `#e6dcc8` is about 33, and against `#d0b4ff` is about 22 (needs 15). In grayscale it is a step brighter than Verdite `#146b42` (relative luminance about 0.25 versus 0.11). The Tidesteel cape is wider than the Sunforged cape and longer than the old short cape.
- Goblin skin `#123e48` against grass `#4a542c` is about 25 (the contrast ratio is about 1.4, so the hue gap is the one that clears the bar).

## Font

Silkscreen by The Silkscreen Project Authors, SIL Open Font License 1.1. The license is `assets/3d/fonts/OFL.txt`. The file shipped here is the latin regular weight.

## three.js

three.js r186 (npm 0.186.1), MIT License. Vendored as ES modules in `js/spike3d/vendor/three.module.js` and `js/spike3d/vendor/three.core.js`. The license is `js/spike3d/vendor/LICENSE`. The page does not load three.js from a network.
