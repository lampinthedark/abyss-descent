# Items integration for core (Game Developer)

This is the items side of GD's week-1 plan (`Core-to-items interface`). Core calls the APIs below. Core owns no item or save shapes and **never mints item ids**. Everything lives in `js/rpg/items/` under one global, `RPGItems`. Nothing in `index.html`, `js/game.js`, `js/map.js`, `js/skills.js`, `js/quests.js` or combat code was edited. The pastes below are for GD to place.

## 1. Load (paste into the RPG page, after GD's `js/rpg/` core scripts)

```html
<script src="js/rpg/items/core.js"></script>
<script src="js/rpg/items/item-ids.js"></script>
<script src="js/rpg/items/items-db.js"></script>
<script src="js/rpg/items/item-gen.js"></script>
<script src="js/rpg/items/loot.js"></script>
<script src="js/rpg/items/state.js"></script>
<script src="js/rpg/items/gold.js"></script>
<script src="js/rpg/items/inventory.js"></script>
<script src="js/rpg/items/ground.js"></script>
<script src="js/rpg/items/equipment.js"></script>
<script src="js/rpg/items/bank.js"></script>
<script src="js/rpg/items/shop.js"></script>
<script src="js/rpg/items/crafting.js"></script>
<script src="js/rpg/items/item-save.js"></script>
<script src="js/rpg/items/world.js"></script>
```

## 2. Boot (once, at game start)

```js
const Items = RPGItems.createWorld({
  playerId: 'local',                               // account id once the server exists
  getLevels: () => Stats.levels(),                 // { attack, strength, defence, hitpoints, mining, smithing, woodcutting, fishing, cooking }
});
const loaded = Items.ItemSave.load();              // { ok } or { ok:false, reason:'no_save' | 'corrupt' | 'future_schema' }
if (!loaded.ok && loaded.reason === 'no_save') {
  Items.Inventory.grant({ src: 'starter', items: [
    { base: 'rustbound_sword' }, { base: 'rustbound_pickaxe' }, { base: 'rustbound_hatchet' },
    { base: 'fishing_rod' }, { base: 'smithing_hammer' }, { base: 'hearth_bread', qty: 3 } ] });
}
Items.ItemSave.installLifecycle();                 // flush on hidden / pagehide / beforeunload / Capacitor pause
RPGItems.installGlobals(Items);                    // window.Loot, Inventory, Equipment, Bank, Shop, Crafting, ItemSave, ItemIds, Gold, Ground
```

`installGlobals` will **not** overwrite the old `js/loot.js` `Loot` (it detects `dropFromEnemy`). Retire `js/loot.js` from the RPG page as the plan says, or call `Items.Loot.rollDrop` directly. Every call returns `{ ok:true, ... }` or `{ ok:false, reason }`. None of them throw on player error. A failed call changes nothing.

## 3. The API core calls

