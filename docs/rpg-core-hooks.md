# RPG core hooks and file boundaries (owner: Game Developer, integrator)
Branch base: #28 FX head c39b8d2. All code lives in js/rpg/. Units are tiles (float), 32x18 art px per tile. Load order: core first, then your files, then main.js.

## Files
- CORE (GD only): rpg.html, js/rpg/{main,store,save,sheet,world,render,camera,input,path,hero,combat,fx-adapter,ui,items-stub}.js, scripts/check-names.js
- SKILLS & QUESTS: js/rpg/{skills-xp,skills-gather,skills-craft,quests-runtime,quests-ui}.js
- DUNGEON & BOSSES: js/rpg/{ai-monsters,ai-attacks,boss-ashmaw,dungeon,drops,death-recap}.js
- ITEMS (Senior Game Dev): its own files per docs/rpg-items-integration.md
- Need a core change? Ask GD in the room with the exact hook. Never edit another owner's file.

## Core API (window.RPG)
- RPG.bus.on(evt, fn) / RPG.bus.emit(evt, data). Core emits:
  talk {npcId} | gather {skill,nodeKey,itemId,qty} | craft {recipeId,itemId} | equip {slot,itemId}
  kill {monsterId,x,y,elite,boss} | enter {zone} | hurt {dmg,srcId,srcName,kind} | death {lastHits} | tick {dt}
  Owners may emit gather/craft/kill themselves; core never double-emits them.
- RPG.registerSystem({id, update(dt), draw(ctx, cam, layer)}). Layers: 'ground', 'under', 'sorted' (y-sorted by footY), 'fx', 'ui'.
- RPG.registerTappable({id, hit(tx,ty) -> entity|null, range, onArrive(entity)}). Input walks the hero into range, then calls onArrive. Priority: npc > mob > node/station > drop > tile.
- RPG.world: isBlocked(tx,ty), path(from,to), addEntity(e) -> id, removeEntity(id), get(id), near(x,y,r,kind?), zone, loadZone(zoneData)
- Entity: {id, kind:'npc'|'mob'|'node'|'station'|'drop', x, y, sprite, frame, flip, footY, ...yours}. Mobs implement takeHit(dmg, {crit, srcId, knock}) -> {dead}.
- RPG.hero: {x, y, hp, maxHp, dodging, alive}, damage(amount, {srcId, srcName, kind}), heal(n). Combat maths reads Equipment.getStats().
- RPG.stats.level(skill), RPG.stats.addXp(skill, xp) (goes through Store). Skills: attack, strength, defence, hitpoints, mining, smithing, woodcutting, fishing, cooking.
- Store.register(slice, reducer, initial). Store.dispatch({type:'<slice>/<verb>', ...}). Save: within 1 s of a durable dispatch, plus on hidden, pagehide and app pause. ItemSave.flush() is called on the same triggers.
- RPG.fx(name, ...args): guarded FX call with tile-to-FX coords converted (telegraph, telegraphLine, telegraphOff, shield, lootPull, beam, hit, kill, pickup).
- RPG.ui.toast(text, color?), RPG.ui.float(x, y, text, color), RPG.ui.dialog(npcId, lines, choices) -> Promise, RPG.ui.tracker(text, arrowTo).
- RPG.rng(stream): seeded streams ('loot', 'ai', 'skill'). Use them, never Math.random, so seeds replay.

---

## Agreed contract details (D1 core builds to these)

