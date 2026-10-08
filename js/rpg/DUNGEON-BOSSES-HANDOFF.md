# Dungeon & bosses handoff

This branch already contains Game Developer's unpushed D1 commits (tip `a9cb0db`, recreated locally; hashes differ). Once that branch is on GitHub, retarget the PR onto it. This slice still does not edit `rpg.html`, `main.js`, `store.js`, `world.js`, `combat.js`, or `fx-adapter.js`. The fresh hero's starter kit is 3 hearth bread and no weapon. Field goblins still die to bare-handed `RPG.combat.maxHit()` (1 while no weapon is equipped) through `takeHit`. Core combat is unchanged.

These scripts expect the D1 `window.RPG` API. They no-op missing pieces so they can load before a stub exists.

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

D1's `main.js` still wanders placeholder mobs until `RPG.ai` exists (`coreMobs()`). Paste the six scripts above the `main.js` tag. Then replace that placeholder `enter` spawn loop with:

```js
RPG.ai.spawnZone(RPG.world.zone);
```

`spawnZone` reads `zone.spawns`. Town (`zone.id === 'town'`, or `zone.aggroRadius`) uses a proximity override of 2 tiles (Chebyshev on tile floors). Content `aggro` / `sight` is not rewritten. A town goblin or rat aggros only when hit, or when the hero's tile is within 2. A pair shares that aggro and at most two town goblins chase at once. The other pair is not pulled. Town entries are two goblin pairs at `(5, 31)` and `(8, 32)`, each `n: 2`, `leash: 4`, `respawn: 10`, `area: {x0:4, y0:30, x1:10, y1:33}`. Wander stays inside `area`. Spawns, wander targets, and chase steps call `RPG.world.clearOfKeepOut(x, y)` and stop at the Ash Stair keepOut (`{x0:11, y0:26, x1:13, y1:27, r:5}`). A dead field mob respawns after `respawn` seconds. Ash Stair packs keep content aggro and full room aggro.

`spawnPack(monsterId, x, y, n, leash, opts)` is the same call. `opts` may be `{ area, respawn, scope }`. Monster ids: `rat`, `goblin`, `skeleton`, `imp`, `brute`, `ashmaw`.

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

Load the content scripts with the items scripts, before or after this slice. Read whatever `RPGContent` is on the page at call time. The Saturday integrate head for content and items is Senior `1fec787`: `Loot.rollDrop`'s fifth argument `{ questFinish }` is live, and this slice still passes `RPG.quests.completesOnKill(monsterId, ev)`. Monster and dungeon records still follow Senior `0f7d3fb`: `RPGContent.MONSTERS[id]` is `{ hp, def, atk, speed, aggro, leash, pack, name, sprite, attacks:[{ kind, anim, dmg, range, windupMs, cooldownMs, srcName, telegraph }] }`, and `RPGContent.Dungeon` is the Ash Stair (`rows`, `legend`, `props`, `spawns`, `entry`, `exits`, `bossRoom`, `rooms`, `townGate`). Content stamps `attack.anim` as `${sprite}_attack`, `${sprite}_slam`, or `${sprite}_charge` (jab/claw still map to `_attack`). That anim wins, except goblin ranged: when mobs2 has `mob_goblin_throw`, play that clip instead of the club key `mob_goblin_attack`, and spawn the rock on `hit_frame`. Ashmaw's sprite id is `mob_ashmaw` (a `mob_boss` id is rewritten). `srcName` on each attack is the monster display name (`Grave Brute`, `Ashmaw the Wyrmling`). If a record omits it, this slice fills it from `name`. `windupMs` is the tell: brute charge stays 700, and a floor never replaces a higher content value. One spawn row is one pack; size is `pack:[min,max]` when `n` is omitted. Ashmaw is already in the stair spawns, so the boss-room rect is not a second spawn. `townGate` is copied through (`town` 12, 27).

