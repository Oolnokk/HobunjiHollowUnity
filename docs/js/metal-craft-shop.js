(() => {
  'use strict';

  // Sloomi/Kzubug's smithing counter: craft a new verdigris tool from
  // dug-up metal bars, then plate, clear plating, or reinforce any owned
  // crafted tool. Both smiths offer this identical service — see the
  // 'openCraftMenu' dialogue action and each NPC's dialogueTrees entry
  // (game.js). Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as its sibling shop modules.
  // The tool-mastery/metal system itself (METAL_DEFS, TOOL_ITEM_DEFS,
  // toolPlating/toolReinforcementMetal/etc.) stays in game.js — it's
  // foundational, read by combat/crafting too, not owned by this shop —
  // and comes in through deps. gearInventory is threaded as a getter
  // since character load/logout reassigns it wholesale.
  let deps = null;
  let hourlyRefreshTimer = 0;
  let lastObservedClockKey = null;

  function init(injectedDeps) {
    deps = injectedDeps;
    // Character/world reloads can reinitialize this module without replacing
    // the page. Reset the observed key so the new runtime gets one immediate
    // texture refresh even if it happens to load at the same clock hour.
    lastObservedClockKey = null;
    installHourlyMetalRefresh();
  }

  let metalCraftActiveShape = null; // set from deps.UNLOCKED_TOOL_SHAPES[0] on first render
  const CRAFT_BAR_COST    = 3;  // bars of the chosen metal, for a new tool or a reinforcement
  const CRAFT_LABOR_GOLD  = 15; // gold labor fee, same for crafting new or reinforcing
  const PLATE_BAR_COST    = 1;  // bars of the plating metal (cosmetic or resistant)
  const PLATE_LABOR_GOLD  = 8;
  const HOURLY_REFRESH_POLL_MS = 250; // Cheap clock-edge watcher; actual texture work happens only when the represented hour changes.

  function verdigrisDebugEnabled() {
    if (window.ToolMetalRecolorDebug === true) return true;
    try { return window.localStorage?.getItem('toolMetalRecolorDebug') === '1'; }
    catch { return false; }
  }

  function bridgeDebug(label, data) {
    if (!verdigrisDebugEnabled()) return;
    const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
    window.__farmLog?.(`[MetalToolBridge] ${label}${suffix}`, 'info');
  }

  // game.js owns the actual world THREE.Texture objects, but injects its
  // refreshMetalToolWorldTexture adapter into this extracted module. Keeping
  // this fan-out here gives the Debug UI a narrow public hook that can force
  // every currently-owned crafted metal tool back through the real runtime
  // recolor path without reaching into game.js's private maps/sets.
  function refreshAllMetalToolWorldTextures(reason = 'manual') {
    if (!deps?.refreshMetalToolWorldTexture || !deps?.TOOL_ITEM_DEFS || !deps?.getGearInventory) {
      bridgeDebug('refresh pass unavailable', { reason, initialized: !!deps });
      return 0;
    }
    const gearInventory = deps.getGearInventory();
    const itemKeys = Object.keys(gearInventory?.tools || {})
      .filter(itemKey => gearInventory.tools[itemKey] && deps.TOOL_ITEM_DEFS[itemKey]?.metalKey);
    bridgeDebug('refresh pass', { reason, itemCount: itemKeys.length, itemKeys });
    itemKeys.forEach(itemKey => {
      bridgeDebug('world texture refresh requested', {
        reason,
        itemKey,
        label: deps.TOOL_ITEM_DEFS[itemKey]?.label || itemKey,
      });
      deps.refreshMetalToolWorldTexture(itemKey);
    });
    return itemKeys.length;
  }

  function currentGameHourKey() {
    // The global started flag prevents onboarding/title-screen polling from
    // manufacturing a fake refresh. CalendarSystem is the authoritative clock
    // formatter already used by the HUD/debug report.
    if (window.__hobunjiGameStarted !== true || !window.CalendarSystem?.getHour) return null;
    try {
      const hour = Math.floor(Number(window.CalendarSystem.getHour()));
      if (!Number.isFinite(hour)) return null;
      const rawDay = Number(window.CalendarSystem.timeDebugSnapshot?.().rawDay);
      return Number.isFinite(rawDay) ? `${rawDay}:${hour}` : `hour:${hour}`;
    } catch {
      return null;
    }
  }

  function pollHourlyMetalRefresh() {
    const clockKey = currentGameHourKey();
    if (!clockKey) return;

    if (lastObservedClockKey === null) {
      lastObservedClockKey = clockKey;
      // This is also the ordinary-load fix: once gameplay is actually live,
      // owned crafted tools are guaranteed one generated texture refresh even
      // if no equip/cycling action happens afterward.
      const refreshed = refreshAllMetalToolWorldTextures('runtime-start');
      bridgeDebug('runtime-start refresh', { clockKey, refreshed });
      return;
    }

    if (clockKey === lastObservedClockKey) return;
    const previousClockKey = lastObservedClockKey;
    lastObservedClockKey = clockKey;
    const refreshed = refreshAllMetalToolWorldTextures('game-hour');
    bridgeDebug('hourly refresh', { from: previousClockKey, to: clockKey, refreshed });
  }

  function installHourlyMetalRefresh() {
    if (hourlyRefreshTimer) return;
    hourlyRefreshTimer = window.setInterval(pollHourlyMetalRefresh, HOURLY_REFRESH_POLL_MS);
    // Usually game.js has not set __hobunjiGameStarted yet when init() runs,
    // but this makes reinitialization of an already-running world immediate.
    pollHourlyMetalRefresh();
  }

  function craftMetalTool(shapeKey, metalKey) {
    const barKey = deps.metalBarItemKey(metalKey);
    if ((deps.inventory[barKey] || 0) < CRAFT_BAR_COST) { deps.showToast(`Not enough ${deps.METAL_DEFS[metalKey].label} bars.`, false); return; }
    if ((deps.inventory.gold || 0) < CRAFT_LABOR_GOLD) { deps.showToast("Not enough gold for the smith's labor.", false); return; }
    deps.inventory[barKey] -= CRAFT_BAR_COST;
    deps.clampInventoryStack(barKey);
    deps.inventory.gold -= CRAFT_LABOR_GOLD;
    const itemKey = deps.craftedToolItemKey(shapeKey, metalKey);
    const gearInventory = deps.getGearInventory();
    if (!gearInventory.tools) gearInventory.tools = {};
    gearInventory.tools[itemKey] = true;
    deps.saveGearInventory();
    // A newly-created crafted tool must immediately replace its base sprite
    // world texture with the metal/mastery-generated canvas. Previously only
    // plating changes called this adapter, so a fresh tool could remain on
    // the untouched source PNG indefinitely.
    deps.refreshMetalToolWorldTexture(itemKey);
    deps.showToast(`Smithed a ${deps.TOOL_ITEM_DEFS[itemKey].label}!`, true);
    renderMetalCraftShopPage();
    deps.buildInventoryGrid();
    deps.buildEquipmentSlots();
    deps.saveMemberWorldData();
  }

  // choice: 'clear' | 'resistant' | 'cosmetic:<metalKey>' — see the
  // <select> built in renderMetalCraftShopPage.
  function applyMetalToolPlating(itemKey, choice) {
    const def = deps.TOOL_ITEM_DEFS[itemKey];
    const gearInventory = deps.getGearInventory();
    if (!gearInventory?.tools?.[itemKey] || !def?.metalKey) return;
    if (choice === 'clear') {
      const plating = deps.toolPlating(itemKey);
      if (!plating) { deps.showToast('No plating to clear.', false); return; }
      const refundMetal = plating.mode === 'cosmetic' ? plating.metalKey : def.metalKey;
      deps.inventory[deps.metalBarItemKey(refundMetal)] = Math.min(99, (deps.inventory[deps.metalBarItemKey(refundMetal)] || 0) + PLATE_BAR_COST);
      deps.clearToolPlating(itemKey);
      deps.showToast('Cleared plating — back to live verdigris, materials returned.', true);
    } else if (choice === 'resistant' || choice.startsWith('cosmetic:')) {
      const metalKey = choice === 'resistant' ? def.metalKey : choice.slice('cosmetic:'.length);
      const metal = deps.METAL_DEFS[metalKey];
      if (!metal) return;
      const barKey = deps.metalBarItemKey(metalKey);
      if ((deps.inventory[barKey] || 0) < PLATE_BAR_COST) { deps.showToast(`Not enough ${metal.label} bars.`, false); return; }
      if ((deps.inventory.gold || 0) < PLATE_LABOR_GOLD) { deps.showToast('Not enough gold.', false); return; }
      deps.inventory[barKey] -= PLATE_BAR_COST;
      deps.clampInventoryStack(barKey);
      deps.inventory.gold -= PLATE_LABOR_GOLD;
      deps.setToolPlating(itemKey, choice === 'resistant' ? 'resistant' : 'cosmetic', metalKey);
      deps.showToast(choice === 'resistant' ? 'Applied a verdigris-resistant coat.' : `Plated with ${metal.label}.`, true);
    } else {
      return;
    }
    deps.refreshMetalToolWorldTexture(itemKey);
    renderMetalCraftShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  // Same cost as smithing a whole new tool — see task spec. Keeps the
  // tool's own base-metal identity (itemKey never changes, so its
  // mastery/verdigris/plating all keep tracking exactly as before); only
  // its effective damage/efficacy borrows metalKey's tier (see
  // toolEffectiveMetalKey/toolMetalMultiplier, game.js).
  function reinforceMetalTool(itemKey, metalKey) {
    const def = deps.TOOL_ITEM_DEFS[itemKey];
    const metal = deps.METAL_DEFS[metalKey];
    if (!def?.metalKey || !metal) return;
    const currentTier = deps.METAL_DEFS[deps.toolEffectiveMetalKey(itemKey)]?.tier || 0;
    if (metal.tier <= currentTier) { deps.showToast("That metal isn't stronger than what this tool already fights with.", false); return; }
    const barKey = deps.metalBarItemKey(metalKey);
    if ((deps.inventory[barKey] || 0) < CRAFT_BAR_COST) { deps.showToast(`Not enough ${metal.label} bars.`, false); return; }
    if ((deps.inventory.gold || 0) < CRAFT_LABOR_GOLD) { deps.showToast("Not enough gold for the smith's labor.", false); return; }
    deps.inventory[barKey] -= CRAFT_BAR_COST;
    deps.clampInventoryStack(barKey);
    deps.inventory.gold -= CRAFT_LABOR_GOLD;
    deps.setToolReinforcement(itemKey, metalKey);
    deps.showToast(`${def.label} reinforced with ${metal.label}!`, true);
    renderMetalCraftShopPage();
    deps.saveMemberWorldData();
  }

  function renderMetalCraftShopPage() {
    if (metalCraftActiveShape === null) metalCraftActiveShape = deps.UNLOCKED_TOOL_SHAPES[0];
    const goldEl = document.getElementById('mcGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    const list = document.getElementById('metalCraftShopList');
    if (!list) return;
    list.innerHTML = '';
    const gearInventory = deps.getGearInventory();

    const craftHdr = document.createElement('div');
    craftHdr.className = 'shop-section-label';
    craftHdr.textContent = `🔨 Craft a New Tool  (${CRAFT_BAR_COST} bars + ${CRAFT_LABOR_GOLD}g)`;
    list.appendChild(craftHdr);

    const shapeTabs = document.createElement('div');
    shapeTabs.className = 'supply-tabs';
    deps.UNLOCKED_TOOL_SHAPES.forEach(shapeKey => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'supply-tab' + (shapeKey === metalCraftActiveShape ? ' active' : '');
      btn.textContent = deps.TOOL_SHAPE_DEFS[shapeKey].label;
      btn.onclick = () => { metalCraftActiveShape = shapeKey; renderMetalCraftShopPage(); };
      shapeTabs.appendChild(btn);
    });
    list.appendChild(shapeTabs);

    deps.VERDIGRIS_METAL_KEYS.forEach(metalKey => {
      const metal = deps.METAL_DEFS[metalKey];
      const owned = deps.inventory[deps.metalBarItemKey(metalKey)] || 0;
      const itemKey = deps.craftedToolItemKey(metalCraftActiveShape, metalKey);
      const alreadyOwned = !!gearInventory?.tools?.[itemKey];
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">🔶</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(metal.label)} ${deps.esc(deps.TOOL_SHAPE_DEFS[metalCraftActiveShape].label)} (tier ${metal.tier})</div>
          <div class="sh-desc">Bars owned: ${owned}${alreadyOwned ? ' — already smithed' : ''}</div>
          <div class="sh-price">${CRAFT_BAR_COST} bars + ${CRAFT_LABOR_GOLD}g</div>
        </div>
        <button class="shop-buy-btn" data-metal="${metalKey}" ${alreadyOwned ? 'disabled' : ''}>${alreadyOwned ? 'Owned' : 'Smith'}</button>
      `;
      row.querySelector('[data-metal]')?.addEventListener('click', () => craftMetalTool(metalCraftActiveShape, metalKey));
      list.appendChild(row);
    });

    const ownedCrafted = Object.keys(gearInventory?.tools || {}).filter(key => deps.TOOL_ITEM_DEFS[key]?.metalKey);
    if (ownedCrafted.length) {
      const plateHdr = document.createElement('div');
      plateHdr.className = 'shop-section-label';
      plateHdr.textContent = '✨ Plate, Clear, or Reinforce';
      list.appendChild(plateHdr);

      ownedCrafted.forEach(itemKey => {
        const def = deps.TOOL_ITEM_DEFS[itemKey];
        const verdigrisPct = Math.round(deps.toolVerdigrisFraction(itemKey) * 100);
        const plating = deps.toolPlating(itemKey);
        const effectiveMetal = deps.toolEffectiveMetalKey(itemKey);
        const reinforced = deps.toolReinforcementMetal(itemKey);
        const platingText = plating
          ? (plating.mode === 'cosmetic' ? `Plated: ${deps.METAL_DEFS[plating.metalKey]?.label}` : 'Verdigris-resistant coat')
          : `Live verdigris: ${verdigrisPct}%`;
        const plateOptions = [
          `<option value="clear">— live verdigris (clear plating) —</option>`,
          `<option value="resistant">Verdigris-resistant coat (${deps.esc(deps.METAL_DEFS[def.metalKey].label)})</option>`,
          // Cosmetic plating is specifically a non-verdigris metal's clean
          // color (see spec) — a verdigris metal already shows its own
          // live oxidation, so "resistant" (above) is the same-metal
          // option instead.
          ...Object.keys(deps.METAL_DEFS).filter(k => deps.METAL_DEFS[k].tier == null && (deps.inventory[deps.metalBarItemKey(k)] || 0) > 0)
            .map(k => `<option value="cosmetic:${k}">Cosmetic: ${deps.esc(deps.METAL_DEFS[k].label)}</option>`),
        ].join('');
        const reinforceOptions = deps.VERDIGRIS_METAL_KEYS
          .filter(k => deps.METAL_DEFS[k].tier > (deps.METAL_DEFS[effectiveMetal]?.tier || 0) && (deps.inventory[deps.metalBarItemKey(k)] || 0) >= CRAFT_BAR_COST)
          .map(k => `<option value="${k}">${deps.esc(deps.METAL_DEFS[k].label)} (tier ${deps.METAL_DEFS[k].tier})</option>`).join('');
        const row = document.createElement('div');
        row.className = 'shop-row mc-tool-row';
        row.innerHTML = `
          <div class="sh-icon">${def.icon}</div>
          <div class="sh-info">
            <div class="sh-name">${deps.esc(def.label)}${reinforced ? ' (reinforced: ' + deps.esc(deps.METAL_DEFS[reinforced].label) + ')' : ''}</div>
            <div class="sh-desc">${deps.esc(platingText)} — Mastery ${deps.toolMasteryLevel(itemKey)}/5</div>
            <div class="mc-tool-controls">
              <select class="mc-plate-select">${plateOptions}</select>
              <button class="shop-buy-btn mc-plate-btn">Apply</button>
            </div>
            ${reinforceOptions ? `<div class="mc-tool-controls">
              <select class="mc-reinforce-select">${reinforceOptions}</select>
              <button class="shop-buy-btn mc-reinforce-btn">Reinforce (${CRAFT_BAR_COST} bars + ${CRAFT_LABOR_GOLD}g)</button>
            </div>` : ''}
          </div>
        `;
        row.querySelector('.mc-plate-btn')?.addEventListener('click', () => {
          applyMetalToolPlating(itemKey, row.querySelector('.mc-plate-select').value);
        });
        row.querySelector('.mc-reinforce-btn')?.addEventListener('click', () => {
          const sel = row.querySelector('.mc-reinforce-select');
          if (sel) reinforceMetalTool(itemKey, sel.value);
        });
        list.appendChild(row);
      });
    }
  }

  window.MetalCraftShop = {
    init,
    render: renderMetalCraftShopPage,
    refreshAllMetalToolWorldTextures,
  };
})();
