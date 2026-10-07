/** HUD, inventory, skill panels, character select, dialogue */
const UI = (() => {
  const els = {};
  let selectedClass = null;
  let activeNpc = null;

  function init() {
    [
      'hud', 'hp-bar', 'hp-text', 'xp-bar', 'xp-text', 'level-text', 'gold-text', 'floor-text',
      'class-text', 'eq-weapon', 'eq-armor', 'eq-ring', 'msg-log', 'quest-tip',
      'title-screen', 'select-screen', 'pause-screen', 'death-screen', 'death-msg',
      'inv-panel', 'inv-stats', 'inv-equipped', 'inv-grid',
      'skill-panel', 'skill-tree', 'sp-text',
      'btn-choose', 'btn-continue', 'continue-summary', 'btn-start', 'btn-back-title',
      'btn-resume', 'btn-save', 'btn-restart',
      'btn-retry-floor', 'btn-full-restart',
      'btn-inv', 'btn-skills', 'btn-pause',
      'class-cards', 'dialogue-box', 'dlg-name', 'dlg-text', 'dlg-next',
    ].forEach(id => { els[id] = document.getElementById(id); });

    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.close).classList.add('hidden');
      });
    });

    renderClassCards();
    els['dlg-next'].addEventListener('click', advanceDialogue);
  }

  function show(id) { els[id]?.classList.remove('hidden'); }
  function hide(id) { els[id]?.classList.add('hidden'); }
  function isVisible(id) { return els[id] && !els[id].classList.contains('hidden'); }

  function log(text, cls = '') {
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    els['msg-log'].appendChild(div);
    while (els['msg-log'].children.length > 6) els['msg-log'].firstChild.remove();
    setTimeout(() => div.remove(), 3600);
  }

  function setQuestTip(text, player) {
    if (!text) {
      hide('quest-tip');
      els['quest-tip'].textContent = '';
      if (player) player.questTip = '';
      return;
    }
    els['quest-tip'].textContent = 'Quest: ' + text;
    show('quest-tip');
    if (player) player.questTip = text;
  }

  function drawClassIcon(canvas, classId) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cls = Classes.get(classId);
    const c = cls.colors;
    ctx.save();
    ctx.translate(w / 2, h / 2 + 6);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(0, 14, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    // cape
    ctx.fillStyle = c.cape;
    ctx.beginPath();
    ctx.moveTo(-10, -2); ctx.quadraticCurveTo(-16, 10, -8, 18);
    ctx.lineTo(8, 18); ctx.quadraticCurveTo(16, 10, 10, -2); ctx.fill();
    // torso
    ctx.fillStyle = c.armor;
    ctx.fillRect(-9, -6, 18, 16);
    // pauldrons
    ctx.fillStyle = c.accent;
    ctx.fillRect(-12, -6, 5, 6);
    ctx.fillRect(7, -6, 5, 6);
    // head
    ctx.fillStyle = c.skin;
    ctx.beginPath(); ctx.arc(0, -12, 7, 0, Math.PI * 2); ctx.fill();
    if (classId === 'warrior') {
      ctx.fillStyle = '#808890';
      ctx.fillRect(-8, -18, 16, 5);
      ctx.fillStyle = c.accent;
      ctx.fillRect(-2, -22, 4, 5);
      ctx.fillStyle = c.weapon;
      ctx.fillRect(10, -8, 3, 20);
      ctx.fillRect(8, -10, 7, 4);
    } else if (classId === 'rogue') {
      ctx.fillStyle = '#1a2820';
      ctx.beginPath(); ctx.arc(0, -12, 8, Math.PI, 0); ctx.fill();
      ctx.fillStyle = c.weapon;
      ctx.save(); ctx.translate(-10, 0); ctx.rotate(-0.4); ctx.fillRect(0, 0, 14, 2.5); ctx.restore();
      ctx.save(); ctx.translate(10, 0); ctx.rotate(0.4); ctx.fillRect(-14, 0, 14, 2.5); ctx.restore();
    } else {
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.moveTo(-4, -18); ctx.lineTo(0, -24); ctx.lineTo(4, -18); ctx.fill();
      ctx.fillStyle = c.weapon;
      ctx.fillRect(-1.5, -4, 3, 22);
      ctx.beginPath(); ctx.arc(0, -8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,160,255,0.5)';
      ctx.beginPath(); ctx.arc(0, -8, 8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function renderClassCards() {
    const tags = {
      warrior: 'Melee · Tanky · Cleave',
      rogue: 'Melee · Fast · High crit swing',
      sorcerer: 'Ranged · Magic bolts',
    };
    els['class-cards'].innerHTML = Classes.LIST.map(cls => {
      const b = cls.base;
      return `<div class="class-card" data-class="${cls.id}">
        <div class="class-preview"><canvas width="72" height="56" data-icon="${cls.id}"></canvas></div>
        <h3>${cls.name}</h3>
        <div class="tag">${tags[cls.id]}</div>
        <div class="blurb">${cls.blurb}</div>
        <div class="stats">
          Life <b>${b.life}</b> · Dmg <b>${b.dmg}</b> · Armor <b>${b.armor}</b><br>
          AtkSpd <b>${b.aspd}/s</b> · Move <b>${b.move}</b><br>
          <i style="color:#706050">${cls.lore}</i>
        </div>
      </div>`;
    }).join('');

    els['class-cards'].querySelectorAll('.class-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedClass = card.dataset.class;
        els['class-cards'].querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        els['btn-start'].disabled = false;
      });
    });
    // paint mini icons
    requestAnimationFrame(() => {
      els['class-cards'].querySelectorAll('canvas[data-icon]').forEach(cv => {
        drawClassIcon(cv, cv.dataset.icon);
      });
    });
  }

  function getSelectedClass() { return selectedClass; }

  function openDialogue(npc) {
    activeNpc = npc;
    els['dlg-name'].textContent = npc.name;
    const line = Npc.nextLine(npc);
    if (!line) {
      els['dlg-text'].textContent = '...';
      hide('dialogue-box');
      activeNpc = null;
      return false;
    }
    els['dlg-text'].textContent = line;
    show('dialogue-box');
    if (npc.questTip) setQuestTip(npc.questTip);
    return true;
  }

  function advanceDialogue() {
    if (!activeNpc) { hide('dialogue-box'); return false; }
    const line = Npc.nextLine(activeNpc);
    if (!line) {
      hide('dialogue-box');
      activeNpc = null;
      return false;
    }
    els['dlg-text'].textContent = line;
    return true;
  }

  function isDialogueOpen() { return isVisible('dialogue-box'); }

  function updateHud(game) {
    const p = game.player;
    if (!p) return;
    const st = Entities.playerStats(p);
    const hpPct = Utils.clamp(p.life / p.maxLife, 0, 1) * 100;
    const xpPct = Utils.clamp(p.xp / p.xpToLevel, 0, 1) * 100;
    els['hp-bar'].style.width = hpPct + '%';
    els['hp-text'].textContent = `${Math.ceil(p.life)}/${p.maxLife}`;
    els['xp-bar'].style.width = xpPct + '%';
    els['xp-text'].textContent = `XP ${p.xp}/${p.xpToLevel}`;
    els['level-text'].textContent = `Lv ${p.level}`;
    els['gold-text'].textContent = `Gold ${p.gold}`;
    els['floor-text'].textContent = `Floor ${game.floor}`;
    const cls = Classes.get(p.classId);
    els['class-text'].textContent = cls.name;

    const w = p.equipped.weapon;
    const a = p.equipped.armor;
    const r = p.equipped.ring;
    els['eq-weapon'].textContent = w ? `Wpn ${w.name}` : 'Wpn —';
    els['eq-armor'].textContent = a ? `Arm ${a.name}` : 'Arm —';
    els['eq-ring'].textContent = r ? `Ring ${r.name}` : 'Ring —';
    els['eq-weapon'].style.color = w ? Loot.RARITY[w.rarity].color : '';
    els['eq-armor'].style.color = a ? Loot.RARITY[a.rarity].color : '';
    els['eq-ring'].style.color = r ? Loot.RARITY[r.rarity].color : '';
  }

  function renderInventory(game) {
    const p = game.player;
    const st = Entities.playerStats(p);
    els['inv-stats'].innerHTML =
      `Class <b>${Classes.get(p.classId).name}</b><br>` +
      `DMG <b>${st.dmg}</b> · Armor <b>${st.armor}</b> · Life <b>${st.maxLife}</b><br>` +
      `AtkSpd <b>${st.aspd.toFixed(2)}/s</b> · Move <b>${st.move.toFixed(1)}</b> · Range <b>${st.range.toFixed(1)}</b>` +
      (st.cleave ? ` · Cleave <b>${st.cleave.toFixed(1)}</b>` : '') +
      (st.lifesteal ? ` · LS <b>${Math.round(st.lifesteal * 100)}%</b>` : '');

    const slots = ['weapon', 'armor', 'ring'];
    els['inv-equipped'].innerHTML = slots.map(slot => {
      const it = p.equipped[slot];
      if (!it) return `<div class="equip-slot" data-unequip="${slot}"><span class="slot-label">${slot}</span><span>empty</span></div>`;
      return `<div class="equip-slot" data-unequip="${slot}">
        <span class="slot-label">${slot}</span>
        <span class="rarity-${it.rarity}">${it.icon} ${it.name}</span>
      </div>`;
    }).join('');

    els['inv-grid'].innerHTML = p.inventory.length === 0
      ? '<div class="hint">No items — kill demons for loot.</div>'
      : p.inventory.map((it, i) =>
          `<div class="item-row" data-inv="${i}">
            <span class="rarity-${it.rarity}">${it.icon} ${it.name}</span>
            <span style="color:#807060;font-size:11px">${Loot.itemStatsText(it)}</span>
          </div>`
        ).join('');

    els['inv-equipped'].querySelectorAll('[data-unequip]').forEach(el => {
      el.addEventListener('click', () => {
        const slot = el.dataset.unequip;
        if (p.equipped[slot]) {
          p.inventory.push(p.equipped[slot]);
          p.equipped[slot] = null;
          Entities.syncLife(p);
          renderInventory(game);
          updateHud(game);
        }
      });
    });
    els['inv-grid'].querySelectorAll('[data-inv]').forEach(el => {
      el.addEventListener('click', () => {
        const i = +el.dataset.inv;
        const it = p.inventory[i];
        if (!it) return;
        const prev = p.equipped[it.slot];
        p.equipped[it.slot] = it;
        p.inventory.splice(i, 1);
        if (prev) p.inventory.push(prev);
        const st2 = Entities.playerStats(p);
        p.maxLife = st2.maxLife;
        if (p.life > p.maxLife) p.life = p.maxLife;
        renderInventory(game);
        updateHud(game);
        log(`Equipped ${it.name}`, it.rarity);
      });
    });
  }

  function renderSkills(game) {
    const p = game.player;
    els['sp-text'].textContent = `Skill Points: ${p.skills.points}`;
    els['skill-tree'].innerHTML = Skills.NODES.map(node => {
      const rank = p.skills.ranks[node.id];
      const can = Skills.canUnlock(p.skills, node.id);
      let cls = 'skill-node';
      if (rank >= node.max) cls += ' maxed';
      else if (rank > 0) cls += ' unlocked';
      else if (!can) cls += ' locked';
      return `<div class="${cls}" data-skill="${node.id}">
        <div class="skill-icon">${node.icon}</div>
        <div class="skill-info">
          <div class="name">${node.name}</div>
          <div class="desc">${node.desc}${node.prereq ? ' · req: ' + node.prereq : ''}</div>
        </div>
        <div class="skill-rank">${rank}/${node.max}</div>
      </div>`;
    }).join('');

    els['skill-tree'].querySelectorAll('[data-skill]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.skill;
        if (Skills.spend(p.skills, id)) {
          Entities.syncLife(p);
          const st = Entities.playerStats(p);
          p.maxLife = st.maxLife;
          if (p.life > p.maxLife) p.life = p.maxLife;
          renderSkills(game);
          updateHud(game);
          log(`Learned ${Skills.NODES.find(n => n.id === id).name}`, 'level');
        }
      });
    });
  }

  function togglePanel(game, which) {
    const other = which === 'inv-panel' ? 'skill-panel' : 'inv-panel';
    hide(other);
    if (isVisible(which)) hide(which);
    else {
      show(which);
      if (which === 'inv-panel') renderInventory(game);
      else renderSkills(game);
    }
  }

  function refreshContinue() {
    const sum = Save.summary();
    const btn = els['btn-continue'];
    const line = els['continue-summary'];
    if (!btn || !line) return;
    if (!sum) {
      btn.classList.add('hidden');
      line.classList.add('hidden');
      line.textContent = '';
      return;
    }
    btn.classList.remove('hidden');
    line.classList.remove('hidden');
    line.textContent = `${sum.className} · Lv ${sum.level} · Floor ${sum.floor} · ${sum.gold} gold`;
  }

  return {
    init, els, show, hide, isVisible, log, updateHud,
    renderInventory, renderSkills, togglePanel,
    getSelectedClass, setQuestTip, openDialogue, advanceDialogue, isDialogueOpen,
    refreshContinue,
  };
})();
