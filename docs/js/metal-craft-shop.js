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
    window.MetalArmorSystem?.init?.({ ...injectedDeps, rerenderSmith: renderMetalCraftShopPage }); // Reuses the smith's inventory/save/avatar adapters without growing another game.js dependency bundle.
    window.FoundryShop?.init?.({ ...injectedDeps, rerender: renderMetalCraftShopPage });
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
    window.WeaponTrustVisits?.syncSmithingShapeUnlocks?.();
    if (!deps.UNLOCKED_TOOL_SHAPES.includes(shapeKey) || !deps.VERDIGRIS_METAL_KEYS.includes(metalKey)) { deps.showToast('Discover this weapon shape and choose a smithing metal first.', false); return; }
    const itemKey = deps.craftedToolItemKey(shapeKey, metalKey); // Reject repeated purchases before charging materials or changing an item's grade.
    if (deps.getGearInventory()?.tools?.[itemKey]) { deps.showToast('You already own this tool in that metal.', false); return; }
    const forgeBars = window.MetalReinforcement.forgeBarCost(CRAFT_BAR_COST, metalKey, deps.METAL_DEFS); // Higher-tier new tools cost more bars instead of bypassing the metal sink.
    const barKey = deps.metalBarItemKey(metalKey);
    if ((deps.inventory[barKey] || 0) < forgeBars) { deps.showToast(`Not enough ${deps.METAL_DEFS[metalKey].label} bars.`, false); return; }
    if ((deps.inventory.gold || 0) < CRAFT_LABOR_GOLD) { deps.showToast("Not enough gold for the smith's labor.", false); return; }
    deps.inventory[barKey] -= forgeBars;
    deps.clampInventoryStack(barKey);
    deps.inventory.gold -= CRAFT_LABOR_GOLD;
    const gearInventory = deps.getGearInventory();
    if (!gearInventory.tools) gearInventory.tools = {};
    gearInventory.tools[itemKey] = true;
    deps.setToolReinforcement(itemKey, metalKey, 0); // New forging starts at grade I; old saves without grades retain their original power.
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
      deps.inventory[deps.metalBarItemKey(refundMetal)] = Math.min(window.InventoryStacks.MAX_TOTAL, (deps.inventory[deps.metalBarItemKey(refundMetal)] || 0) + PLATE_BAR_COST);
      deps.clearToolPlating(itemKey);
      deps.showToast('Cleared plating/pattern — back to live verdigris, materials returned.', true);
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

  // Opens the (agnostic, reusable) pattern authoring modal against this
  // literal tool's own sprite, so the player can hand-draw which parts of a
  // fully-grown (mastery 5) weapon get stripped back to bare metal — see
  // toolVerdigrisPatternEligible/setToolVerdigrisPattern (game.js) and
  // pattern-authoring.js. Costs the same as any other plating service; a
  // player can reopen this at any time to redraw an already-authored
  // pattern (paying again, same as re-plating).
  // A per-tool "Custom" pattern's motif may live in MotifStore instead of
  // being embedded directly (see pattern-authoring.js's offloadMotif) —
  // resolve it back to a full motifDataUrl before handing the pattern to
  // the editor to redraw, since pattern-authoring.js itself stays agnostic
  // of any storage scheme beyond motifDataUrl. A no-op for a pattern that
  // already has one (or is null).
  async function resolvedForEditing(pattern) {
    if (!pattern || pattern.motifDataUrl || !pattern.customMotifId) return pattern;
    const motifDataUrl = await window.MotifStore?.loadMotif?.(pattern.customMotifId);
    return motifDataUrl ? { ...pattern, motifDataUrl } : pattern;
  }

  // The library shortcut and full editor share the same purchase and ownership checks.
  function applyVerdigrisPattern(itemKey, patternData, sourceLibraryId) {
    const def = deps.TOOL_ITEM_DEFS[itemKey]; // Resolve the live item again at commit time.
    if (!patternData || !def?.metalKey || !deps.getGearInventory()?.tools?.[itemKey] || !deps.toolVerdigrisPatternEligible(itemKey)) return false;
    const baseMetal = deps.METAL_DEFS[def.metalKey]; // Determines the existing plating material cost.
    const barKey = deps.metalBarItemKey(def.metalKey);
    if ((deps.inventory[barKey] || 0) < PLATE_BAR_COST) { deps.showToast(`Not enough ${baseMetal.label} bars.`, false); return false; }
    if ((deps.inventory.gold || 0) < PLATE_LABOR_GOLD) { deps.showToast('Not enough gold.', false); return false; }
    deps.inventory[barKey] -= PLATE_BAR_COST;
    deps.clampInventoryStack(barKey);
    deps.inventory.gold -= PLATE_LABOR_GOLD;
    deps.setToolVerdigrisPattern(itemKey, patternData, sourceLibraryId);
    deps.refreshMetalToolWorldTexture(itemKey);
    deps.showToast('Verdigris carefully stripped into a pattern.', true);
    renderMetalCraftShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
    return true;
  }

  function updateToolPatternPlacement(itemKey, pattern) {
    const active = deps.toolPlating(itemKey); // Read the latest authoritative plating, not a stale shop-row capture.
    if (!pattern || active?.mode !== 'pattern' || !deps.getGearInventory()?.tools?.[itemKey]) return false;
    const sourceId = active.patternLibraryId || active.pattern?.sourcePatternLibraryId || pattern.sourcePatternLibraryId; // Retain provenance separately from an unmodified-library reference.
    const snapshot = sourceId ? { ...pattern, sourcePatternLibraryId: sourceId } : { ...pattern };
    // game.js stores a reference INSTEAD of a snapshot when the third argument is non-null.
    // An edited frame must use a snapshot; this also makes the tool's existing icon cache key include the new placement.
    deps.setToolVerdigrisPattern(itemKey, snapshot, null);
    deps.refreshMetalToolWorldTexture(itemKey);
    deps.saveMemberWorldData();
    return true;
  }

  async function openVerdigrisPatternEditor(itemKey) {
    const def = deps.TOOL_ITEM_DEFS[itemKey];
    const baseMetal = deps.METAL_DEFS[def.metalKey];
    const existing = deps.toolPlating(itemKey);
    const initialPattern = await resolvedForEditing(existing?.mode === 'pattern' ? (existing.pattern || (existing.patternLibraryId ? window.PatternLibrary?.getById?.(existing.patternLibraryId) : null)) : null);

    window.PatternAuthoring?.openEditor({
      title: `Author verdigris removal — ${def.label}`,
      motifHint: 'Draw the motif to strip back to bare metal — everything else stays fully oxidized.',
      initialPattern,
      initialPatternLibraryId: existing?.mode === 'pattern' ? (existing.patternLibraryId || null) : null,
      library: window.PatternLibrary ? {
        list: () => window.PatternLibrary.listAvailable(),
        get: (id) => window.PatternLibrary.getById(id),
        save: (label, patternData) => window.PatternLibrary.saveToLibrary(label, patternData),
        remove: (id) => window.PatternLibrary.removeSaved(id),
      } : null,
      renderPreview: (patternData) => window.ToolMetalRecolor?.getRecoloredCanvas(def.sprite, {
        targetHex: baseMetal.hex,
        verdigrisHex: baseMetal.verdigrisHex,
        oxidationAmount: 1,
        authoredPattern: patternData,
      }),
      onSave: (patternData, sourceLibraryId) => applyVerdigrisPattern(itemKey, patternData, sourceLibraryId),
    });
  }

  // Each purchase advances exactly one reinforcement grade. The tool keeps its
  // literal item key, sprite/verdigris, plating, and independent mastery.
  function reinforceMetalTool(itemKey) {
    const def = deps.TOOL_ITEM_DEFS[itemKey];
    if (!def?.metalKey || !deps.getGearInventory()?.tools?.[itemKey]) return;
    const current = deps.toolReinforcementProgress(itemKey); // Authoritative per-item saved grade/legacy strength.
    const next = window.MetalReinforcement?.next(current, deps.METAL_DEFS, deps.VERDIGRIS_METAL_KEYS); // Only the immediate next grade may be purchased.
    if (!next) { deps.showToast('This tool has reached maximum reinforcement.', false); return; }
    const barKey = deps.metalBarItemKey(next.metalKey);
    if ((deps.inventory[barKey] || 0) < next.bars) { deps.showToast(`Need ${next.bars} ${deps.METAL_DEFS[next.metalKey].label} bars for ${next.label}.`, false); return; }
    if ((deps.inventory.gold || 0) < next.gold) { deps.showToast("Not enough gold for the smith's labor.", false); return; }
    deps.inventory[barKey] -= next.bars;
    deps.clampInventoryStack(barKey);
    deps.inventory.gold -= next.gold;
    deps.setToolReinforcement(itemKey, next.metalKey, next.grade);
    deps.showToast(`${def.label} reinforced to ${next.label}!`, true);
    renderMetalCraftShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  function renderMetalCraftShopPage() {
    window.WeaponTrustVisits?.syncSmithingShapeUnlocks?.();
    if (!deps.UNLOCKED_TOOL_SHAPES.includes(metalCraftActiveShape)) metalCraftActiveShape = deps.UNLOCKED_TOOL_SHAPES[0];
    const goldEl = document.getElementById('mcGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    const title = document.querySelector('#mpMetalCraftShop .menu-section-title'); // Reflects the permanent building upgrade in the existing shop header.
    if (title) title.textContent = window.TownMine?.hasImprovement?.('foundry') ? "Sloomi & Kzubug's Foundry" : "Sloomi & Kzubug's Smithing Counter";
    const list = document.getElementById('metalCraftShopList');
    if (!list) return;
    list.innerHTML = '';
    window.FoundryShop?.render?.(list);
    const gearInventory = deps.getGearInventory();

    const craftHdr = document.createElement('div');
    craftHdr.className = 'shop-section-label';
    craftHdr.textContent = `🔨 Craft a New Tool  (from ${CRAFT_BAR_COST} bars + ${CRAFT_LABOR_GOLD}g; advanced metals cost more bars)`;
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
      const forgeBars = window.MetalReinforcement.forgeBarCost(CRAFT_BAR_COST, metalKey, deps.METAL_DEFS); // Visible smithing bar cost matches purchase validation.
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
          <div class="sh-price">${forgeBars} bars + ${CRAFT_LABOR_GOLD}g</div>
        </div>
        <button class="shop-buy-btn" data-metal="${metalKey}" ${alreadyOwned ? 'disabled' : ''}>${alreadyOwned ? 'Owned' : 'Smith'}</button>
      `;
      row.querySelector('[data-metal]')?.addEventListener('click', () => craftMetalTool(metalCraftActiveShape, metalKey));
      list.appendChild(row);
    });

    window.MetalArmorSystem?.renderSmithySection?.(list); // Metal-clothing subsection: registered armor blueprints can occupy any clothing slot and unlock cosmetic treatments at Temper 5.

    const ownedCrafted = Object.keys(gearInventory?.tools || {}).filter(key => deps.TOOL_ITEM_DEFS[key]?.metalKey);
    if (ownedCrafted.length) {
      const plateHdr = document.createElement('div');
      plateHdr.className = 'shop-section-label';
      plateHdr.textContent = '✨ Tool Treatments — Plate, Clear, or Reinforce';
      list.appendChild(plateHdr);

      ownedCrafted.forEach(itemKey => {
        const def = deps.TOOL_ITEM_DEFS[itemKey];
        const verdigrisPct = Math.round(deps.toolVerdigrisFraction(itemKey) * 100);
        const plating = deps.toolPlating(itemKey);
        const reinforcement = deps.toolReinforcementProgress(itemKey); // Current saved grade, including legacy-strength equipment.
        const nextReinforcement = window.MetalReinforcement?.next(reinforcement, deps.METAL_DEFS, deps.VERDIGRIS_METAL_KEYS); // The one affordable-or-unaffordable step shown in the shop.
        const nextBarsOwned = nextReinforcement ? (deps.inventory[deps.metalBarItemKey(nextReinforcement.metalKey)] || 0) : 0; // Used by the visible cost/stock notice.
        const platingText = plating
          ? (plating.mode === 'cosmetic' ? `Plated: ${deps.METAL_DEFS[plating.metalKey]?.label}`
            : plating.mode === 'pattern' ? 'Authored verdigris-removal pattern'
            : 'Verdigris-resistant coat')
          : `Live verdigris: ${verdigrisPct}%`;
        const patternEligible = deps.toolVerdigrisPatternEligible(itemKey);
        const plateOptions = [
          `<option value="clear">— live verdigris (clear plating) —</option>`,
          `<option value="resistant">Verdigris-resistant coat (${deps.esc(deps.METAL_DEFS[def.metalKey].label)})</option>`,
          // Cosmetic plating is specifically a non-verdigris metal's clean
          // color (see spec) — a verdigris metal already shows its own
          // live oxidation, so "resistant" (above) is the same-metal
          // option instead.
          ...Object.keys(deps.METAL_DEFS).filter(k => deps.METAL_DEFS[k].tier == null && (deps.inventory[deps.metalBarItemKey(k)] || 0) > 0)
            .map(k => `<option value="cosmetic:${k}">Cosmetic: ${deps.esc(deps.METAL_DEFS[k].label)}</option>`),
          // Only offered once this weapon has finished its procedural growth
          // (mastery 5) — see toolVerdigrisPatternEligible. Mutually
          // exclusive with every option above: picking it (and saving in the
          // editor) replaces whatever plating/pattern this tool already had.
          ...(patternEligible ? [
            ...(window.PatternLibrary?.listAvailable?.() || []).map(entry => `<option value="library-pattern:${deps.esc(entry.id)}">Pattern: ${deps.esc(entry.label || entry.id)}</option>`),
            '<option value="pattern">Author a verdigris-removal pattern…</option>',
          ] : []),
        ].join('');
        const row = document.createElement('div');
        row.className = 'shop-row mc-tool-row';
        row.innerHTML = `
          <div class="sh-icon">${def.icon}</div>
          <div class="sh-info">
            <div class="sh-name">${deps.esc(def.label)}</div>
            <div class="sh-desc">${deps.esc(platingText)} — Mastery ${deps.toolMasteryLevel(itemKey)}/5 — Reinforcement: ${reinforcement ? deps.esc(reinforcement.label) + ' (' + (reinforcement.rank + 1) + '/' + (reinforcement.maxRank + 1) + ')' : 'N/A'}</div>
            <div class="mc-tool-controls">
              <select class="mc-plate-select">${plateOptions}</select>
              <button class="shop-buy-btn mc-plate-btn">Apply</button>
            </div>
            ${nextReinforcement ? `<div class="mc-tool-controls">
              <button class="shop-buy-btn mc-reinforce-btn">Reinforce to ${deps.esc(nextReinforcement.label)} (${nextReinforcement.bars} bars + ${nextReinforcement.gold}g)</button>
            </div>
            <div class="sh-desc">Next step: ${deps.esc(nextReinforcement.label)} · ${nextBarsOwned}/${nextReinforcement.bars} bars owned · Power ${reinforcement.multiplier.toFixed(3)}× → ${nextReinforcement.multiplier.toFixed(3)}×</div>` : '<div class="sh-desc">Maximum metal reinforcement reached.</div>'}
          </div>
        `;
        row.querySelector('.mc-plate-btn')?.addEventListener('click', () => {
          const choice = row.querySelector('.mc-plate-select').value;
          if (choice === 'pattern') { openVerdigrisPatternEditor(itemKey); return; }
          if (choice.startsWith('library-pattern:')) {
            const patternId = choice.slice('library-pattern:'.length); // Selected owned library motif, without the authoring editor.
            const pattern = window.PatternLibrary?.getById?.(patternId);
            if (pattern) applyVerdigrisPattern(itemKey, pattern, patternId);
            else deps.showToast('That pattern is unavailable.', false);
            return;
          }
          applyMetalToolPlating(itemKey, choice);
        });
        row.querySelector('.mc-reinforce-btn')?.addEventListener('click', () => reinforceMetalTool(itemKey));
        if (plating?.mode === 'pattern') {
          window.PatternQuickControls?.mount(row.querySelector('.sh-info') || row, {
            title: 'Verdigris pattern placement',
            getPattern: () => {
              const active = deps.toolPlating(itemKey);
              return active?.mode === 'pattern' ? (active.pattern || window.PatternLibrary?.getById?.(active.patternLibraryId) || null) : null;
            },
            onChange: pattern => updateToolPatternPlacement(itemKey, pattern), // No second plating charge for instance placement edits.
          });
        }
        list.appendChild(row);
      });
    }
  }

  window.MetalCraftShop = {
    init,
    render: renderMetalCraftShopPage,
    refreshAllMetalToolWorldTextures,
    __test: Object.freeze({ resolvedForEditing, updateToolPatternPlacement }),
  };
})();
