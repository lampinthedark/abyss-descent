# Dungeon & bosses handoff

Later: rebase this branch onto `cursor/rpg-d1-town-walk` once Game Developer pushes it.

Core (`rpg.html`, `main.js`, `store.js`, `world.js`, `combat.js`, `fx-adapter.js`) is untouched. These scripts expect the HOOKS `window.RPG` API. They no-op missing pieces so they can load before a stub exists.

## Paste into `rpg.html`

Load **after** core (world, combat, fx adapter, items / `Loot`) and **before** `main.js` if main boots systems and calls `spawnPack`.

```html
<script src="js/rpg/ai-attacks.js"></script>
<script src="js/rpg/ai-monsters.js"></script>
<script src="js/rpg/drops.js"></script>
<script src="js/rpg/death-recap.js"></script>
<script src="js/rpg/boss-ashmaw.js"></script>
<script src="js/rpg/dungeon.js"></script>
```

## What to call

Goblin field (replaces the D1 placeholder wander in `main.js`):

```js
RPG.ai.spawnPack('goblin', x, y, 4, 9);
RPG.ai.spawnPack('rat', x, y, 3, 7);
```

`spawnPack(monsterId, x, y, n, leash)` returns the mob array. Same pack id, shared aggro, leash in tiles. Monster ids: `rat`, `goblin`, `skeleton`, `imp`, `brute`, `ashmaw`.

Default outside-town field (placeholder tiles until the town exit is real):

```js
RPG.ai.spawnField();
// or RPG.ai.spawnField([{ monsterId: 'goblin', x, y, n: 4, leash: 9 }]);
// Monsters.spawnField is the same function.
```

Ash Stair, once `RPGContent.Dungeon` is on the page (content script before or after this slice; it is read at call time):

```js
RPG.dungeon.load(RPG.dungeon.sample());
// sample() copies rows, legend, props, rooms, spawns, entry, exits, bossRoom
// and a 0/1 grid (legend.walk false, or walkable(), plus blocking props).
```

Load the content scripts with the items scripts, before or after this slice. `RPGContent.MONSTERS` supplies hp, def, atk, speed, aggro, leash, pack, and `attacks[]` (`melee` | `ranged` | `charge` | `slam`, `windupMs`, `cooldownMs`, telegraph `ring` | `line`). One spawn row is one pack; size is `pack:[min,max]` when `n` is omitted. Ashmaw is already in the stair spawns, so the boss-room rect is not a second spawn.