| Call | When | Returns |
|---|---|---|
| `Loot.rollDrop(monsterId, rng?, x, y, opts?)` | On kill (rat/goblin packs, skeleton, imp, elite `brute`, boss `ashmaw`). Optional `opts = { questFinish: true\|false }`, default false; 4-arg calls are unchanged. See "Q2 safety" below | `{ ok, drops:[{ gid, kind:'item'|'gold', name, rarity, color, beam, qty, amount, x, y }], best, firstRareUsed, questFinishUsed, pityUsed }` |
| `Loot.preview(monsterId)` | Boss nameplate and the questgiver's rumour line: "Can drop: Wyrmfang" | `[{ name, base, rarity, color, beamColor, icon, label:'legendary'|'very rare'|'rare find'|'guaranteed', source:'monster'|'shared' }]`. Render in array order and use `color` for the text (every entry has it: rarity colour, materials in the panel gold `#e8c84a`); `beamColor` is the ground beam. Order: chase legendaries, chase gear, chase materials, guaranteed, Very Rare table, then shared. For `ashmaw` the first four are locked by a test: Wyrmfang `#ff9a2e`, Gravewarden's Crown `#ff9a2e` (it is Legendary in the data), Wyrmscale armour `#c070ff`, Wyrm Scale `#e8c84a`. No exact odds. |
| `Ground.pickup(gid, { goldMult })` | Walk-over auto-pickup | `{ ok, kind, slot, uid, amount }` or `{ ok:false, reason:'inventory_full' }`. The item stays on the ground. |
| `Ground.tick()` | Every few seconds | Removes drops older than 3 min |
| `Equipment.getStats()` | Combat maths (hit chance, damage) | `{ aim, power, armour, maxHp, attackSpeed, crit, lifesteal, cooldown, gather, specials:[{id, skill, text}], weapon, tools, legacy }` |
| `Crafting.make(recipeId, { station })` | Furnace / anvil / fire / range | `{ ok, burnt, made:[uid], skill, xp, effect }`. **Core grants `xp` to `skill`.** |
| `Crafting.gather(nodeType)` | Each successful swing on `node_ore_<tier>`, `node_tree_pine` / `node_tree_ash` or `node_fish_0` | `{ ok, base, qty, skill, xp }` |
| `Crafting.canMake(recipeId)` / `Crafting.list(station)` | Station menus | `{ ok, reason, missing, burnChance }` |
| `Inventory.add(baseId, qty, { src:'quest', overflow:'ground', x, y })` | Quest rewards, starter kit | `{ ok, placed, grounded }` |
| `Inventory.grant({ src:'quest', ref, gold, items:[{base, qty}], overflow })` | Quest turn-in bundle (gold and items in one atomic op) | same, plus `gold` |
| `Inventory.remove(baseIdOrUid, qty, 'quest_turnin' \| 'consume' \| 'destroy')` | Quest hand-ins | `{ ok, removed }` |
| `Inventory.has(baseId, qty)` / `Inventory.count(baseId)` | Quest checks, tracker | boolean / number |
| `Inventory.use(slot)` | Eat | `{ ok, heal }`. **Core heals.** |
| `Bank.open()` / `Shop.open(shopId)` | NPC `act` | View object. Also emits `bank:open` / `shop:open` for the UI. |
| `ItemSave.load()` / `ItemSave.save()` / `ItemSave.flush()` | Boot / manual / core's own save points | `{ ok, ... }` |
| `ItemIds.next()` | **Only** if core ever needs an item-style id | `"item_<clientId>_<n>"` (provisional, untrusted) |

**Q2 safety (`Loot.rollDrop` 5th argument):** `opts = { questFinish: true|false }`, optional, default `false`. drops.js sets `questFinish: true` on the kill that completes Q2's objective (Skills & Quests' `RPG.quests.completesOnKill(id, ev)`); RPGItems does not look at quest state. When `questFinish` is true and this save's first Rare is not done, that kill's slot roll becomes exactly one beamed Rare and `firstRare` is marked done:
- the roll already produced a Rare+: nothing changes, `firstRare` is marked done;
- the slot rolled common/uncommon gear: that item is upgraded to Rare in place (same base and seed);
- the slot rolled nothing, gold only or a non-gear item: one near-town Rustbound Rare takes the slot.

