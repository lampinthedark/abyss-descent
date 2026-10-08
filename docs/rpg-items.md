# Abyss Descent RPG: items design (week-1 slice)

Owner: Senior Game Dev (items). Code: `js/rpg/items/`. Tests: `npm run test:items`. Sim: `node dev/rpg/loot-sim.js`. Integration for core: [rpg-items-integration.md](rpg-items-integration.md). Icons: [rpg-item-icons.md](rpg-item-icons.md).

## Model

- **Bases** (`items-db.js`, about 100) are static definitions: weapons (Sword, Dirk, Greataxe two-handed), armour (Shield, Helm, Cuirass, Greaves, Gauntlets, Sabatons), jewellery (rings, amulets), tools (tiered Pickaxe and Hatchet, plus Smithing Hammer, Fishing Rod, Flint Striker), ores, bars, logs, raw and cooked fish, food, monster junk and quest items.
- **Instances** store only identity and roll inputs: `{ uid, sid, untrusted, base, tier, rarity, seed, qty, bound, boundTo, owner, origin }`. Stats and affixes are **never stored**. They are recomputed from `(base, tier, rarity, seed)` with `mulberry32` and FNV-1a (`core.js`), so a save edit can't forge stats and the server can re-verify exactly (`ItemGen.verifyStats`).
- **Ids:** `ItemIds.next()` → `item_<clientId>_<counter>` is provisional, with `untrusted:true` and `sid:null`. When the server confirms an item, `ItemIds.adopt(uid, sid)` records the server bigint id. Ids are never reused, and a merged stack's id is retired.
- **Gold** is an integer balance, **not an item**. It changes only inside ops through `credit`/`debit` with a source tag. Credits: `drop`, `quest`, `shop_sell`, `migration` (reserved). Debits: `shop_buy`. A ledger records `{op, at, delta, src, ref, bal}`, plus lifetime totals per tag. There is no purchase, IAP or ad source, so real money can never mint gold.
- **Ops:** every saved change is `commit(type, payload)`. It applies to a cloned draft, swaps on success, gets logged as `{key:"<deviceId>:<seq>", type, p, at, rev}` and emits events. A reducer error rolls back everything, so crafting, buying, equipping and withdrawing are atomic. Payloads carry seeds, level snapshots and time, so `replay(ops)` rebuilds identical state. Already-applied keys are skipped, which makes delivery idempotent. The reducers are written to run unchanged on a server.
- **Conservation:** per base, `minted - burned == held` across backpack, equipment, bank and ground. Item sources: `drop`, `quest`, `shop_buy`, `craft`, `gather`, `starter`. Item sinks: `shop_sell`, `craft`, `consume`, `destroy`, `despawn`, `quest_turnin`.

## Tiers (GD's plan names; the dragon tier is ours)

| Tier | Level | Sword aim/power | Cuirass armour | Tint | Source |
|---|---|---|---|---|---|
| Rustbound | 1 | 4/4 | 5 | `#9b6a48` | smith |
| Cinderiron | 5 | 6/6 | 8 | `#7a5a5a` | smith |
| Verdite | 10 | 9/9 | 12 | `#4f9a6a` | smith |
| Tidesteel | 20 | 13/13 | 16 | `#4a86a8` | smith |
| Sunforged | 30 | 18/18 | 22 | `#d8a83a` | smith |
| Wyrmscale (dragon) | 40 | **Wyrmfang** 26/30 | 30 | `#b8323a` | drop only |

- Requirements use GD's skills: weapons need Attack, armour needs Defence, pickaxes need Mining, hatchets need Woodcutting. Rings need Attack and amulets need Defence.
- Ores and bars: `<tier>_ore` → `<tier>_bar` at the furnace, using 1/1/2/2/3 ore. There is no separate fuel ore in week 1. Ore ids match the town sheet nodes `node_ore_<tier>`.
- Logs: Pine and Ashwood (`node_tree_pine` / `node_tree_ash`). Fish: Mudminnow and Brookfin from `node_fish_0`, plus Charred Fish when cooking burns.

## Rarities and affixes

| Rarity | Affixes | Value | Beam |
|---|---|---|---|
| Normal | 0 | x1 | none |
| Rare | 1-2 | x3 | `#5aa0ff` |
| Very Rare | 3-4 | x8 | `#c070ff`, pulsing |
| Legendary | fixed signature + 1-2 | x20 | `#ff9a2e`, pulsing, always bound |
| Material / Quest | none | x1 / 0 | quest items get a gold beam |

- Names: a Rare is "<prefix> <base>" (Keen Cinderiron Sword). A Very Rare adds a suffix (Hale Tidesteel Cuirass of Warding). A Legendary keeps its fixed name.
- Affix ranges scale with tier index t as `min = a + b·t`, `max = c + d·t`. All values are integers.