Atk on the mob (core's hit chance reads `mob.atk`): rat 1, goblin 8, skeleton 14, imp 18, brute 24, ashmaw 30.

If `RPGContent.Dungeon` is missing, `sample()` returns a thin `rustbound-crypt` fallback (`fallback: true`) so a headless boot still has a zone. That crypt is not the Ash Stair. `RPG.dungeon.fallbackSample()` is the same object. `RPG.dungeon.load(RPGContent.Dungeon)` also works.

Ashmaw can-drop nameplate (rumour copy belongs to Skills & Quests; do not build it here):

```js
RPG.ui.showCanDrop = function (panel) {
  // panel.title === 'Can drop'
  // panel.drops is Loot.preview order: { name, icon, rarity, beamColor, label, source }
  // Wyrmfang beamColor is #ff9a2e. Other rows keep preview beamColor / rarity colour.
  // Icons are preview.icon (rsc-look/icons/rpg32/: icon_wyrmfang, icon_gravewarden_crown, icon_wyrm_scale).
};
const panel = RPG.boss.canDropPanel('ashmaw');
```

Spawning Ashmaw calls that hook when it exists and stores the same object on `mob.canDrop` and `RPG.bossPanel`. Call `RPG.boss.canDropPanel('ashmaw')` again when the nameplate opens so the list is whatever `Loot.preview` returns at that moment. If no UI hook is installed, draw `panel.drops` from that return value.

`RPG.ai.tick(dtSeconds)` is also registered as system `'ai'`. Pass **seconds**. The stepper splits frames so a leash is not tunneled.

## Hooks Game Developer must wire

1. **Bus before these scripts.** `RPG.on` / `RPG.emit`, or `RPG.bus.on` / `RPG.bus.emit`. This slice emits `kill` `{monsterId, x, y, elite, boss}` once per mob and `enter` `{zone}` from `RPG.dungeon.load`. It listens for `hurt` and `death`. It does **not** emit `hurt` or `death` (core owns those). Do not also emit `kill` from combat or the kill is doubled.

2. **`hurt` shape** for the recap: `{ amount, name, srcId, crit, target: 'hero' }`. Only hero hits are kept. On `death` with a hero target, the last 3 are passed to `RPG.ui.showDeathRecap(recap)` (else `showDeath`, else `death`). If none of those exist, read `RPG.deathRecap.last` (`hits`, `lines`, `revive`).

3. **Hero incoming damage.** Attacks call `RPG.hero.takeHit(dmg, info)`. That is where core should emit `hurt`. If `takeHit` is missing, `hp` or `life` is reduced so a headless stub still sees the hit. `RPG.hero.damage` is treated as the hero's outgoing number; combat should pass it into `mob.takeHit(dmg, {crit, srcId, knock})`.

4. **`RPG.rng('ai' | 'loot')`** returns `function () { return 0..1 }`. Called often; must not reset. These files never call `Math.random`.

5. **`RPG.world`**: `addEntity`, `removeEntity`, `get`, `near`, `path(x0,y0,x1,y1) -> [{x,y}]`, `isBlocked(x,y)`, `loadZone(zone)`. The zone includes `grid` (`1` blocked / `0` floor) plus, for Ash Stair, `rows`, `legend`, `props`, `rooms`, `exits`, `bossRoom`, and `entry`.

6. **`RPG.fx(name, ...tileCoords)`**. Clip key is `${mob.sprite}_${suffix}`: melee and ranged use `_attack` (Ashmaw claw is `mob_ashmaw_attack`), slam uses `_slam` (`mob_brute_slam`, `mob_ashmaw_slam`), charge uses `_charge`. Hold `animFrame` 0 for the whole live `windupMs` (content windup is the tell, and it is always at least sheet `ms[0]`). Charge holds frame 1 for the whole dash. Brute jab is `_attack`; the ring slam is `_slam` plus `fx('telegraph', x, y, radius, {id, ms, kind})`. Ashmaw slam is the same telegraph. Charge is `fx('telegraphLine', x1, y1, x2, y2, {id, ms, kind})`. Both clear with `fx('telegraphOff', id)`. Beams are `fx('beam', x, y, rarity, drop)` only when `drop.beam` is set.

7. **Loot.** `Loot.rollDrop(monsterId, rng, x, y)` (or `RPG.Loot` / `RPG.items.rollDrop`). Return a drop, an array, `{drops}`, or `{item, beam}`. This slice spawns `kind: 'drop'` entities and `registerTappable`s them. **Items must make `ashmaw` always return a beamed rare, epic, or legendary.** Until that table exists, `drops.js` adds a placeholder `{ name: 'Ashmaw Cache', rarity: 'rare', beam: true, placeholder: true }`. The nameplate reads `Loot.preview('ashmaw')` through `RPG.boss.canDropPanel` and does not invent drop names. Order is the preview order. Wyrmfang is drawn `#ff9a2e`.

8. **Sheets.** Field rats and goblins stay on the lighter `mobs` atlas (`mob.sheetPack === 'mobs'`, keys `mob_rat_*` / `mob_goblin_*`). Dungeon packs read `mobs2` (`mob_skeleton_*`, `mob_imp_*`, `mob_brute_attack`, `mob_brute_slam`, `mob_brute_charge`, `mob_ashmaw_attack`, `mob_ashmaw_slam`, `mob_ashmaw_charge`). Put those atlases on `RPG.sheet.mobs` and `RPG.sheet.mobs2` (or `RPG.sheets`). A clip is drawn when its key is in that atlas; otherwise `render.mode` is `'box'` with `render.label`. Frame timing is `anim.ms[0]` for the windup pose. Live windup is `RPGContent.MONSTERS[id].attacks[].windupMs` (a keyed `RPG.content.monsters[id]` still overrides one attack). Sheet `ms[0]` can only raise that number. Floors: field melee/ranged ≥ 400, brute slam and charge ≥ 600, every Ashmaw attack ≥ 600. Hold frame 0 until `windupMs` elapses. Charge holds frame 1 for the dash. `cooldownMs` is per attack, and a mob rests `RPGContent.REST_MS` (500) between swings. Ashmaw enrage (`belowHpPct` 30, `cooldownMult` 0.75) shortens those cooldowns. Core still owns the hit-chance formula; this slice sets `mob.atk` / `mob.def` and applies `attack.dmg` when a tell connects.

9. **Death UI revive.** One corpse revive per dungeon run. Button calls `RPG.deathRecap.offerRevive()` (uses `Ads.offerRevive` when present). On accept, call `RPG.deathRecap.confirmRevive(true)`. A second offer returns `'capped'` and does not call ads. `RPG.dungeon.load` calls `resetRun()`. Optional: `RPG.hero.revive()`; otherwise hp/life is refilled. Boss shield phase is cut and is not implemented.

10. **Tick registration.** If `registerSystem('ai', fn)` does not match core's signature, call `RPG.ai.tick(dtSeconds)` from the frame loop yourself.

## Tap / test

```bash
node scripts/check-rpg-ai.js
```

`npm test` runs that script after the existing checks. The headless stub covers pack aggro, leash return, every melee windup ≥ 400ms, and Ashmaw slam/charge windups ≥ 600ms, plus kill/beam and the 3-hit recap.

In the browser, after the scripts are pasted: load Ash Stair with `RPG.dungeon.load(RPG.dungeon.sample())` and open the Ashmaw can-drop panel (`RPG.boss.canDropPanel('ashmaw')`, Wyrmfang first in `#ff9a2e`). Also call `spawnPack` for a goblin pack, walk one member into sight (the others should chase on `world.path`), kite past the leash (they walk home), stand in melee and confirm frame 0 of `mob_goblin_attack` holds for the whole windup, kill one and confirm a drop plus a beam when `d.beam`, die and confirm the last three hero hits. On the stair, check a brute jab (`mob_brute_attack`) against its ring slam (`mob_brute_slam`) and line charge (`mob_brute_charge`), then Ashmaw's claw (`mob_ashmaw_attack`), slam (`mob_ashmaw_slam`), and charge (`mob_ashmaw_charge` frame 0, then frame 1 for the dash). Missing mobs2 keys stay labelled boxes.
