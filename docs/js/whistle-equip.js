(() => {
  'use strict';

  // Inventory tab's whistle-equip row (Gear section). Extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern
  // as its sibling systems.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function equipWhistle(whistleId) {
    deps.setEquipmentSlot('whistle', whistleId);
    buildWhistleEquipUI();
  }

  function unequipWhistle() {
    deps.setEquipmentSlot('whistle', null);
    buildWhistleEquipUI();
  }

  function buildWhistleEquipUI() {
    const sec = document.getElementById('invWhistleSection');
    if (!sec) return;
    sec.innerHTML = '';
    const whistles = deps.getGearInventory()?.whistles || [];
    if (!whistles.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-gear-extra-empty';
      empty.textContent = 'No whistles in gear.';
      sec.appendChild(empty);
      return;
    }
    const row = document.createElement('div');
    row.className = 'inv-equip-row';
    for (const whistle of whistles) {
      const def = deps.CREATURE_DB[whistle.creatureKey];
      const equipped = deps.equipmentSlots.whistle === whistle.id;
      const cell = document.createElement('div');
      cell.className = 'inv-equip-slot occupied' + (equipped ? ' active-slot' : '');
      cell.setAttribute('title', `${whistle.name} (${def?.label || whistle.creatureKey})` + (equipped ? ' — equipped' : ' — click to equip'));
      if (def?.sprites?.idle) {
        const img = document.createElement('img');
        img.src = def.sprites.idle; img.className = 'ies-sprite'; img.alt = whistle.name;
        cell.appendChild(img);
      }
      if (equipped) {
        const unBtn = document.createElement('button');
        unBtn.className = 'ies-unequip'; unBtn.textContent = '✕'; unBtn.title = 'Unequip ' + whistle.name;
        unBtn.addEventListener('click', (e) => { e.stopPropagation(); unequipWhistle(); });
        cell.appendChild(unBtn);
      }
      const lbl = document.createElement('span');
      lbl.className = 'ies-label';
      lbl.textContent = whistle.name;
      cell.appendChild(lbl);
      cell.addEventListener('click', () => equipWhistle(whistle.id));
      row.appendChild(cell);
    }
    sec.appendChild(row);
  }

  window.WhistleEquip = { init, build: buildWhistleEquipUI };
})();