| Affix | Rolls on | Rustbound | Verdite | Sunforged | Wyrmscale |
|---|---|---|---|---|---|
| +Attack | weapon, hands, ring, amulet, tool | 1-3 | 5-9 | 9-15 | 11-18 |
| +Strength | weapon, hands, ring, amulet, tool | 1-3 | 5-9 | 9-15 | 11-18 |
| +Defence | armour, ring, amulet | 1-3 | 5-9 | 9-15 | 11-18 |
| +Max HP | armour, ring, amulet | 3-8 | 13-26 | 23-44 | 28-53 |
| +% Attack Speed | weapon, hands, ring | 2-4 | 4-7 | 6-10 | 7-12 |
| +% Critical Chance | weapon, offhand, head, legs, hands, ring, amulet, tool | 1-3 | 2-5 | 3-7 | 4-8 |
| +% Life Steal | weapon, body, ring, amulet | 1-2 | 2-4 | 3-5 | 3-6 |
| -% Skill Cooldown (Cleave, Ground Slam, Sigil Bolt) | head, offhand, body, legs, feet, ring, amulet | 2-4 | 4-7 | 6-10 | 7-12 |
| +% Gathering Speed | tool, hands, feet, ring, amulet | 3-6 | 7-12 | 11-18 | 13-21 |

### Legendaries

| Item | Slot | Signature | Special | Source |
|---|---|---|---|---|
| **Wyrmfang** (dragon-tier sword) | weapon, Attack 40 | +6% life steal, +8% crit | Cleave sears for 30% weapon damage over 3 s | Ashmaw 1/150 |
| Gravewarden's Crown | head, Defence 10 | +30 HP, -15% cooldown | Ground Slam grants a 3 s ward | Ashmaw 1/40 |
| Emberheart Pendant | amulet, Defence 5 | +6 Strength, +3% life steal | Sigil Bolt bursts into embers | shared rare table |
| Tinker's Oath | ring, Attack 5 | +25% gathering | 10% double yield (items-side) | shared rare table |

### Why Wyrmfang stays at Attack 40 (1/150 from Ashmaw)

Kept on purpose. Wyrmfang is the long-term chase: a week-1 player can see it drop (a pulsing orange beam, show-off value) but can't wield it until Attack 40. That gives a reason to keep training after week 1. At 1/150 per boss kill, the median player needs about 102 kills (about 34 h of 20-min runs), so it stays rare in the shared town and on the market. It's bound, so it can't be bought. And because shops refuse it, a player who can't wield it yet can't sell it by accident; they bank it.

## Bound rules

- `bound` is set at creation for legendaries, chase items and quest items. `boundTo` is set to the first owner on pickup. **Neither is ever unset**: no op clears them, and the server trigger from the online design enforces this.
- Bound items can be equipped, banked and dropped (they stay bound to the owner). They can never be traded or listed on the market.
- **Legendary and chase items can't be sold to any shop.** `Shop.sell` refuses with `not_sellable` and changes nothing; `sellQuote` returns null and `Shop.isSellable(uid)` returns false, so the UI hides Sell. A chase item is any base with `chase: true` (every legendary today). There is no bulk sell-all; if one is added, it must skip these (a test guards it).
- Other bound items (quest items aside) and Rare+ items can be sold; they are destroyed, never restocked.
- Very Rare and below are tradeable. Quest items can't be traded, sold or dropped, only destroyed.

## Drop tables (`loot.js`)

Each kill makes one slot roll (common, uncommon, rare, very rare, or nothing), plus `always` entries, gold, an optional shared rare table roll and the boss's independent `chase` rolls. Normal gear from common or uncommon can be promoted to Rare (`upgrade`). Any Rare has an 8% chance to become Very Rare.

| Id | Name | Zone | Slots c / u / r / vr | Shared rare | Measured Rare+ / Very Rare+ per kill |
|---|---|---|---|---|---|
| rat | Plague Rat | near town | 45% / 12% / 1.4% / 0.12% | 1/256 | 1.8% / 0.27% |
| goblin | Ditch Goblin | near town | 45% / 15% / 1.8% / 0.15% | 1/200 | 2.4% / 0.36% |
| skeleton | Rattlebone Skeleton | dungeon | 40% / 18% / 2.8% / 0.30% | 1/128 | 4.0% / 0.71% |
| imp | Cinder Imp | dungeon | 42% / 16% / 3.0% / 0.35% | 1/100 | 4.4% / 0.78% |
| brute | Grave Brute (elite) | dungeon | 50% / 30% / 12% / 1.5% | 1/32 | 16% / 3.1% |
| ashmaw | Ashmaw the Wyrmling (boss) | dungeon | 60% / 30% / 8% / 2% plus a **guaranteed Rare+** | 1/8 | 100% / 32% |