One drop and one beam from that roll; nothing extra spawns (independent rolls such as the shared rare table's bonus stay as rolled). No-op once `firstRare` is done. It never stacks with the near-town kill-10 guarantee, and the guarantee does not fire after. The result has `questFinishUsed: true` when the upgrade happened.

```js
const r = Loot.rollDrop(mob.lootId, null, mob.x, mob.y, { questFinish: RPG.quests.completesOnKill('q2_field', ev) });
```

Shop ids: `general_store`, `smithy`, `tackle`. Recipe ids: `smelt_<tier>`, `smith_<baseId>` (e.g. `smith_rustbound_sword`), `cook_mudminnow`, `cook_brookfin`, `fire_pine_logs`, `fire_ashwood_logs` (lighting a fire returns `effect:'fire'` and core places it). Monster ids are table keys in `RPGItems.Loot.MONSTERS`. Rename them freely, or tell me the ids core uses.

### Kill and pickup (replaces `game.js` 584-601 and 805)

```js
// on kill
const r = Loot.rollDrop(mob.lootId, null, mob.x, mob.y);
for (const d of r.drops) {
  spawnDropSprite(d);                               // core renders by d.gid at d.x/d.y
  if (d.beam) FX.beam(d.x * 2, d.y * 1.125, d.color, d.beam);   // Rare and up
}
// on walk-over
const p = Ground.pickup(drop.gid, { goldMult: stats.goldMult || 1 });
if (p.ok) { removeDropSprite(drop.gid); FX.pickup(...); /* or lootPull */ }
else if (p.reason === 'inventory_full') UI.log('Your backpack is full.', 'warn');
```

### "Can drop" copy

```js
const notable = Loot.preview('ashmaw').filter((e) => e.source === 'monster');
// [{ name:'Wyrmfang', rarity:'legendary', label:'legendary', beamColor:'#ff9a2e', icon:'icon_wyrmfang' }, ...]
nameplate.sub = 'Can drop: ' + notable.filter((e) => e.label !== 'guaranteed').map((e) => e.name).join(', ');
rumour = `They say ${monsterName} guards ${notable[0].name}.`;   // icon from the sheet by e.icon, text tinted e.beamColor
```

The labels are flavour on purpose. Exact rates live only in `docs/rpg-items.md` and the sim.

### Combat (replaces the gear part of `Entities.playerStats`)

```js
const g = Equipment.getStats();
const accuracy = attackLevel + g.aim;      const maxHit = f(strengthLevel, g.power);
const defence  = defenceLevel + g.armour;  const maxHp  = hitpointsLevel + g.maxHp;
const swingMs  = baseSwingMs / (1 + g.attackSpeed / 100);
const critChance = g.crit / 100;           const lifesteal = g.lifesteal / 100;
const skillCd  = baseCd * (1 - Math.min(0.5, g.cooldown / 100));  // Cleave, Ground Slam, Sigil Bolt
// g.specials: 'wyrmflame' (skill:'cleave'), 'warden_ward' (skill:'ground_slam'), 'ember_pulse' (skill:'sigil_bolt'),
// 'lucky_strike' (handled items-side in gather). Core implements the three combat specials, or ignores them for week 1.
// g.gather: % faster gather swings. g.tools: { pickaxe:2, hatchet:1, rod:1 } best tier carried.
```

## 4. Events (`Items.on(event, fn)`; listener errors are caught)

`op` (every committed change: `{key, type, p, at, rev}`), `change`, `inventory`, `equipment`, `bank`, `gold` `{balance, delta, src}`, `ground` `{added, removed}`, `beam` (drop view with colour and beam), `pickup`, `inventory_full`, `craft` `{recipe, burnt, skill, xp}`, `gather` `{skill, xp}`, `consume` `{heal}`, `first_rare`, `bank:open`, `bank:close`, `shop:open`, `shop:close`, `saved`, `loaded`, `save_error`, `save_warning`, `rejected` `{type, reason}`.

## 5. Save contract (matches core's triggers)

- Items save **their part only**: backpack, equipment, bank, gold and ledger, ground drops, shop stock, pity counters and the op outbox. Core saves position, XP and quests.
- Keys `abyss-rpg-items:a`, `:b` and `:ptr`. The write goes to the inactive slot, is read back, and then the pointer flips. A torn or edited slot fails its checksum, and the load falls back to the other slot. The old `abyss-descent-save-v1` is never read.
- Triggers: a save within 1 s of any change (a 750 ms debounce that later changes do not push back), plus an immediate `flush()` on `visibilitychange`→hidden, `pagehide`, `beforeunload`, Capacitor `pause` and `appStateChange {isActive:false}`. Core can also call `ItemSave.flush()` in its own handlers. Calling it with nothing pending is a no-op.
- Store: every item change is already an op `{ key:"<deviceId>:<seq>", type, p, at, rev }` (`Items.on('op', ...)`). To mirror into core's log, use `Items.on('op', op => Store.log?.({ type: 'items/' + op.type, op }))`. Do **not** route item changes through `Store.dispatch` reducers as well (double apply).
- Ids: `ItemIds.next()` is the one item-id function, in the format `item_<clientId>_<counter>`. The counter is saved and never reused. Core's `Ids.mint` must not be used for items.

## 6. Rewarded ads (proposal for D5; no forced ads; `abyss_supporter` skips the ad)

1. **Revive at your corpse (dungeon only).** On death the recap offers "Revive here (watch ad)" or "Return to town". Supporters see "Revive here" with no ad.
   - Items: death in week 1 costs **no items and no gold**. The backpack, equipment and bank are untouched. Revive restores HP at the corpse spot and keeps uncollected ground drops (they keep their 3-min timer from the drop). "Return to town" also keeps everything, but drops left in the dungeon expire normally.
   - The ad reward is position and time only. It never calls an items API that mints gold or items.
   - Cap: 1 revive per dungeon run, so a boss can't be ad-revived through repeatedly.
2. **Skip the walk back (optional).** After banking in town: "Return to the dungeon entrance (watch ad)". Again no item or gold effect.
- Explicitly **not** proposed: ad-for-gold, ad-for-loot rerolls, ad-doubling drops. These would be gold faucets outside the ledger. The ledger has no `ad` source, by design.

## 7. UI notes (for the UI specialist; no art here)

Icon list: `docs/rpg-item-icons.md` / `.json` (37 drawings, 15 top priority for D3-D5).

- **Backpack:** a 4x7 grid of 28 slots from `Inventory.list()` (null = empty). Stack count goes top-left when qty > 1, and the border uses `color` (rarity). Tap opens the tooltip. Long-press offers Equip, Eat, Drop, Deposit (bank open) or Sell (shop open). Show "Backpack full" on the `inventory_full` event.
- **Equipment:** 9 slots (weapon, offhand, head, body, legs, hands, feet, ring, amulet) from `Equipment.list()`. Grey an item out and show the unmet level from `Equipment.canEquip(uid).unmet`.
- **Tooltip:** `get(slot)` / `Bank.get(uid)` / `Ground.describe(gid)` return `{ name, rarityName, color, lines:[{kind, text}] }`. Draw lines in order and style by `kind`: `type` (dim), `base` (white), `signature` (orange), `special` (orange italic), `affix` (rarity colour), `req` (red when unmet), `bound` (dim red), `flavor` (italic dim). The name uses the rarity colour.
- **Bank:** `Bank.view(tab)` gives `{cap, used, tabs, items}`. Use a search box (`Bank.search(text)` matches names, rarity and affix text), tabs 0-8 (`Bank.setTab`), Deposit-all (`Bank.depositAll()`) and withdraw with a quantity (`Bank.withdraw(uid, qty)`).
- **Shop:** `Shop.open(id)` gives `{name, items:[{base, name, qty, buy}]}`. The sell side shows `Shop.sellQuote(shopId, uid, qty)`, where null means "won't buy". Hide Sell when `Shop.isSellable(uid)` is false: Legendary and chase items (Wyrmfang and the other legendaries) are refused with `{ ok:false, reason:'not_sellable' }` and nothing changes. Show "This can't be sold. Bank it." if the call is made anyway. Other Rare and bound items sold to a shop are destroyed, so ask the player to confirm first. There is no sell-all.
- **Rarity beams:** `ItemsDb.RARITIES[r].beam` is `{color, height, pulse, sfx}`. Normal has none. Rare is `#5aa0ff` (2.5), Very Rare is `#c070ff` (3.5, pulse), Legendary is `#ff9a2e` (5, pulse, `lootLegendary`).
