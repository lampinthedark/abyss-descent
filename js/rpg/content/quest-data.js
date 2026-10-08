/**
 * Week-1 quests (data only). Shapes:
 *
 *   quest  { id, order, title, giver, requires, ship:'week1'|'stub', summary,
 *            dialogue:{ offer:{lines, actions}, progress:{lines}, complete:{lines, actions}, rumour? },
 *            onAccept:{ items:[{base, qty}] }, steps:[step], rewards:{ xp:{skill:n}, gold, items:[{base, qty}] }, next }
 *   step   { text, arrowTo: npcId | nodeKey | zone | propKey, done:{ type, target, count } }
 *          type 'talk' -> target npc id     'gather' -> item id (one per successful swing)
 *               'craft' -> recipe id        'equip'  -> item base id    'kill' -> monster id
 *               'enter' -> zone id
 *
 * Flow GD already shows: the questgiver wears a "!" while a quest is offered;
 * the offer dialogue ends in an Accept action; accepting grants onAccept items
 * (Inventory.grant, src 'quest') and the tracker shows steps[0] at once.
 * The final 'talk' step pays rewards (gold tagged 'quest'; XP via core stats).
 *
 * Week-1 scope: Q1 + Q2 ship. Q3 is a STUB (ship:'stub') - the dungeon and
 * ashmaw ship this week, reached from Q2's follow-up line / the rumour, but
 * the Q3 quest itself (and Ground Slam, the boss shield phase) is week 2.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var C = isNode ? require('./content-core.js') : root.RPGContent;
  factory(C);
  if (isNode) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis, function (C) {
  'use strict';

  var ACCEPT = [{ id: 'accept', label: 'Accept' }, { id: 'decline', label: 'Not now' }];
  var CLAIM = [{ id: 'claim', label: 'Claim reward' }];

  C.QUESTS = [
    {
      id: 'q1_blade', order: 1, title: 'A Blade of Your Own', giver: 'questgiver', requires: null, ship: 'week1',
      gate: 'UAT 2: mine, smelt, smith, wear in under 10 min; next step always visible',
      summary: 'Mine 2 Rustbound ore, smelt 2 bars, smith a Rustbound Sword, wield it, report back.',
      dialogue: {
        offer: {
          lines: [
            'Empty hands on the Ash Stair road? That won\'t do.',
            'Mine two lumps of Rustbound ore from the east rocks.',
            'Smelt them at the furnace, then hammer a sword on the anvil.',
            'Take this pick and hammer. Come back armed.',
          ],
          actions: ACCEPT,
        },
        progress: { lines: ['Rocks east of the square. Furnace and anvil by Oren\'s yard.'] },
        complete: {
          lines: ['Now that is a blade. Ugly, but yours.', 'Keep the pick. You will want more ore soon.'],
          actions: CLAIM,
        },
      },
      onAccept: { items: [{ base: 'rustbound_pickaxe', qty: 1 }, { base: 'smithing_hammer', qty: 1 }] },
      steps: [
        // GD's Friday build shows exactly this text with the arrow on the rocks right after Accept.
        { text: 'Mine Rustbound ore', arrowTo: 'node_ore_rustbound', done: { type: 'gather', target: 'rustbound_ore', count: 2 } },
        { text: 'Smelt Rustbound bars at the furnace', arrowTo: 'prop_furnace_0', done: { type: 'craft', target: 'smelt_rustbound', count: 2 } },
        { text: 'Smith a Rustbound Sword at the anvil', arrowTo: 'prop_anvil_0', done: { type: 'craft', target: 'smith_rustbound_sword', count: 1 } },
        { text: 'Wield your Rustbound Sword (bag)', arrowTo: 'questgiver', done: { type: 'equip', target: 'rustbound_sword', count: 1 } },
        { text: 'Report to Warden Ilse', arrowTo: 'questgiver', done: { type: 'talk', target: 'questgiver', count: 1 } },
      ],
      rewards: { xp: { mining: 40, smithing: 60 }, gold: 25, items: [{ base: 'hearth_bread', qty: 3 }] },
      next: 'q2_field',
    },
    {
      id: 'q2_field', order: 2, title: 'The Goblin Field', giver: 'questgiver', requires: 'q1_blade', ship: 'week1',
      gate: 'UAT 4 lead-in: puts the player on the near-town packs where first-Rare pity fires',
      summary: 'Catch and cook 2 fish, then clear 4 goblins in the field past the pond, report back.',
      dialogue: {
        offer: {
          lines: [
            'Goblins dug in past the south pond. Rats run with them.',
            'Fight hungry and you fight badly. Catch two fish and cook them.',
            'Then thin the goblins. Four will do. Roll away from big swings.',
          ],
          actions: ACCEPT,
        },
        progress: { lines: ['Fish at the pond, cook at the range, goblins to the south.'] },
        complete: {
          lines: [
            'The field is quiet. Good work.',
            'Take this shield. Something worse sleeps under the Ash Stair.',
          ],
          actions: CLAIM,
        },
        // Follow-up after Q2 (and the questgiver's idle line once Q2 is done):
        // points players at the dungeon this week even though Q3 is a stub.
        rumour: {
          lines: [
            'Miners swear a beast called Ashmaw nests under the Ash Stair.',
            'They say it guards Wyrmfang, a blade cut from a wyrm\'s tooth.',
            'The stair is at the end of the south path. Go geared.',
          ],
          showDrops: 'ashmaw',     // GD: render RPGItems Loot.preview('ashmaw') under these lines
          arrowTo: 'ash_stair_gate',
        },
      },
      onAccept: { items: [{ base: 'fishing_rod', qty: 1 }] },
      steps: [
        { text: 'Catch fish at the pond ({n}/{count})', arrowTo: 'node_fish_0', done: { type: 'gather', target: 'raw_mudminnow', count: 2 } },
        // Counts every cook attempt (a charred fish still counts) so a 55% burn
        // chance at Cooking 1 never stalls the quest.
        { text: 'Cook fish at the range ({n}/{count})', arrowTo: 'prop_range_0', done: { type: 'craft', target: 'cook_mudminnow', count: 2 } },
        { text: 'Head to the Goblin Field', arrowTo: 'goblin_field', done: { type: 'enter', target: 'goblin_field', count: 1 } },
        { text: 'Defeat goblins ({n}/{count})', arrowTo: 'goblin_field', done: { type: 'kill', target: 'goblin', count: 4 } },
        { text: 'Report to Warden Ilse', arrowTo: 'questgiver', done: { type: 'talk', target: 'questgiver', count: 1 } },
      ],
      rewards: { xp: { fishing: 40, cooking: 40 }, gold: 60, items: [{ base: 'rustbound_shield', qty: 1 }, { base: 'travellers_stew', qty: 2 }] },
      next: 'q3_ashmaw',
    },
    {
      // STUB (week 2 builds it out): ids and targets are real so the trackers,
      // arrows and tests work if GD turns it on early.
      id: 'q3_ashmaw', order: 3, title: 'Beneath the Ash Stair', giver: 'questgiver', requires: 'q2_field', ship: 'stub',
      summary: 'Enter the Ash Stair, defeat Ashmaw, report back.',
      dialogue: {
        offer: { lines: ['Ashmaw. Under the stair.', 'Bring food, and roll when the ground glows.'], actions: ACCEPT },
        progress: { lines: ['Down the stair at the end of the south path.'] },
        complete: { lines: ['You came back. Most don\'t.'], actions: CLAIM },
      },
      onAccept: { items: [] },
      steps: [
        { text: 'Enter the Ash Stair', arrowTo: 'ash_stair_gate', done: { type: 'enter', target: 'ash_stair', count: 1 } },
        { text: 'Defeat Ashmaw', arrowTo: 'ash_stair_boss', done: { type: 'kill', target: 'ashmaw', count: 1 } },
        { text: 'Report to Warden Ilse', arrowTo: 'questgiver', done: { type: 'talk', target: 'questgiver', count: 1 } },
      ],
      rewards: { xp: {}, gold: 150, items: [{ base: 'travellers_stew', qty: 3 }] },
      next: null,
    },
  ];
  C.QUEST_IDS = C.QUESTS.map(function (q) { return q.id; });
  C.WEEK1_QUESTS = C.QUESTS.filter(function (q) { return q.ship === 'week1'; }).map(function (q) { return q.id; });

  /** Questgiver marker: '!' when a quest is offerable, '?' when one is ready to hand in, '' otherwise. */
  C.giverMarker = function (npcId, log) {
    log = log || {};   // { done:{questId:true}, active:{questId, step, n} | null }
    var a = log.active;
    if (a) {
      var q = C.quest(a.questId);
      var last = q && q.steps[q.steps.length - 1];
      return (q && q.giver === npcId && a.step === q.steps.length - 1 && last.done.type === 'talk') ? '?' : '';
    }
    var off = C.offerable(npcId, log);
    return off ? '!' : '';
  };
  /** First week-1 quest this NPC can offer now (stubs only if opts.stubs). */
  C.offerable = function (npcId, log, opts) {
    log = log || {}; var done = log.done || {};
    for (var i = 0; i < C.QUESTS.length; i++) {
      var q = C.QUESTS[i];
      if (q.giver !== npcId || done[q.id]) continue;
      if (q.ship === 'stub' && !(opts && opts.stubs)) continue;
      if (q.requires && !done[q.requires]) continue;
      return q;
    }
    return null;
  };
});