Atk on the mob (core's hit chance reads `mob.atk`): rat 1, goblin 8, skeleton 14, imp 18, brute 24, ashmaw 30.

If `RPGContent.Dungeon` is missing, `sample()` returns a thin `rustbound-crypt` fallback (`fallback: true`) so a headless boot still has a zone. That crypt is not the Ash Stair. `RPG.dungeon.fallbackSample()` is the same object. `RPG.dungeon.load(RPGContent.Dungeon)` also works.

Town stairs at `(12, 27)` call `RPG.dungeon.canEnter()` before `loadZone`. Core shows `line` as a toast and stays in town when `ok` is false. The stair stays shut until `RPG.quests.isDone('q2')` is true, and also when `RPG.quests` or `isDone` is missing. The shut line is `Warden Ilse wants a word before you go down.` A clear check returns `{ ok: true }` and core may load the stair. `load()` itself does not re-check the quest.

```js
RPG.dungeon.canEnter();
// { ok: false, line: 'Warden Ilse wants a word before you go down.' }
// or { ok: true }
```

Ashmaw can-drop nameplate uses the shared UI helper only. Skills & Quests draws the rumour screen with the same call and the same preview list. This slice does not map, recolor, or sort those rows.

```js
RPG.ui.drawDropRows(ctx, x, y, Loot.preview('ashmaw'));
// RPG.boss.canDropPanel(ctx, x, y) is that call.
```

`RPG.ui.drawDropRows` owns layout, icons (`icon_wyrmfang`, `icon_gravewarden_crown`, `icon_wyrm_scale` in `rsc-look/icons/rpg32/`), and rarity colours (Wyrmfang `#ff9a2e`). If `drawDropRows` is missing at runtime, `canDropPanel` no-ops. Do not add a second row renderer here.

`RPG.ai.tick(dtSeconds)` registers as system `'ai'` when `registerSystem` takes a name and a function. D1's `registerSystem({ id, update })` rejects that call, so the same tick is registered as `'ai-monsters'` and the frame loop already runs it. Pass **seconds**. The stepper splits frames so a leash is not tunneled.

## Hooks Game Developer must wire

1. **Bus before these scripts.** `RPG.on` / `RPG.emit`, or `RPG.bus.on` / `RPG.bus.emit`. This slice emits `kill` `{monsterId, x, y, elite, boss}` once per mob and `enter` `{zone}` from `RPG.dungeon.load`. It listens for `hurt` and `death`. It does **not** emit `hurt` or `death` (core owns those). Do not also emit `kill` from combat or the kill is doubled.

2. **`hurt` shape** for the recap: `{ amount, srcName, name, srcId, crit, target: 'hero' }`. `srcName` is the monster display name from the attack record. The recap shows that name (it wins over `name` when both are set). Only hero hits are kept. On `death` with a hero target, the last 3 are passed to `RPG.ui.showDeathRecap(recap)` (else `showDeath`, else `death`). If none of those exist, read `RPG.deathRecap.last` (`lastHits`, `hits`, `lines`, `revive`).

3. **Hero incoming damage.** Attacks call `RPG.hero.damage(amount, info)` when that is a function, with `info.srcName` set from the attack (`Grave Brute`, `Ashmaw the Wyrmling`). Core should emit `hurt` from there, copying `srcName` onto the event. If `damage` is not a function, the same `info` is passed to `hero.takeHit(amount, info)`. A numeric `RPG.hero.damage` is still the hero's outgoing number and is not called. If neither function exists, `hp` or `life` is reduced. Outgoing hero hits stay `mob.takeHit(dmg, {crit, srcId, knock})`.

4. **`RPG.rng('ai' | 'loot')`** returns `function () { return 0..1 }`. Called often; must not reset. These files never call `Math.random`.

5. **`RPG.world`**: `addEntity`, `removeEntity`, `get`, `near`, `path(x0,y0,x1,y1) -> [{x,y}]`, `isBlocked(x,y)`, `loadZone(zone)`. The zone includes `grid` (`1` blocked / `0` floor) plus, for Ash Stair, `rows`, `legend`, `props`, `rooms`, `exits`, `bossRoom`, and `entry`.

6. **`RPG.fx(name, ...tileCoords)`**. Clip key is `attack.anim` when content sets it: melee and ranged use `_attack` (Ashmaw claw is `mob_ashmaw_attack`), slam uses `_slam` (`mob_brute_slam`, `mob_ashmaw_slam`), charge uses `_charge`. Goblin ranged is the exception: `mob_goblin_throw` replaces `mob_goblin_attack` when that mobs2 clip exists, and `fx('rock', x, y)` fires on `hit_frame` (frame 1). Hold `animFrame` 0 for the whole live `windupMs` (content windup is the tell, and it is always at least sheet `ms[0]`), except the throw clip, which advances to `hit_frame`. Charge holds frame 1 for the whole dash. Brute jab is `_attack`; the ring slam is `_slam` plus `fx('telegraph', x, y, radius, {id, ms, kind})`. Ashmaw slam is the same telegraph. Charge is `fx('telegraphLine', x1, y1, x2, y2, {id, ms, kind})`. Both clear with `fx('telegraphOff', id)`. Beams are `fx('beam', x, y, rarity, drop)` only when `drop.beam` is set.

7. **Loot.** `Loot.rollDrop(monsterId, rng, x, y, opts)` (or `RPG.Loot` / `RPG.items.rollDrop`). As of Senior `1fec787`, `opts` is `{ questFinish }` and items reads it. `questFinish` is true only when `RPG.quests.completesOnKill(monsterId, ev)` returns true for the same kill payload this slice emits. If `RPG.quests` or `completesOnKill` is missing, `questFinish` is false. Items upgrades the roll inside `rollDrop` when `questFinish` is set and the table has no Rare yet. This slice still spawns that one result: no second drop and no second beam. Return a drop, an array, `{drops}`, or `{item, beam}`. This slice spawns `kind: 'drop'` entities and `registerTappable`s them. **Items must make `ashmaw` always return a beamed rare, epic, or legendary.** Until that table exists, `drops.js` adds a placeholder `{ name: 'Ashmaw Cache', rarity: 'rare', beam: true, placeholder: true }`. The nameplate does not read a private drop list. Paint it with `RPG.ui.drawDropRows(ctx, x, y, Loot.preview('ashmaw'))` and pass that array through unchanged. `Loot.preview` must be the items global.

8. **Sheets.** Field rats and goblins keep idle, walk, and attack on the lighter `mobs` atlas (`mob.sheetPack === 'mobs'`, keys `mob_rat_*` / `mob_goblin_*`, lighter field colours). Dungeon packs read `mobs2` (`mob_skeleton_*`, `mob_imp_*`, `mob_brute_attack`, `mob_brute_slam`, `mob_brute_charge`, `mob_ashmaw_attack`, `mob_ashmaw_slam`, `mob_ashmaw_charge`). `attack.anim` overrides those derived keys when content sets it, except the goblin throw above. Put atlases on `RPG.sheet.mobs` and `RPG.sheet.mobs2` (or `RPG.sheets`). A clip is drawn when its key is in that atlas; otherwise `render.mode` is `'box'` with `render.label`. mobs2 now has `mob_rat_hurt` (2), `mob_rat_death` (4), `mob_goblin_hurt` (2), `mob_goblin_death` (4), and `mob_goblin_throw` (3, `hit_frame` 1). `takeHit` plays `*_hurt` when that key exists, otherwise idle. Death plays `*_death` and holds the last frame (the corpse stays in the world). A missing death clip is an idle box. Frame timing is `anim.ms[0]` for a held windup pose. Live windup is `RPGContent.MONSTERS[id].attacks[].windupMs` (a keyed `RPG.content.monsters[id]` still overrides one attack). Sheet `ms[0]` can only raise that number. Floors: field melee/ranged ≥ 400, brute slam and charge ≥ 600, every Ashmaw attack ≥ 600. Hold frame 0 until `windupMs` elapses, except the throw clip, which advances to `hit_frame`. Charge holds frame 1 for the dash. `cooldownMs` is per attack, and a mob rests `RPGContent.REST_MS` (500) between swings. Ashmaw enrage (`belowHpPct` 30, `cooldownMult` 0.75) shortens those cooldowns. Core still owns the hit-chance formula; this slice sets `mob.atk` / `mob.def` and applies `attack.dmg` when a tell connects.

9. **Death UI revive.** One corpse revive per dungeon run. Button calls `RPG.deathRecap.offerRevive()` (uses `Ads.offerRevive` when present). On accept, call `RPG.deathRecap.confirmRevive(true)`. A second offer returns `'capped'` and does not call ads. `RPG.dungeon.load` calls `resetRun()`. Optional: `RPG.hero.revive()`; otherwise hp/life is refilled. Boss shield phase is cut and is not implemented.

10. **Tick registration.** D1's object form is already the fallback (`id: 'ai-monsters'`). If a future core accepts neither that nor `registerSystem('ai', fn)`, call `RPG.ai.tick(dtSeconds)` from the frame loop.

11. **Ash Stair lock.** Before `loadZone` on the town stairs `(12, 27)`, call `RPG.dungeon.canEnter()`. When `ok` is false, toast `line` and stay in town. Do not load the stair. When `ok` is true, load as usual. Missing quests and an unfinished `q2` both return the Warden Ilse line.

## Tap / test

```bash
node scripts/check-rpg-ai.js
```

`npm test` runs that script after the existing checks. The headless stub covers pack aggro, leash return, every melee windup ≥ 400ms, and Ashmaw slam/charge windups ≥ 600ms, plus kill/beam and the 3-hit recap.

In the browser, after the scripts are pasted: load Ash Stair with `RPG.dungeon.load(RPG.dungeon.sample())` and paint the Ashmaw can-drop list with `RPG.ui.drawDropRows(ctx, x, y, Loot.preview('ashmaw'))` (same call as the rumour screen). Kill a rat and confirm it stays belly-up on the last frame of `mob_rat_death`. Stand in a goblin's bow range and confirm `mob_goblin_throw` (the rock spawns on `hit_frame`) even though content anim is still `mob_goblin_attack`. Also call `spawnPack` for a goblin pack, walk one member into sight (the others should chase on `world.path`), kite past the leash and they walk home, and stand in melee so frame 0 of the club holds for the whole windup. On the stair, check a brute jab (`mob_brute_attack`) against its ring slam (`mob_brute_slam`) and line charge (`mob_brute_charge`), then Ashmaw's claw (`mob_ashmaw_attack`), slam (`mob_ashmaw_slam`), and charge (`mob_ashmaw_charge` frame 0, then frame 1 for the dash). Missing mobs2 keys stay labelled boxes.

## Per-spawn tuning (town spawn entries, read by `RPG.ai.spawnZone`)

- `aggro: false`: the entry never aggroes on proximity, only when hit, and a hit wakes only that mob (implies `pull: 'self'`).
- `aggroRadius: <tiles>`: overrides the zone's proximity radius (town default 2) for that entry.
- `pull: 'self'`: a hit wakes only the mob that was hit, not its pair. The 2-chaser cap still applies.
- All three survive the respawn.
