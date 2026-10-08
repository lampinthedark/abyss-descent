# Skills & Quests handoff (for the Game Developer)

Five files in `js/rpg/`, no core edits. Tests: `npm run test:sq` (fake core per `docs/rpg-core-hooks.md` plus a real RPGItems world and Senior's RPGContent, Q1 and Q2 played cold).

## Paste into rpg.html, after core + RPGItems + RPGContent, before main.js
```html
<script src="js/rpg/skills-xp.js"></script>
<script src="js/rpg/skills-gather.js"></script>
<script src="js/rpg/skills-craft.js"></script>
<script src="js/rpg/quests-runtime.js"></script>
<script src="js/rpg/quests-ui.js"></script>
```
Each file installs itself on `window.RPG` at load. `RPG.skills` and `RPG.quests` exist after these load, which switches off core's placeholders.

## What I need from core (all already in HOOKS unless marked)
- `RPGItems.createWorld({ getLevels: RPG.skills.levels, ... })` so Crafting sees real levels. `RPG.skills.levels` works called or uncalled (it carries live per-skill getters).
- Item globals: I read `RPG.items` if set, else `window.Crafting / Inventory / Equipment / Loot`. Content: `RPG.content` if set, else `window.RPGContent`.
- `RPG.world.zone.markers` = `ore[{x,y,tier}]`, `tree[{x,y,kind}]`, `fish[{x,y}]`, `furnace`, `anvil`, `range`, `fire` (object or array). I spawn on `enter {zone:'town'}`, and also at load if the zone is already town.
- `talk {npcId}`: `npc_questgiver` is fine; I strip `npc_` to match content ids. I only handle quest givers. Bank and shops stay yours.
- `equip {slot, itemId}`: I look up the base via `Equipment.list()[slot].base`; passing `base` in the event is welcome.
- `Store.get('quests')` is read first (GD confirmed for D1); the mirror is only a fallback.
- Markers use `RPG.camera.toScreen(x, y)` (GD confirmed for D1).
- Rumour screen: I call `RPG.ui.dialog(npcId, lines, choices, { showDrops:'ashmaw', title:'Can drop', drops: Loot.preview('ashmaw') })`, built from `Loot.preview('ashmaw')` at runtime (same order and colours as the boss panel). Core draws them with `RPG.ui.drawDropRows`.
- `RPG.ui.dialog(npcId, lines, choices)` should resolve to the chosen `id` (or the choice object). `null` for a closed dialog means decline.

## What I emit / call
- Bus out: `gather {skill, nodeKey, itemId, qty, x, y}`, `craft {recipeId, itemId, burnt, station}`, `skilling {skill, on}` (hero swing anim), `levelUp {skill, level}`, `questAccept`, `questStep`, `questDone`.
- XP: `RPG.stats.addXp` only from my files (gather, craft, quest rewards).
- FX: `RPG.fx('pickup' | 'levelUp', x, y)`, guarded.
- UI: `toast`, `float` (+XP), `dialog`, `tracker(text, {x,y} | null)`.
- Entities: `kind:'node'` (`sprite` swaps `_full`/`_empty`/`_stump`) and `kind:'station'`; core draws them by sprite key on the sorted layer.

## What to tap
1. Tap Warden Ilse (`!`), Accept: tracker reads "Mine Rustbound ore" with the arrow on the east rocks.
2. Tap a Rustbound rock: swings about once a second, ore on success, rock empties and comes back in 4 s.
3. Tap the furnace: smelts both bars. Tap the anvil: smiths the sword (quest recipe picked, no menu).
4. Wield the sword, tap Ilse (`?`): 25 gold, 3 Hearth Bread, Mining and Smithing XP, then `!` for Q2.
5. Q2: fish at the pond, cook at the range (burnt counts), walk into the Goblin Field, kill 4 goblins, hand in, rumour shows the "Can drop" list, Wyrmfang first in `#ff9a2e`.
