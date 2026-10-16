// Smith-counter town investment and custom weapon crafting UI.
(function (global) {
  'use strict';
  let deps = null; // Existing smith inventory, gear, and save adapters.
  let selection = { shaft: '', head: '', metal: '' }; // Current builder choices; revalidated against live unlocks each render.
  let previewSerial = 0; // Prevents stale async previews replacing a more recent selection.
  const woodKeys = ['pineLog', 'shadewoodLog']; // Same pooled wood accepted by the town mine investments.
  const count = key => Math.max(0, Number.isFinite(Number(deps?.inventory[key])) ? Number(deps.inventory[key]) : 0); // Missing and malformed stacks never buy anything.
  const woodCount = () => woodKeys.reduce((sum, key) => sum + count(key), 0); // Purchase-time resource total.

  function choices() { return global.ModularWeapons.unlockedParts(deps.UNLOCKED_TOOL_SHAPES, deps.getGearInventory(), deps.TOOL_ITEM_DEFS); }
  function craft(shaft, head, metal) {
    const available = choices(); // Unlocks are checked again rather than trusting select elements.
    const cost = global.ModularWeapons.getConfig().craftCost; // Central foundry labor/material tuning.
    const key = global.ModularWeapons.itemKey(shaft, head, metal); // Ordinary gear key, carrying the full recipe.
    const barKey = deps.metalBarItemKey(metal); // Existing metal-tier material.
    if (!global.TownMine?.hasImprovement('foundry') || !available.shafts.includes(shaft) || !available.heads.includes(head)
      || !deps.VERDIGRIS_METAL_KEYS.includes(metal) || !deps.TOOL_ITEM_DEFS[key]) return { ok: false, message: 'Unlock the foundry and both parts first.' };
    if (global.ModularWeapons.isDisallowed(shaft, head)) return { ok: false, message: 'That head is disallowed on this shaft.' };
    const gear = deps.getGearInventory(); // Gear ownership persists through the ordinary equipment save.
    if (gear?.tools?.[key]) return { ok: false, message: 'You already own this combination in that metal.' };
    if (count('gold') < cost.gold || count(barKey) < cost.bars || woodCount() < cost.wood) return { ok: false, message: 'Not enough bronze, metal bars, or wood.' };
    deps.inventory.gold -= cost.gold;
    deps.inventory[barKey] -= cost.bars;
    let remaining = cost.wood; // Spend pooled logs deterministically without producing negative/missing stacks.
    for (const wood of woodKeys) {
      const take = Math.min(remaining, count(wood)); // Amount taken from this wood species.
      deps.inventory[wood] = count(wood) - take;
      remaining -= take;
      deps.clampInventoryStack(wood);
    }
    deps.clampInventoryStack(barKey);
    if (!gear.tools) gear.tools = {};
    gear.tools[key] = true;
    deps.saveGearInventory();
    deps.buildInventoryGrid();
    deps.buildEquipmentSlots();
    deps.saveMemberWorldData();
    return { ok: true, message: `Forged ${deps.TOOL_ITEM_DEFS[key].label}!`, itemKey: key };
  }
  function element(tag, text, className = '') {
    const node = document.createElement(tag); // Small DOM helper; text never interpolates imported authoring data as HTML.
    node.textContent = text; node.className = className;
    return node;
  }
  function select(label, values, labels, value, changed) {
    const wrapper = element('label', label + ' '); // Native inputs support mobile and existing controller menu navigation.
    const input = document.createElement('select'); // Filtered unlocked catalog.
    input.setAttribute('aria-label', label);
    for (const key of values) {
      const option = element('option', labels(key)); // Option labels come from the same authoring manifest.
      option.value = key; input.appendChild(option);
    }
    input.value = value;
    input.onchange = () => { changed(input.value); deps.rerender(); };
    wrapper.appendChild(input);
    return wrapper;
  }
  function render(list) {
    if (!deps || !global.TownMine || !global.ModularWeapons) return;
    const status = global.TownMine.improvementStatus('foundry'); // Same authority owns durable investment state and costs.
    if (!status) return;
    const section = element('section', '', 'foundry-section'); // Live investment/builder panel inside the smith menu.
    section.style.cssText = 'padding:12px;border:1px solid #479c89;border-radius:8px;margin-bottom:12px;display:grid;gap:10px';
    list.appendChild(section);
    section.appendChild(element('h3', status.built ? '⚒️ Foundry — Custom Weapons' : 'Town Improvement — Foundry'));
    if (!status.built) {
      section.appendChild(element('p', "Read Kzubug's foundry proposal in the pile of letters on Father Hunundi's desk."));
      return;
    }
    const config = global.ModularWeapons.getConfig(), available = choices(); // Current manifest plus live smith unlocks.
    if (!available.heads.length || !available.shafts.length) {
      section.appendChild(element('p', 'Unlock a weapon with a modular shaft and a head to begin.'));
      return;
    }
    if (!available.shafts.includes(selection.shaft)) selection.shaft = available.shafts[0];
    const allowedHeads = available.heads.filter(head => !global.ModularWeapons.isDisallowed(selection.shaft, head)); // Shared pair restrictions apply to the menu and purchase validation.
    if (!allowedHeads.includes(selection.head)) selection.head = allowedHeads[0] || '';
    if (!deps.VERDIGRIS_METAL_KEYS.includes(selection.metal)) selection.metal = deps.VERDIGRIS_METAL_KEYS[0];
    section.appendChild(select('Shaft', available.shafts, key => config.shafts[key].label, selection.shaft, value => { selection.shaft = value; }));
    if (!allowedHeads.length) { section.appendChild(element('p', 'No unlocked heads are allowed on this shaft. Choose another shaft.')); return; }
    section.appendChild(select('Head', allowedHeads, key => `${config.heads[key].label} (${config.heads[key].dmgType})`, selection.head, value => { selection.head = value; }));
    section.appendChild(select('Metal', deps.VERDIGRIS_METAL_KEYS, key => deps.METAL_DEFS[key].label, selection.metal, value => { selection.metal = value; }));
    const image = document.createElement('img'); // Cached composition uses exactly the runtime sprite; metal uses the existing recolorer.
    const serial = ++previewSerial; // Ignore older selections resolving after the current one.
    image.alt = 'Custom weapon preview'; image.style.cssText = 'height:220px;width:100px;object-fit:contain;justify-self:center';
    section.appendChild(image);
    const item = global.ModularWeapons.itemKey(selection.shaft, selection.head, selection.metal); // Preview and purchase refer to the same saved key.
    global.ToolMetalRecolor.getRecoloredCanvas(item, { targetHex: deps.METAL_DEFS[selection.metal].hex }).then(canvas => {
      if (serial === previewSerial && image.isConnected) image.src = canvas.toDataURL('image/png');
    }).catch(error => { if (image.isConnected) { image.alt = error.message; deps.showToast(error.message, false); } });
    const donor = config.shafts[selection.shaft].sourceShape; // Explain the donor rules before spending resources.
    const handMode = global.HobunjiHandToolGrips?.weaponHandModeForTool?.(donor) || 'two-hand'; // Shared runtime handedness.
    section.appendChild(element('p', `${handMode} · ${config.heads[selection.head].dmgType} · Attacks: ${deps.TOOL_ITEM_DEFS[item].animStyle} · Grip, scale and idle stance follow ${config.shafts[selection.shaft].label}.`));
    const cost = config.craftCost; // Authored new-weapon cost.
    const owned = !!deps.getGearInventory()?.tools?.[item]; // One owned weapon per part/material combination, matching normal smithing.
    const button = element('button', owned ? 'Already forged' : `Forge — ${cost.gold} bronze + ${cost.bars} bars + ${cost.wood} wood`, 'shop-buy-btn'); // Final purchase action.
    button.type = 'button'; button.disabled = owned || count('gold') < cost.gold || count(deps.metalBarItemKey(selection.metal)) < cost.bars || woodCount() < cost.wood;
    button.onclick = () => { const result = craft(selection.shaft, selection.head, selection.metal); deps.showToast(result.message, result.ok); deps.rerender(); };
    section.appendChild(button);
    const debug = element('details', ''); // Console-free mobile diagnostics, opened only on demand.
    debug.appendChild(element('summary', 'Weapon assembly diagnostics'));
    debug.appendChild(element('pre', JSON.stringify({ ...global.ModularWeapons.diagnostics(item), handMode, settings: global.ModularWeapons.settings(selection.shaft, selection.head) }, null, 2)));
    section.appendChild(debug);
  }
  global.FoundryShop = { init: value => { deps = value; }, render, craft, choices };
})(window);