### Zones (`RPG.world.loadZone(zoneData)`)
```
{ id, w, h,
  grid:    [[sheetKey | null]]          // h rows x w cols; null = void (blocks)
  blocked: [[0 | 1]]                    // optional; else derived: null cells and water keys block
  spawns:  [{monsterId, x, y, n, leash}]
  entry:   {x, y}
  bossRoom:{x, y, w, h}                 // optional
  exit:    {x, y, to}
  markers: { ore:[{x,y,tier}], tree:[{x,y,kind}], fish:[{x,y}],
             furnace:{x,y}, anvil:{x,y}, range:{x,y}, fire:{x,y} },
  // optional core extras: edges:[[[sheetKey]]] overlays, props:[decor], npcs:[{id, sprite, name, x, y}]
}
```
- `RPG.world.zone` = `{ id, w, h, entry, exit, bossRoom, spawns, markers, data }`, so `RPG.world.zone.markers` is the marker set.
- loadZone sets the blocking tiles under every marker. Core does **not** place gather nodes or crafting stations as entities.
- Core emits bus `enter` `{zone:'town'}` **once** after load (after save restore and hero placement). Every later `loadZone` emits `enter` itself.
- D1 placeholders: the core system `core-marker-placeholders` (and tappable `core-markers`) draws and taps nodes and stations from the markers, and switches itself off when `RPG.skills` exists. Skills & Quests spawns the real entities on `enter`.
- Monster ids are exactly `rat`, `goblin`, `skeleton`, `imp`, `brute` (elite) and `ashmaw` (boss). D1 field mobs are `kind:'mob'` entities added with `RPG.world.addEntity`, with a placeholder wander that only runs while `!RPG.ai` (Dungeon & Bosses' `RPG.ai.spawnPack` takes over).

### NPCs and quests
- NPC ids: `npc_questgiver`, `npc_banker`, `npc_shopkeep`, `npc_smith`. On arrival core emits `talk` `{npcId}`.
- Core's placeholder quest slice (`coreQuestStub`), tracker, NPC lines and stand-in rumour run **only if `RPG.quests` is absent**. Skills & Quests owns the questgiver dialog whenever `RPG.quests` is loaded.

### Tappables
- Priority by entity kind: npc > mob > node/station > drop, then tile. At equal priority an owner's tappable beats a core one (core tappables carry `core:true`); otherwise the later registration wins. An entity may carry its own `range` (tiles).

### XP
- Core does **not** grant XP from Crafting results. Skill files call `RPG.stats.addXp` themselves.
- Combat XP constants (`RPG.combat.XP`): `PER_DAMAGE: 1` to the style's stat, plus `HITPOINTS_PER_DAMAGE: 0.33` to Hitpoints. `RPG.combat.xpFor(dmg)` returns `{stat, hitpoints}`. Combat itself is D3.

### Hero
- `RPG.hero.damage(raw, {srcId, srcName, kind, atk})` returns `{hit, dodged, dmg}`:
  1. If `hero.dodging` (i-frames), returns `{hit:false, dodged:true, dmg:0}`.
  2. Rolls a hit on `RPG.rng('combat')`: `p = clamp(0.75 + 0.015 * (atk - stats.level('defence') - Equipment.getStats().def), 0.40, 0.97)`. A miss returns `{hit:false, dodged:false, dmg:0}`, records nothing and emits nothing.
  3. `dmg = round(raw * 50 / (50 + Equipment.getStats().armour))`.
  4. Keeps the last 3 hits in `RPG.hero.lastHits` (`{dmg, srcId, srcName, kind, t}`) and emits `hurt` `{dmg, srcId, srcName, kind}`. At 0 hp it emits `death` `{lastHits}`.
- Core shows no death recap; `death-recap.js` does. While no `death-recap` system is registered, a placeholder respawns the hero at `zone.entry` after 1.5 s.
- Out-of-combat regen: 2 HP/s once 4 s have passed with no damage taken.

### Store
- `Store.get(slice)` and `Store.getState()` return **live** state (the current objects), including right after a save restore (`Store.boot()`).
- Log-only actions: any `items/*` type (e.g. `items/op`) is appended to the replay log only. No reducer runs and no core save is scheduled. Use `Store.log({type:'items/op', op})`.
- Every save trigger (within 1 s of a durable dispatch, `visibilitychange` hidden, `pagehide`, Capacitor pause) also calls `ItemSave.flush()` through a guard.

### Camera
- `RPG.camera.toScreen(x, y)` takes **tile** coords and returns `{x, y}` in the canvas pixel space the `'ui'` draw layer's ctx uses (device px, identity transform). `cam.toScreen` in `draw(ctx, cam, layer)` is the same function. `RPG.camera.toTile(px, py)` is the inverse. `RPG.camera.artToScreen(ax, ay)` takes art px (core rendering).

### UI
- `RPG.ui.dialog(npcId, lines, choices, opts)` returns a Promise of the choice id, or `null`.
  - A `lines` item is a string or an array of segments (`'text'` or `{text, color}`), for coloured names.
  - `choices`: `[{id, label}]` or strings.
  - `opts.title` sets the header text (default: the NPC's name).
  - `opts.drops` is an array of `Loot.preview`-style entries, drawn under the last line with `drawDropRows`.
- `RPG.ui.drawDropRows(ctx, x, y, drops, opts?)` returns the height drawn, shared by core, Skills & Quests and the boss panel.
  - Takes `Loot.preview` entries as-is and reads `itemId` (or `base`), `name`, `rarity`, `icon` and an optional `color`.
  - Each row draws the 32 px icon from the rpg32 sheets (`icon`, else `icon_<itemId>`; e.g. `icon_wyrmfang`, `icon_gravewarden_crown`, `icon_wyrm_scale`, `icon_wyrm_cuirass`), then the name.
  - Name colour: the entry's `color` if present. Otherwise the rarity map (legendary `#ff9a2e`, very rare `#c070ff`, rare `#5aa0ff`), otherwise white `#ffffff`. The art has no rarity colour baked in.
  - `opts`: `scale` (ctx px per art px, default 1), `rowH`, `maxW`, `font`.
- Core's stand-in rumour (questgiver, "Ask about rumours", only without `RPG.quests`) uses `dialog(..., {title:'Rumours', drops})`. The drops are, in order: Wyrmfang `#ff9a2e`, Gravewarden's Crown `#c070ff`, Wyrmscale armour `#c070ff` and Wyrm Scale gold `#e8c84a` (locked values, in this order), each with an explicit `color`. When the real `Loot` is loaded, the real `Loot.preview('ashmaw')` entries are used as-is, with hard-coded entries for anything the preview omits.

### Items world
- `RPG.bootItems()` (in items-stub.js, called by main.js at boot) is a no-op until `js/rpg/items/*.js` is on the page. Once it is, it calls `RPGItems.createWorld({playerId:'local', getLevels: () => RPG.skills ? RPG.skills.levels() : {}})`, then load, starter kit, `installLifecycle` and `installGlobals`, which replaces the stubs. `levels` is a function.
- Core never mints item ids (`ItemIds.next()` belongs to items). `Ids.mint(kind)` is for non-item core ids only and refuses `'item'`.

### Sheets
- `assets/rpg/sheets.json` lists the sheets: phaseb, town, hero, mobs, icons (rpg32), icons_tinted. A later sheet wins on key clashes. Swap a PNG and JSON pair to drop in new art. Missing keys draw labelled placeholder boxes.

## Hero sprite set
- Core draws `hero_bare_*` whenever `Equipment.getStats().weapon` is null (fresh save, bread-only start) and `hero_rustbound_*` once a weapon is equipped (Q1's smithed sword). Re-checked every 250 ms. The current set is on `RPG.hero.spriteSet` ('hero_bare' | 'hero_rustbound') so combat can play `${spriteSet}_attack`.
- Unarmed max hit is 1 (PM ruling): `RPG.combat.maxHit()` returns 1 while `Equipment.getStats().weapon` is null.

## One-tap Wield (`js/rpg/wield-prompt.js`, core)
- Until the bag/equip UI lands: tools (`group:"tool"`, e.g. pickaxe, hatchet) are never offered and work from the bag; a worn tool counts as bare hands. Whenever no weapon is worn, or a new item matches `RPG.quests.wantEquip()`, and the backpack holds a weapon that `Equipment.canEquip(uid).ok` allows, a sheet titled with the item name offers Wield / Later. It re-checks on every items `inventory` event.
- Wield calls `Equipment.equip(uid)`, toasts "<name> wielded" and emits `RPG.bus` `equip {slot:'weapon', itemId}`. The hero swaps to `hero_rustbound_*` within 250 ms.
- Later waits 30 s before asking again (on the next backpack change). `RPG.wieldPrompt.check()` forces a check.
