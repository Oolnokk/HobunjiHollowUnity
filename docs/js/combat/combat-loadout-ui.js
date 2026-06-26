// Combat loadout UI — lets the player view and swap which ability occupies
// each of the weapon tool's 4 slots (tap1/tap2/hold1/hold2), from a new
// "Loadout" tab in the existing menu panel (index.html's #mpLoadout /
// #combatLoadoutPane, added alongside the tab button in the same commit).
// Pure DOM wiring against window.Combat's existing public API — no game.js
// changes needed, since the panel already lives inside #menuPanel and is
// covered by the menu's existing input-blocking (menuOpen/paused).
(() => {
  "use strict";
  if (!window.Combat?.loadout) { console.error('combat-loadout-ui.js requires combat-core.js + combat-loadout.js to load first'); return; }

  const SLOTS = [
    { id: 'tap1', name: 'Tool Action 1 — Tap', desc: 'Left click (desktop) tapped quickly. Choose which quick technique fires.' },
    { id: 'tap2', name: 'Tool Action 2 — Tap', desc: 'Right click (desktop) tapped quickly. Choose which quick technique fires.' },
    { id: 'hold1', name: 'Tool Action 1 — Hold', desc: 'Left click held past a beat. Choose which defensive stance activates.' },
    { id: 'hold2', name: 'Tool Action 2 — Hold', desc: 'Right click held past a beat. Choose which power technique activates.' },
  ];

  const SELECT_STYLE = 'font-size:12px;padding:5px 8px;background:rgba(255,255,255,.06);border:1px solid var(--border-bright);border-radius:6px;color:var(--text);align-self:center';

  function render() {
    const pane = document.getElementById('combatLoadoutPane');
    if (!pane) return;
    pane.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'settings-section-title';
    title.textContent = 'Weapon Tool Loadout';
    pane.appendChild(title);

    for (const slot of SLOTS) {
      const row = document.createElement('label');
      row.className = 'settings-row';

      const label = document.createElement('div');
      label.className = 'settings-label';
      const name = document.createElement('div');
      name.className = 'settings-name';
      name.textContent = slot.name;
      const desc = document.createElement('div');
      desc.className = 'settings-desc';
      desc.textContent = slot.desc;
      label.appendChild(name);
      label.appendChild(desc);
      row.appendChild(label);

      const select = document.createElement('select');
      select.id = 'combatLoadout_' + slot.id;
      select.style.cssText = SELECT_STYLE;

      const family = window.Combat.loadout.SLOT_FAMILY[slot.id];
      const current = window.Combat.loadout.getSlot(slot.id);
      for (const ability of window.Combat.abilities.listForFamily(family)) {
        const opt = document.createElement('option');
        opt.value = ability.id;
        opt.textContent = ability.label;
        if (ability.id === current) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        window.Combat.loadout.setSlot(slot.id, select.value);
      });

      row.appendChild(select);
      pane.appendChild(row);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    const tab = document.querySelector('.mp-tab[data-mpanel="loadout"]');
    if (tab) tab.addEventListener('click', render);
  });
})();
