/** Floor vows: objectives, turn-ins, rewards. Does not touch combat numbers. */
const Quests = (() => {
  const DEFS = {
    silence: {
      id: 'silence',
      title: 'Silence the Stair',
      reward: '24 gold, 18 XP, Ashen Band',
      gold: 24,
      xp: 18,
      item: 'ashen-band',
    },
    embers: {
      id: 'embers',
      title: 'Last Light',
      reward: '16 gold, 22 XP, 1 skill point',
      gold: 16,
      xp: 22,
      skillPoint: 1,
    },
    oath: {
      id: 'oath',
      title: "The Hermit's Oath",
      reward: "30 gold, 20 XP, Hermit's Token",
      gold: 30,
      xp: 20,
      item: 'hermit-token',
    },
  };

  function empty() {
    return { active: {}, done: {} };
  }

  function ensure(p) {
    if (!p.quests || typeof p.quests !== 'object' || !p.quests.active || !p.quests.done) {
      p.quests = empty();
    }
    return p.quests;
  }

  function isComplete(p, id) {
    return ensure(p).done[id] === 'complete';
  }

  function isDone(p, id) {
    const d = ensure(p).done[id];
    return d === 'complete' || d === 'abandoned';
  }

  function get(p, id) {
    return ensure(p).active[id] || null;
  }

  function itemFor(key) {
    const id = 'q' + Math.random().toString(36).slice(2, 9);
    if (key === 'ashen-band') {
      return {
        id, slot: 'ring', name: 'Ashen Band', icon: '💍', rarity: 'magic',
        dmg: 0, armor: 0, life: 14, aspd: 0,
      };
    }
    if (key === 'hermit-token') {
      return {
        id, slot: 'ring', name: "Hermit's Token", icon: '💍', rarity: 'rare',
        dmg: 0, armor: 0, life: 18, aspd: 0,
      };
    }
    return null;
  }

  function rewardPayload(id) {
    const d = DEFS[id];
    return {
      id,
      name: d.title,
      gold: d.gold || 0,
      xp: d.xp || 0,
      skillPoint: d.skillPoint || 0,
      item: d.item ? itemFor(d.item) : null,
      summary: d.reward,
    };
  }

  function node(npc, text, actions, extra) {
    extra = extra || {};
    return {
      name: npc.name,
      text,
      actions: actions || [],
      reward: extra.reward || '',
      rewardKind: extra.rewardKind || (extra.reward ? 'preview' : ''),
      mark: extra.mark || '',
    };
  }

  function leave(label) {
    return [{ id: 'close', label: label || 'Leave' }];
  }

  function vowsOpen(p) {
    const out = [];
    if (!get(p, 'silence') && !isDone(p, 'silence')) out.push('silence');
    if (!get(p, 'embers') && !isDone(p, 'embers')) out.push('embers');
    return out;
  }

  function canOfferOath(p) {
    if (get(p, 'oath') || isDone(p, 'oath')) return false;
    return isComplete(p, 'silence') || isComplete(p, 'embers');
  }

  function readyIds(p, npcId, ctx) {
    const ids = [];
    const silence = get(p, 'silence');
    if (silence && silence.step === 'return' && (npcId === 'hermit' || npcId === 'knight')) ids.push('silence');
    const embers = get(p, 'embers');
    if (embers && embers.step === 'return' && (npcId === 'hermit' || npcId === 'knight')) ids.push('embers');
    const oath = get(p, 'oath');
    if (oath && npcId === 'knight' && ctx.floor >= 2) ids.push('oath');
    return ids;
  }

  function turnInNode(npc, id) {
    const d = DEFS[id];
    let text = {
      silence: 'I hear no claws. The stair is quieter for you. Take what you are owed.',
      embers: 'These coals still remember the wardens. You carried them back. That is the vow.',
      oath: 'He kept his oath, then. And so did you, walking it down to me.',
    }[id];
    if (npc.id === 'knight' && id !== 'oath') {
      text = 'The hermit is above, but I will witness this. You kept the vow.';
    }
    return node(npc, text, [{ id: 'turnin-' + id, label: 'Turn In' }], {
      reward: 'Reward: ' + d.reward,
      mark: '?',
    });
  }

  function offerButtons(p, ctx) {
    const npcId = ctx && ctx.npc && ctx.npc.id;
    const floor = (ctx && ctx.floor) || 1;
    const actions = [];
    const open = vowsOpen(p);
    if (floor <= 1 && npcId === 'hermit' && open.indexOf('silence') >= 0) {
      actions.push({ id: 'accept-silence', label: 'Hunt the demons' });
    }
    if (floor <= 1 && npcId === 'hermit' && open.indexOf('embers') >= 0) {
      actions.push({ id: 'accept-embers', label: 'Gather the embers' });
    }
    if (npcId === 'hermit' && canOfferOath(p)) {
      actions.push({ id: 'accept-oath', label: 'Carry word to the knight' });
    }
    return actions;
  }

  function offerNode(p, npc, ctx, lead) {
    const actions = offerButtons(p, Object.assign({}, ctx, { npc }));
    if (!actions.length) return null;
    const parts = [];
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.id === 'accept-silence') parts.push('Hunt: ' + DEFS.silence.reward);
      else if (a.id === 'accept-embers') parts.push('Embers: ' + DEFS.embers.reward);
      else if (a.id === 'accept-oath') parts.push('Oath: ' + DEFS.oath.reward);
    }
    return node(npc, lead || 'What vow will you keep?', actions, {
      reward: parts.join(' · '),
      mark: '!',
    });
  }

  function reminder(p, npc, id, ctx) {
    const q = get(p, id);
    const d = DEFS[id];
    let text = '';
    if (id === 'silence') {
      text = 'The stair is not quiet yet. Demons slain: ' + q.have + '/' + q.need + '. Come back when it is done.';
    } else if (id === 'embers') {
      text = 'Warden embers still burn on this floor. You hold ' + q.have + '/' + q.need + '. Look for the glowing coals.';
    } else if (ctx.floor >= 2) {
      text = 'Find the Wounded Knight and tell him I kept my oath.';
    } else {
      text = 'When the portal wakes, descend and tell the Wounded Knight I kept my oath.';
    }
    return node(npc, text, leave('I will'), {
      reward: 'Reward: ' + d.reward,
      mark: '',
    });
  }

  function firstMeeting(p) {
    return !get(p, 'silence') && !get(p, 'embers') && !get(p, 'oath')
      && !isComplete(p, 'silence') && !isComplete(p, 'embers');
  }

  function open(p, npc, ctx) {
    ensure(p);
    ctx = ctx || { floor: 1, living: 0 };
    if (!npc) return null;

    if (npc.id === 'whisper') {
      const lines = npc.lines && npc.lines.length ? npc.lines : ['Descend, little spark.'];
      const line = lines[(npc.lineIndex || 0) % lines.length];
      return node(npc, line, leave('Leave'), { mark: '' });
    }

    if (npc.id !== 'hermit' && npc.id !== 'knight') return null;

    const ready = readyIds(p, npc.id, ctx);
    if (ready.length) return turnInNode(npc, ready[0]);

    if (npc.id === 'hermit') {
      const silence = get(p, 'silence');
      if (silence && silence.step === 'hunt') return reminder(p, npc, 'silence', ctx);
      const embers = get(p, 'embers');
      if (embers && embers.step === 'gather') return reminder(p, npc, 'embers', ctx);

      let lead;
      if (firstMeeting(p)) {
        lead = 'Traveler… the Abyss drinks light. It was once a well of stars. I cannot walk this floor. You can. Choose a vow — when you return it, I will offer the other.';
      } else if (get(p, 'oath')) {
        lead = 'The knight still needs my word. Another vow on this floor is open.';
      } else if (isComplete(p, 'silence') || isComplete(p, 'embers')) {
        lead = 'One vow is kept. You may take another.';
      } else {
        lead = 'The dark is still listening. Speak a vow.';
      }
      const offer = offerNode(p, npc, ctx, lead);
      if (offer) return offer;
      const oath = get(p, 'oath');
      if (oath) return reminder(p, npc, 'oath', ctx);
      return node(npc, 'You have done more than the dark expected of a single stair. The portal will answer.', leave('Farewell'), { mark: '' });
    }

    return node(npc, 'I held the stair until the wraiths came. Cleanse what walks, then take the portal deeper.', leave('Leave'), { mark: '' });
  }

  function accept(p, id, ctx) {
    if (get(p, id) || isDone(p, id)) return false;
    if (id === 'oath' && !canOfferOath(p)) return false;
    let q = null;
    if (id === 'silence') {
      const living = Math.max(0, (ctx && ctx.living) || 0);
      q = { step: living <= 0 ? 'return' : 'hunt', need: living, have: 0 };
    } else if (id === 'embers') {
      q = { step: 'gather', need: 2, have: 0 };
    } else if (id === 'oath') {
      q = { step: 'deliver', need: 1, have: 0 };
    }
    if (!q) return false;
    ensure(p).active[id] = q;
    return true;
  }

  function followUp(p, npc, ctx, received) {
    const next = offerNode(p, npc, ctx, received + ' Another vow is open, if you want it.');
    if (next) return next;
    const oath = get(p, 'oath');
    if (oath && npc.id === 'hermit') {
      const n = reminder(p, npc, 'oath', ctx);
      n.text = received + ' ' + n.text;
      return n;
    }
    const bye = npc.id === 'knight'
      ? received + ' Hold the next stair if you go deeper. I will not.'
      : received + ' The portal answers the cleansed.';
    return node(npc, bye, leave('Farewell'), { mark: '' });
  }

  function act(p, actionId, ctx) {
    ensure(p);
    ctx = ctx || { floor: 1, living: 0 };
    const npc = (ctx && ctx.npc) || { id: 'hermit', name: 'Ashen Hermit', lines: [] };
    ctx = {
      floor: ctx.floor || 1,
      living: ctx.living || 0,
      npc,
    };

    if (!actionId || actionId === 'close') {
      if (npc.id === 'whisper' && npc.lines && npc.lines.length) {
        npc.lineIndex = ((npc.lineIndex || 0) + 1) % npc.lines.length;
      }
      return { node: null };
    }

    if (actionId === 'portal-stay') return { stay: true, node: null };

    if (actionId === 'portal-descend') {
      const abandoned = [];
      ['silence', 'embers'].forEach(id => {
        const q = get(p, id);
        if (q && q.step !== 'return') {
          delete p.quests.active[id];
          p.quests.done[id] = 'abandoned';
          abandoned.push(id);
        }
      });
      return { descend: true, node: null, abandon: abandoned };
    }

    if (actionId.indexOf('accept-') === 0) {
      const id = actionId.slice('accept-'.length);
      if (!DEFS[id] || !accept(p, id, ctx)) return { node: open(p, npc, ctx) };
      return {
        node: reminder(p, npc, id, ctx),
        toast: 'Vow accepted: ' + DEFS[id].title + '.',
        toastKind: 'story',
        spawnEmbers: id === 'embers',
      };
    }

    if (actionId.indexOf('turnin-') === 0) {
      const id = actionId.slice('turnin-'.length);
      if (readyIds(p, npc.id, ctx).indexOf(id) < 0) return { node: open(p, npc, ctx) };
      const q = get(p, id);
      if (!q) return { node: open(p, npc, ctx) };
      delete p.quests.active[id];
      p.quests.done[id] = 'complete';
      const granted = rewardPayload(id);
      return {
        node: followUp(p, npc, ctx, 'Received: ' + granted.summary + '.'),
        granted,
        toast: 'Quest complete: ' + granted.name + ' — ' + granted.summary + '.',
        toastKind: 'level',
      };
    }

    return { node: null };
  }

  function onKill(p, floor) {
    const q = get(p, 'silence');
    if (!q || q.step !== 'hunt' || Number(floor) !== 1) return '';
    q.have = Math.min(q.need, (q.have || 0) + 1);
    if (q.need <= 0 || q.have >= q.need) {
      q.step = 'return';
      return 'ready';
    }
    return 'progress';
  }

  function noteEmber(p) {
    const q = get(p, 'embers');
    if (!q || q.step !== 'gather') return '';
    q.have = Math.min(q.need, (q.have || 0) + 1);
    if (q.have >= q.need) {
      q.step = 'return';
      return 'ready';
    }
    return 'progress';
  }

  function onNewWave(p, floor, living) {
    const q = get(p, 'silence');
    if (!q || q.step !== 'hunt' || Number(floor) !== 1) return;
    q.have = 0;
    q.need = Math.max(0, living || 0);
    if (q.need <= 0) q.step = 'return';
  }

  function portalGate(p, floor) {
    ensure(p);
    if (Number(floor) !== 1) return null;
    const pending = [];
    const silence = get(p, 'silence');
    if (silence) pending.push(silence);
    const embers = get(p, 'embers');
    if (embers) pending.push(embers);
    if (!pending.length) return null;
    const unfinished = pending.some(q => q.step !== 'return');
    const text = unfinished
      ? 'The portal stirs, but a vow on this floor is still unfinished. Leave now, and that vow stays unfinished.'
      : 'A vow is ready to turn in. The hermit is still on this floor — or the knight below can witness it.';
    return {
      name: 'The Portal',
      text,
      reward: '',
      rewardKind: '',
      mark: '',
      actions: [
        { id: 'portal-stay', label: 'Stay and finish' },
        { id: 'portal-descend', label: 'Descend anyway' },
      ],
    };
  }

  function hud(p, ctx) {
    ensure(p);
    ctx = ctx || { floor: 1 };
    const floor = Number(ctx.floor) || 1;
    const rows = [];
    const push = (id, objective, short, priority) => {
      rows.push({
        title: DEFS[id].title,
        objective,
        reward: 'Reward: ' + DEFS[id].reward,
        short,
        priority,
      });
    };
    const silence = get(p, 'silence');
    if (silence) {
      if (silence.step === 'return') {
        const where = floor >= 2
          ? 'Turn in to the Wounded Knight. He will witness the vow.'
          : 'Return to the Ashen Hermit and turn in.';
        push('silence', where, 'ready to turn in', 0);
      } else {
        push('silence', 'Slay the demons on this floor (' + silence.have + '/' + silence.need + ').', silence.have + '/' + silence.need + ' slain', 1);
      }
    }
    const embers = get(p, 'embers');
    if (embers) {
      if (embers.step === 'return') {
        const where = floor >= 2
          ? 'Turn in to the Wounded Knight. He will witness the vow.'
          : 'Bring the embers to the Ashen Hermit.';
        push('embers', where, 'ready to turn in', 0);
      } else {
        push('embers', 'Gather warden embers (' + embers.have + '/' + embers.need + '). Look for the glowing coals.', embers.have + '/' + embers.need + ' embers', 1);
      }
    }
    const oath = get(p, 'oath');
    if (oath) {
      if (floor >= 2) push('oath', 'Speak with the Wounded Knight and turn in.', 'turn in to the knight', 0);
      else push('oath', 'Descend the portal and find the Wounded Knight.', 'deliver on Floor 2', 2);
    }
    if (!rows.length) return null;
    rows.sort((a, b) => a.priority - b.priority || 0);
    const top = rows[0];
    const also = rows[1];
    return {
      title: top.title,
      objective: top.objective,
      reward: top.reward,
      also: also ? ('Also: ' + also.title + ' — ' + also.short) : '',
    };
  }

  function marker(p, npc, ctx) {
    if (!p || !npc) return '';
    const n = open(p, npc, ctx);
    return (n && n.mark) || '';
  }

  function save(p) {
    const q = ensure(p);
    return JSON.parse(JSON.stringify({ active: q.active, done: q.done }));
  }

  function load(data) {
    const out = empty();
    if (!data || typeof data !== 'object') return out;
    const src = data.active || {};
    Object.keys(DEFS).forEach(id => {
      const q = src[id];
      if (!q || typeof q !== 'object') return;
      const step = q.step === 'return' || q.step === 'gather' || q.step === 'deliver' || q.step === 'hunt'
        ? q.step : 'hunt';
      out.active[id] = {
        step,
        need: Math.max(0, q.need | 0),
        have: Math.max(0, q.have | 0),
      };
    });
    const done = data.done || {};
    Object.keys(DEFS).forEach(id => {
      if (done[id] === 'complete' || done[id] === 'abandoned') out.done[id] = done[id];
    });
    return out;
  }

  return {
    DEFS, empty, ensure, get, isDone, isComplete,
    open, act, onKill, noteEmber, onNewWave, portalGate, hud, marker,
    save, load,
  };
})();
