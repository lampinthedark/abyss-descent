# Week-1 item icons (for the UI specialist)

Machine-readable list: [`docs/rpg-item-icons.json`](rpg-item-icons.json). It is generated from the item DB by
`node dev/rpg/gen-icons.js`, and `npm run test:items` fails if it goes stale or if an item has no icon.

- **Size:** 32x32 art px on the 16 px module (2x2 modules), like the town sheet (`module_px: 16`). It is drawn 3x on DPR-3 phones. The same frame works in the backpack slot, the bank, the shop and on a ground drop (draw it at half size on the ground if it reads too big).
- **37 distinct drawings** cover all 101 item bases: 18 tinted shapes plus 19 unique icons (gold coins are one of the uniques). **15 are top priority, for D3-D5** (bold below).
- **Tinted** means you draw one light greyscale shape and the game multiplies it by the item's `tint`. Tier tints: Rustbound `#9b6a48`, Cinderiron `#7a5a5a`, Verdite `#4f9a6a`, Tidesteel `#4a86a8`, Sunforged `#d8a83a`, Wyrmscale `#b8323a`. Every weapon and armour piece in every tier, the 5 ores and the 5 bars come from these shapes. Wyrmscale only has armour, because the only dragon-tier weapon is the unique **Wyrmfang**.
- **Rarity is not baked into the icon.** The UI draws the rarity border or glow, and FX draws the beam (Normal `#e8e2d0` no beam, Rare `#5aa0ff`, Very Rare `#c070ff`, Legendary `#ff9a2e`). That way one sword drawing serves all 4 rarities.
- Ore, log and fish ids match the town sheet nodes: `node_ore_<tier>`, `node_tree_pine` / `node_tree_ash` and `node_fish_0`.
- Sheet keys: `icon_<itemId>` per item (for example `icon_cinderiron_sword`). Until an item has its own frame, it renders from its shape key plus its tint.

| Prio | Key | Icon | Type | Used for |
|---|---|---|---|---|
| **D3** | `icon_shape_sword` | Sword | tinted ×5 | cinderiron, rustbound, sunforged, tidesteel, verdite |
| **D3** | `icon_hearth_bread` | Hearth Bread | unique |  |
| **D3** | `icon_gold` | Gold coins | unique | Gold is a balance, not an item; icon for HUD, ground piles and shop prices. One coin-pile drawing. |
| **D4** | `icon_shape_pickaxe` | Pickaxe | tinted ×5 | cinderiron, rustbound, sunforged, tidesteel, verdite |
| **D4** | `icon_shape_hatchet` | Hatchet | tinted ×5 | cinderiron, rustbound, sunforged, tidesteel, verdite |
| **D4** | `icon_shape_ore` | Ore chunk | tinted ×5 | cinderiron, rustbound, sunforged, tidesteel, verdite |
| **D4** | `icon_shape_logs` | Logs | tinted ×2 | Ashwood Logs, Pine Logs |
| **D4** | `icon_shape_fish_raw` | Raw fish | tinted ×2 | Raw Brookfin, Raw Mudminnow |
| **D4** | `icon_fishing_rod` | Fishing Rod | unique |  |
| **D5** | `icon_shape_bar` | Bar | tinted ×5 | cinderiron, rustbound, sunforged, tidesteel, verdite |
| **D5** | `icon_shape_fish_cooked` | Cooked fish | tinted ×2 | Brookfin, Mudminnow |
| **D5** | `icon_shape_helm` | Helm | tinted ×6 | cinderiron, rustbound, sunforged, tidesteel, verdite, wyrm |
| **D5** | `icon_smithing_hammer` | Smithing Hammer | unique |  |
| **D5** | `icon_flint_striker` | Flint Striker | unique |  |
| **D5** | `icon_charred_fish` | Charred Fish | unique | Shared burnt result for every fish. |
| D6 | `icon_shape_shield` | Shield | tinted ×6 | cinderiron, rustbound, sunforged, tidesteel, verdite, wyrm |
| D6 | `icon_shape_cuirass` | Cuirass | tinted ×6 | cinderiron, rustbound, sunforged, tidesteel, verdite, wyrm |
| D6 | `icon_shape_greaves` | Greaves | tinted ×6 | cinderiron, rustbound, sunforged, tidesteel, verdite, wyrm |
| D6 | `icon_shape_gauntlets` | Gauntlets | tinted ×6 | cinderiron, rustbound, sunforged, tidesteel, verdite, wyrm |
| D6 | `icon_shape_sabatons` | Sabatons | tinted ×6 | cinderiron, rustbound, sunforged, tidesteel, verdite, wyrm |
| D6 | `icon_shape_dirk` | Dirk | tinted ×5 | cinderiron, rustbound, sunforged, tidesteel, verdite |
| D6 | `icon_shape_greataxe` | Greataxe | tinted ×5 | cinderiron, rustbound, sunforged, tidesteel, verdite |
| D6 | `icon_shape_ring` | Ring | tinted ×3 | rustbound, sunforged, verdite |
| D6 | `icon_shape_amulet` | Amulet | tinted ×3 | rustbound, sunforged, verdite |
| D6 | `icon_rat_tail` | Rat Tail | unique |  |
| D6 | `icon_goblin_trinket` | Goblin Trinket | unique |  |
| D6 | `icon_bone_shard` | Bone Shard | unique |  |
| D6 | `icon_imp_ember` | Imp Ember | unique |  |
| D6 | `icon_wyrm_scale` | Wyrm Scale | unique |  |
| D6 | `icon_travellers_stew` | Traveller's Stew | unique |  |
| D6 | `icon_wyrmfang` | Wyrmfang | unique | Dragon-tier legendary sword (Gate 4/6 show-off). Most detailed icon in the set; red-black blade, fang-shaped. |
| D6 | `icon_gravewarden_crown` | Gravewarden's Crown | unique | Legendary helm (boss chase). |
| D6 | `icon_emberheart_pendant` | Emberheart Pendant | unique | Legendary amulet. |
| D6 | `icon_tinkers_oath` | Tinker's Oath | unique | Legendary ring. |
| D6 | `icon_cracked_sigil` | Cracked Sigil | unique | Quest item; names follow GD quests, may change. |
| D6 | `icon_wardens_ledger` | Warden's Ledger | unique | Quest item; may change. |
| D6 | `icon_old_survey_map` | Old Survey Map | unique | Quest item; may change. |

The order within D3-D5 follows the plan's gates. D3 needs the starter sword, bread and gold. D4 needs gathering (ore, logs, raw fish, pickaxe, hatchet, rod). D5 needs smelting, smithing and cooking (bar, hammer, cooked and charred fish, helm). Everything else shows up with dungeon loot on D6. Wyrmfang is the D6 priority because it is the show-off chase item.
