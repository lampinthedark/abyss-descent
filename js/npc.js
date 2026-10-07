/** Story NPCs and dialogue */
const Npc = (() => {
  const DEFS = {
    hermit: {
      id: 'hermit',
      name: 'Ashen Hermit',
      kind: 'hermit',
      lines: [
        'Traveler… the Abyss drinks light. It was once a well of stars.',
        'Demons rose when the seal cracked. Clear this floor, then seek the portal.',
        'Deeper still lies a relic of the first wardens. Bring word if you live.',
      ],
      questTip: 'Clear the floor, then find the glowing portal.',
    },
    knight: {
      id: 'knight',
      name: 'Wounded Knight',
      kind: 'knight',
      lines: [
        'I held the stair… until the wraiths came. Take my blessing and go.',
        'The portal answers only the cleansed — leave no demon standing.',
        'If you see the Hermit above… tell him I kept my oath.',
      ],
      questTip: 'Defeat every demon, then descend the portal.',
    },
    whisper: {
      id: 'whisper',
      name: 'Whispering Shade',
      kind: 'demon',
      lines: [
        'Yesss… descend, little spark. The deep hungers for names.',
        'Your steel is loud. Your fear is louder. Keep walking.',
        'The relic is a lie — or a key. Either way, it waits below.',
      ],
      questTip: 'Resist the whisper. Clear demons. Find the portal.',
    },
  };

  function createForFloor(map, floor) {
    const list = [];
    // Down-screen of the player (or the portal) so the sprite overlaps lit floor tiles.
    if (floor === 1 || floor % 3 === 1) {
      const spot = MapGen.placeBeside(map, map.startX, map.startY);
      list.push(make('hermit', spot.x, spot.y));
    } else if (floor % 3 === 2) {
      const spot = MapGen.placeBeside(map, map.startX, map.startY);
      list.push(make('knight', spot.x, spot.y));
    } else {
      const spot = MapGen.placeBeside(map, map.stairsX, map.stairsY);
      list.push(make('whisper', spot.x, spot.y));
    }
    return list;
  }

  function make(key, x, y) {
    const d = DEFS[key];
    return {
      type: 'npc',
      id: d.id,
      name: d.name,
      kind: d.kind,
      x, y,
      lines: d.lines.slice(),
      questTip: d.questTip,
      lineIndex: 0,
      talked: false,
      talkedThrough: false,
      bob: Math.random() * Math.PI * 2,
    };
  }

  function restore(data) {
    if (!data) return null;
    const npc = make(DEFS[data.id] ? data.id : 'hermit', data.x, data.y);
    npc.lineIndex = data.lineIndex || 0;
    npc.talked = !!data.talked || npc.lineIndex > 0;
    npc.talkedThrough = !!data.talkedThrough || npc.lineIndex >= npc.lines.length;
    if (typeof data.bob === 'number') npc.bob = data.bob;
    return npc;
  }

  function nextLine(npc) {
    if (npc.lineIndex >= npc.lines.length) return null;
    const line = npc.lines[npc.lineIndex++];
    npc.talked = true;
    if (npc.lineIndex >= npc.lines.length) npc.talkedThrough = true;
    return line;
  }

  return { DEFS, createForFloor, restore, nextLine };
})();
