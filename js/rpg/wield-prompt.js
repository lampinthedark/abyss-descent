/**
 * Core (Game Developer). One-tap Wield until the bag/equip UI lands.
 * When the hero has no weapon and the backpack holds a weapon they can equip
 * (e.g. Q1's smithed Rustbound sword), a small sheet offers Wield / Later.
 * Wield -> Equipment.equip(uid), toast, RPG.bus 'equip' {slot:'weapon', itemId}.
 * Later -> asks again on the next backpack change, at most every 30 s.
 * No-op without the items world (D1 stub).
 */
(function (root) {
  'use strict';
  const RPG = root.RPG;
  let hooked = false;
  let open = false;
  let laterAt = -1e9;

  function baseOf(id) {
    const Db = root.RPGItems && root.RPGItems.ItemsDb;
    try { return Db && Db.getBase ? Db.getBase(id) : null; } catch (e) { return null; }
  }
  // Tools (pickaxe, hatchet, rod...) work from the bag and never go in the weapon slot.
  function isTool(id) { const b = baseOf(id); return !!(b && (b.group === 'tool' || b.cat === 'tool')); }
  RPG.isToolItem = isTool;

  function candidate(Items) {
    const st = Items.Equipment.getStats();
    const worn = st && st.weapon && !isTool(st.weapon.base) ? st.weapon.base : null;
    let want = null;
    try { want = RPG.quests && RPG.quests.wantEquip ? RPG.quests.wantEquip() : null; } catch (e) { want = null; }
    const list = Items.Inventory.list() || [];
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v || v.equipSlot !== 'weapon' || isTool(v.base)) continue;
      // Prompt when the hands are empty, or when a quest step wants this exact item.
      if (worn && !(want && v.base === want && worn !== want)) continue;
      const ce = Items.Equipment.canEquip(v.uid);
      if (ce && ce.ok) return v;
    }
    return null;
  }

  function check() {
    const Items = RPG.items;
    if (!Items || open || !RPG.ui || !RPG.ui.dialog) return;
    if (performance.now() - laterAt < 30000) return;
    const v = candidate(Items);
    if (!v) return;
    open = true;
    const st0 = Items.Equipment.getStats();
    const line = st0 && st0.weapon && !isTool(st0.weapon.base) ? 'Wield the ' + v.name + '?' : 'Your hands are empty. Wield the ' + v.name + '?';
    // Wield is first = primary button; the item's rpg32 icon + name via drawDropRows.
    Promise.resolve(RPG.ui.dialog('wield', [line],
      [{ id: 'wield', label: 'Wield' }, { id: 'later', label: 'Later' }],
      { title: v.name, drops: [{ itemId: v.base, name: v.name, color: v.color || null, rarity: v.rarity }] }))
      .then(function (choice) {
        open = false;
        if (choice !== 'wield') { laterAt = performance.now(); return; }
        const r = Items.Equipment.equip(v.uid);
        if (r && r.ok === false) { RPG.ui.toast("You can't wield that yet."); return; }
        RPG.ui.toast(v.name + ' wielded', v.color || null);
        if (RPG.bus) RPG.bus.emit('equip', { slot: 'weapon', itemId: v.base });
      }, function () { open = false; });
  }
  RPG.wieldPrompt = { check: check };

  RPG.registerSystem({
    id: 'core-wield-prompt',
    update: function () {
      if (hooked || !RPG.items || !RPG.items.on) return;
      hooked = true;
      RPG.items.on('inventory', function () { setTimeout(check, 400); });
      if (RPG.bus) RPG.bus.on('quest', function () { setTimeout(check, 400); });
      setTimeout(check, 400);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