Ashmaw chase rolls: Wyrmfang 1/150, Gravewarden's Crown 1/40, a Wyrmscale armour piece (Very Rare) 1/60, Wyrm Scale 1/12.

## Pity (owned by Loot, persisted in the item save)

- **First Rare (one-time per account):** counts every kill until the first Rare-or-better drop. Kills 1-9 add nothing extra. From kill 10 the chance of a forced beamed Rare climbs linearly to 12%, and kill 40 always gives one. In near town it is Rustbound gear, which GD's rat and goblin packs feed. 40 kills is about 10 min at 4 kills/min and 20 min at 2 kills/min. Stored as `firstRare: {done, kills, at, kill}`. Once `done`, it never resets.
- **Drought:** after 75 kills with no Rare+, the next kill adds one.
- **Server ownership:** today a player who clears local storage gets the first-Rare again. That is one Rustbound Rare, an accepted risk before the server exists. With the server, `firstRare` and `pity` move to the account row. The server rolls drops itself (same tables and seeds), and the client value is ignored, so clearing the save can't farm it.

## Simulation (same roller and pity rules)

`node dev/rpg/loot-sim.js`: 4000 players per scenario. 15 min near town at 4 kills/min, then 20-min dungeon runs at 5 kills/min with an elite every 5 min and the boss at the end. Output at commit time:

```
Week-1 loot sim: 4000 players/scenario, town 4 kills/min for 15 min, dungeon 5 kills/min, 20-min runs ending at the boss, seed 1
First-Rare pity: near-town kills 10+ ramp to 12%, guaranteed at kill 40; drought pity every 75 kills

scenario            first Rare: median   p90      max     <=20min | Very Rare: median  p90     <=60min | Legendary <=4h
route_pity                       5.3 min  9.0 min 10.0 min   100.0% |   27.0 min 55.2 min   94.3% | 68.9%
route_no_pity                    8.0 min 19.8 min 35.2 min    90.9% |   26.6 min 55.2 min   94.1% | 68.1%
town_only_pity                   5.0 min  9.0 min 10.0 min   100.0% |   46.0 min    2.4 h   57.8% | 24.2%
town_only_no_pity                7.8 min 25.5 min    2.0 h    83.3% |   46.5 min    2.4 h   57.7% | 24.1%

First 20-min dungeon run (with pity): Rare+ before the boss 98.4%, Very Rare+ anywhere in the run 70.0%, boss Rare+ 100% (guaranteed entry).
Share of players whose first Rare came from the first-Rare pity: 55.1% (town only).
Wyrmfang (1/150 per Ashmaw kill): median 102 boss kills = 34.0 h of 20-min runs; p90 333 kills = 111.0 h.
```

The slow case, at 2 kills/min near town (1500 players):

```
Week-1 loot sim: 1500 players/scenario, town 2 kills/min for 15 min, dungeon 5 kills/min, 20-min runs ending at the boss, seed 1
scenario            first Rare: median   p90      max     <=20min | Very Rare: median  p90     <=60min | Legendary <=4h
route_pity                      10.5 min 16.0 min 17.0 min   100.0% |   28.8 min 55.2 min   94.2% | 69.4%
route_no_pity                   15.2 min 22.4 min 35.2 min    80.9% |   28.8 min 55.2 min   93.1% | 68.3%
town_only_pity                  10.0 min 17.5 min 20.0 min   100.0% |      1.3 h    3.2 h   33.6% | 12.7%
town_only_no_pity               16.0 min 52.0 min    2.9 h    59.6% |      1.3 h    3.1 h   33.0% | 12.5%

```

## Shops (gold sink)

- `general_store` buys anything tradeable at x0.4. `smithy` (x1.15 buy / x0.55 sell) and `tackle` (x1.1 / x0.5) buy only their own categories.
- Unit buy is at least the value (up to +30% when stock is scarce). Unit sell is at most 0.6 × value (down to half that when stock is glutted). Both are checked on load and tested.
- Selling and rebuying can never create gold. A test also shows that buying inputs and selling crafted output always loses gold.
- Stock drifts 1 step toward its target every `restockMs`. A backwards clock gives 0 steps and never double-restocks.
- Normal, unbound items a player sells join the stock. Rare+ or bound items sold are destroyed. Legendary and chase items are refused (`not_sellable`).

## Skilling (`crafting.js`; XP is returned for core's stats.js)

- Furnace: ore → bar. Anvil (needs a Smithing Hammer): 1-5 bars → Normal gear, with the level set by tier plus kind.
- Fire or range: raw → cooked, or Charred Fish. The burn chance is 55% at the required level and falls linearly to 0% at the stop-burn level (Mudminnow 20, Brookfin 32).
- Logs plus a Flint Striker light a cooking fire.
- Gathering: `node_*` types with tool tier and level gates.
- Every make is one atomic op. If the output doesn't fit after consuming the inputs, nothing changes.
