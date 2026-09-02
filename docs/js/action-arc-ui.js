(() => {
  'use strict';

  // Desktop/touch radial arc selector (tool wheel, item wheel, ammo/potion
  // entry menus, utilities wheel) — extracted out of game.js following the
  // same window.<Namespace> + init(deps) pattern as its siblings. Already
  // exposed itself globally as window._desktopSelectionArc/
  // window.SharedSelectionArch before this extraction (other code calls
  // those methods directly), so both assignments are preserved as-is;
  // window.ActionArcUI.init(deps) is the only new surface.
  //
  // Audited every reference before extracting: activeTool/currentArea are
  // only ever READ here (reassigned elsewhere), so plain getters suffice.
  // heldMode/activeItemIndex/lastHeldFarmTool ARE reassigned by this
  // cluster, so each gets a getter+setter pair — reusing the exact
  // setHeldMode/getActiveItemIndex+setActiveItemIndex names already
  // established for other modules' identical needs. equipmentSlots/
  // TOOL_ITEM_DEFS/inventory/characterViewMode/player/WHEEL_SLOTS/ITEM_DEFS
  // are `const`s only ever mutated in place, so they're passed by direct
  // reference. setActiveTool/putAwayHeldEquipment/refreshActionBar/
  // cycleActiveInventoryItem/showToast/startSceneTransition/enterBuilding/
  // enterZone/performTravel/setCharacterViewMode are stable game.js
  // `function` declarations passed by direct reference.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const _itemBtn = document.getElementById('itemBtn');
  const ARC_S = 175, ARC_E = 95;
  const mobileControls = window.SCRATCHBONES_CONFIG?.game?.mobileControls || {};
  const configuredSafeMarginPx = Number(mobileControls.safeMarginPx);
  const SAFE_M = Number.isFinite(configuredSafeMarginPx) ? configuredSafeMarginPx : 0;
  const actionArchRadiusClamp = mobileControls.actionArch?.radiusClamp || {};
  const outerArchRadiusClamp = mobileControls.outerArch?.radiusClamp || {};

  function _clampedVmin({ minPx, vmin, maxPx }) {
    const viewportMin = Math.min(window.innerWidth, window.innerHeight);
    const configuredVmin = Number(vmin);
    const preferredPx = viewportMin * (Number.isFinite(configuredVmin) ? configuredVmin : 0) / 100;
    const lowerPx = Number(minPx);
    const upperPx = Number(maxPx);
    if (![preferredPx, lowerPx, upperPx].every(Number.isFinite)) return 0;
    return Math.min(upperPx, Math.max(lowerPx, preferredPx));
  }

  function _outerR() {
    const colPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col'));
    return Number.isFinite(colPx) && colPx > 0 ? colPx * 10 : _clampedVmin(outerArchRadiusClamp);
  }
  function _innerR() {
    const colPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col'));
    return Number.isFinite(colPx) && colPx > 0 ? colPx * 7.6 : _clampedVmin(actionArchRadiusClamp);
  }
  function _arcPt(deg, radius = _outerR()) {
    const r = radius, a = deg * Math.PI / 180;
    return { x: window.innerWidth  + Math.cos(a) * r - SAFE_M,
             y: window.innerHeight - Math.sin(a) * r - SAFE_M };
  }
  function _cornerAng(px, py) {
    return Math.atan2(-(py - window.innerHeight), px - window.innerWidth) * 180 / Math.PI;
  }

  let _arcEls = [], _arcBd = null, _arcOpen = null, _arcSlots = [], _arcActive = -1;
  let _heldEntrySelectorKind = null; // Shared by keyboard/controller/pointer adapters so wheel input knows which held selector owns it.
  let _fadingEls = [];

  function _clearArc(keepBackdrop = false) {
    if (_arcBd && !keepBackdrop) { _arcBd.remove(); _arcBd = null; }
    _arcEls.forEach(e => e.remove()); _arcEls = [];
    _fadingEls.forEach(e => e.remove()); _fadingEls = [];
    _arcSlots = []; _arcActive = -1; _arcOpen = null;
    deps.toolBtn.style.visibility = '';
    if (_itemBtn) _itemBtn.style.visibility = '';
  }

  function _mkSlot(deg, icon, label, extra, radius = _outerR()) {
    const pt = _arcPt(deg, radius);
    const el = document.createElement('div');
    el.className = 'arc-slot' + (extra ? ' ' + extra : '');
    el.style.cssText = `position:fixed;left:${pt.x}px;top:${pt.y}px;z-index:201;pointer-events:none;`;
    el.innerHTML = `<span class="arc-icon">${icon}</span>`
                 + (label ? `<span class="arc-label">${label}</span>` : '');
    document.body.appendChild(el);
    _arcEls.push(el);
    return el;
  }

  function _setActive(idx) {
    if (_arcActive === idx) return;
    if (_arcSlots[_arcActive]) _arcSlots[_arcActive].el.classList.remove('arc-active');
    _arcActive = idx;
    if (_arcSlots[idx]) _arcSlots[idx].el.classList.add('arc-active');
  }

  function _openToolArc() {
    _clearArc(); _arcOpen = 'tool';
    if (_itemBtn) _itemBtn.style.visibility = 'hidden';
    _arcBd = document.createElement('div');
    _arcBd.className = 'arc-backdrop';
    document.body.appendChild(_arcBd);
    const activeTool = deps.getActiveTool();
    const n = deps.WHEEL_SLOTS.length, step = (ARC_S - ARC_E) / (n - 1);
    deps.WHEEL_SLOTS.forEach((slot, i) => {
      const deg = ARC_S - i * step;
      const eq = deps.equipmentSlots[slot], def = eq ? deps.TOOL_ITEM_DEFS[eq] : null;
      const fallbackIcon = {shovel:'⛏️',hoe:'🪓',weapon:'🗡️',axe:'🪓',pick:'⛏️',harpoon:'🎣'}[slot] || '🔧';
      const icon  = deps.toolSelectIconHTML(def, fallbackIcon, '1.4em');
      const label = {shovel:'Shovel',hoe:'Hoe',weapon:'Weapon',axe:'Axe',pick:'Pick',harpoon:'Harpoon'}[slot] || slot;
      const el = _mkSlot(deg, icon, label, activeTool === slot ? 'arc-active' : '');
      _arcSlots.push({ angle: deg, el, data: slot });
      if (activeTool === slot) _arcActive = i;
    });
  }

  function _openAmmoArc() {
    const choices = window.RangedWeapons?.ammoChoices?.(deps.equipmentSlots.ranged) || [];
    const activeAmmo = window.RangedWeapons?.activeAmmoId?.(deps.equipmentSlots.ranged) || 'basic';
    _openEntries('ammo', choices.map(choice => ({
      id: choice.id, icon: choice.icon, label: choice.available ? choice.label : `${choice.label} · 0/8`,
      disabled: !choice.available, active: choice.id === activeAmmo,
      onSelect: () => window.RangedWeapons?.setActiveAmmo?.(deps.equipmentSlots.ranged, choice.id),
    }))); // Special ammo uses the same ordinary-radius arch primitive.
  }

  // Utilities wheel — opened by holding 'c' (see desktopHoldKeys/
  // openDesktopHoldArc below), for quick actions that don't belong on the
  // per-tile action bar: warping back to a placed wilderness campfire or
  // the farm, quick-selecting a Campfire Kit without scrolling the item
  // wheel, or orbiting around the stationary player.
  function _openUtilitiesArc() {
    // A placed campfire now persists indefinitely, including outside its
    // own zone (see wilderness-campfire.js's header comment) — serialize()
    // is the "does one exist, and where" query for that; isHere() only
    // ever answers "is it in the CURRENT zone", which used to be the same
    // question back when leaving destroyed it.
    const campfire = window.WildernessCampfire?.serialize?.();
    const kitCount = deps.inventory.campfireKitFurniture || 0;
    _openEntries('utilities', [
      {
        id: 'character-view', icon: '👁️', label: deps.characterViewMode.enabled ? 'Character View: On' : 'Character View: Off',
        active: deps.characterViewMode.enabled,
        onSelect: () => deps.setCharacterViewMode(!deps.characterViewMode.enabled),
      },
      {
        id: 'return-camp', icon: '🏕️', label: campfire ? 'Return to Camp' : 'No Camp Set Up',
        disabled: !campfire,
        onSelect: () => {
          if (!campfire) return;
          if (campfire.mapId === deps.getCurrentArea()) {
            // Already in the right zone — just reposition onto the tile.
            const result = window.WildernessCampfire.returnToCampfire();
            deps.showToast(result.message, result.ok);
            deps.refreshActionBar();
          } else {
            // A different zone (or the farm/town/a building) — travel there
            // first, landing exactly on the campfire's own tile since its
            // saved x/z are passed straight through as the entry col/row
            // (same fire-and-forget async-inside-startSceneTransition
            // pattern performTravel's own 'zone' case uses for an
            // ordinary authored zone transition).
            if (window.TownMine?.floorFromMapId?.(campfire.mapId)) {
              window.WildernessCampfire?.requestReturnToCampfire?.();
              deps.startSceneTransition(() => deps.enterBuilding(campfire.mapId));
            } else {
              deps.startSceneTransition(() => deps.enterZone(campfire.mapId, Math.floor(campfire.x), Math.floor(campfire.z)));
            }
          }
        },
      },
      {
        id: 'select-kit', icon: '🔥', label: kitCount > 0 ? `Campfire Kit ×${kitCount}` : 'No Campfire Kit',
        disabled: kitCount <= 0,
        onSelect: () => _selectHeldInventoryKey('campfireKitFurniture'),
      },
      {
        id: 'return-farm', icon: '🏡', label: deps.getCurrentArea() === 'farm' ? 'Already on Farm' : 'Return to Farm',
        disabled: deps.getCurrentArea() === 'farm',
        onSelect: () => deps.startSceneTransition(() => deps.performTravel({ target: 'farm', targetCol: 17, targetRow: 0 })),
      },
    ]);
  }

  function _openEntries(mode, entries, radius = _outerR()) {
    const keepBackdrop = Boolean(_arcBd && _arcOpen?.startsWith('entries:')); // Keeps one continuous drag alive while potion branches unfold.
    _clearArc(keepBackdrop); _arcOpen = `entries:${mode}`;
    if (_itemBtn) _itemBtn.style.visibility = 'hidden';
    deps.toolBtn.style.visibility = 'hidden';
    if (!_arcBd) {
      _arcBd = document.createElement('div');
      _arcBd.className = 'arc-backdrop';
      let pointerId = null; // One pointer owns general entry-arch navigation until commit/cancel.
      _arcBd.addEventListener('pointerdown', event => {
        pointerId = event.pointerId;
        try { _arcBd.setPointerCapture(pointerId); } catch (error) { /* Pointer capture is an optional enhancement. */ }
        _arcMove(event.clientX, event.clientY);
        event.preventDefault();
      });
      _arcBd.addEventListener('pointermove', event => { if (event.pointerId === pointerId) _arcMove(event.clientX, event.clientY); });
      _arcBd.addEventListener('pointerup', event => { if (event.pointerId === pointerId) { pointerId = null; _arcUp(); } });
      _arcBd.addEventListener('pointercancel', event => { if (event.pointerId === pointerId) { pointerId = null; _clearArc(); } });
      document.body.appendChild(_arcBd);
    }
    const n = entries.length, step = n > 1 ? (ARC_S - ARC_E) / (n - 1) : 0;
    entries.forEach((entry, index) => {
      const deg = ARC_S - index * step;
      const extra = [entry.active ? 'arc-active' : '', entry.disabled ? 'blocked' : '', entry.className || ''].filter(Boolean).join(' ');
      const el = _mkSlot(deg, entry.icon, entry.label, extra, radius);
      _arcSlots.push({ angle: deg, el, data: { ...entry, type: 'entry' } });
      if (entry.active) _arcActive = index;
    });
    if (_arcActive < 0 && entries.length) _setActive(Math.floor((entries.length - 1) / 2));
  }

  function _selectHeldInventoryKey(itemKey) {
    const index = deps.getInventoryStackItems().findIndex(item => item.key === itemKey);
    if (index < 0) return;
    deps.setActiveItemIndex(index);
    deps.setHeldMode('item');
    window.HudUpdate.refreshItemScroll(); deps.refreshActionBar();
  }

  const CURE_FAMILY_ICONS = { damage: '🩸', control: '🌀', offensiveDebuff: '⚔️', defensiveDebuff: '🛡️' }; // Four-family selector vocabulary.
  function _cureCoverageIcon(coverage, urgent = true) {
    return `<span class="cure-family-grid">${window.AlchemySystem.FAMILY_ORDER.map(family => {
      const state = coverage[family] || {};
      const severity = state.activeAmount >= 45 ? ' severe' : state.activeAmount > 0 ? ' active' : '';
      const missing = state.owned ? '' : `<b class="cure-family-x${state.urgentMissing && urgent ? ' urgent' : ''}">×</b>`;
      return `<span class="cure-family${severity}" data-family="${family}">${CURE_FAMILY_ICONS[family]}${missing}</span>`;
    }).join('')}</span>`;
  }

  function _openPotionRoot() {
    _openEntries('potion-root', [
      { id:'medicine', icon:'✚', label:'Medicine', className:'potion-branch medicine', onSelect:() => _openPotionBranch('medicine') },
      { id:'utility', icon:'⚗️', label:'Utility', className:'potion-branch utility', onSelect:() => _openPotionBranch('utility') },
    ], _outerR());
  }

  function _openPotionBranch(branch) {
    const state = window.AlchemySystem?.potionCategoryState?.(deps.player) || {};
    const healing = state.healing || {}, cures = state.cures || {}, buffs = state.buffs || {}, flasks = state.flasks || {};
    const urgent = state.inCombat !== false; // Outside combat, unavailable marks stay muted.
    const healingClass = `potion-category${healing.needed ? '' : ' muted'}${healing.urgentMissing ? ` unavailable${urgent ? ' urgent' : ''}` : ''}`;
    const curesUseful = (cures.usefulItems || []).length > 0;
    const buffsUseful = (buffs.usefulItems || []).length > 0;
    const entries = branch === 'medicine' ? [
      { id:'healing', icon:`💚${healing.urgentMissing ? '<b class="category-x red">×</b>' : ''}`, label:'Healing', className:healingClass, disabled:!(healing.needed && healing.owned), onSelect:() => _openPotionItems('healing') },
      { id:'medicine', icon:'✚', label:'Medicine', className:'potion-branch medicine', onSelect:_openPotionRoot },
      { id:'cures', icon:_cureCoverageIcon(cures.coverage || {}, urgent), label:'Cures', className:`potion-category${curesUseful ? '' : ' muted'}`, disabled:!curesUseful, onSelect:() => _openPotionItems('cures') },
    ] : [
      { id:'buffs', icon:`✨${buffs.owned ? '' : '<b class="category-x white">×</b>'}`, label:'Buffs', className:`potion-category${buffsUseful ? '' : ' muted'}`, disabled:!buffsUseful, onSelect:() => _openPotionItems('buffs') },
      { id:'utility', icon:'⚗️', label:'Utility', className:'potion-branch utility', onSelect:_openPotionRoot },
      { id:'flasks', icon:`🫙${flasks.owned ? '' : '<b class="category-x white">×</b>'}`, label:'Flasks', className:`potion-category${flasks.owned ? '' : ' muted'}`, disabled:!flasks.owned, onSelect:() => _openPotionItems('flasks') },
    ];
    _openEntries(`potion-${branch}`, entries, _outerR());
  }

  function _openPotionItems(category) {
    const state = window.AlchemySystem?.potionCategoryState?.(deps.player) || {};
    const items = category === 'healing' ? state.healing?.usefulItems
      : category === 'cures' ? state.cures?.usefulItems
        : category === 'buffs' ? state.buffs?.items : state.flasks?.items;
    const itemEntries = (items || []).map(entry => {
      const definition = entry.recipe || window.AlchemySystem.RECIPE_DEFS[entry.payload.recipeId];
      const active = category === 'buffs' && window.AlchemySystem.activeEffects.some(effect => effect.recipeId === definition.id);
      return { id:entry.itemKey, icon:definition.icon, label:`${definition.label} ×${entry.count}`, className:active?'redundant':'', disabled:false, onSelect:() => _selectHeldInventoryKey(entry.itemKey) };
    });
    const cancelEntry = { id:`cancel-${category}`, icon:'✕', label:'Cancel', className:'potion-cancel', active:true, disabled:false, onSelect:() => _clearArc() }; // Occupies the focused category's former angle and closes only when the held selector is released on it.
    if (category === 'healing' || category === 'buffs') itemEntries.unshift(cancelEntry);
    else itemEntries.push(cancelEntry);
    _openEntries(`potion-items-${category}`, itemEntries, _outerR());
  }

  let _iScroll = 0, _iScrollT = null, _iScrollDir = 0;
  const ITEM_VIS = 5;

  function _buildItemSlots() {
    const activeItemIndex = deps.getActiveItemIndex();
    const stacks = deps.getInventoryStackItems(), total = stacks.length;
    const slots = [];
    if (_iScroll > 0) slots.push({ type:'arrow', dir:-1, icon:'◀', label:'' });
    for (let i = 0; i < ITEM_VIS && _iScroll + i < total; i++)
      slots.push({ type:'item', index:_iScroll+i, key:stacks[_iScroll+i].key, icon:stacks[_iScroll+i].icon, label:stacks[_iScroll+i].label });
    if (_iScroll + ITEM_VIS < total) slots.push({ type:'arrow', dir:1, icon:'▶', label:'' });
    const sn = slots.length, step = sn > 1 ? (ARC_S - ARC_E) / (sn - 1) : 0;

    const oldByKey = new Map(_arcSlots.map(s => [
      s.data.type === 'arrow' ? `a${s.data.dir}` : `i${s.data.index}`, s
    ]));
    const kept = new Set(), newSlots = [];

    slots.forEach((s, i) => {
      const deg = ARC_S - i * step, pt = _arcPt(deg);
      const k = s.type === 'arrow' ? `a${s.dir}` : `i${s.index}`;
      const extra = s.type === 'arrow' ? 'arc-arrow' : (s.index === activeItemIndex ? 'arc-active' : '');
      if (oldByKey.has(k)) {
        const old = oldByKey.get(k); kept.add(k);
        old.el.style.left = pt.x + 'px'; old.el.style.top = pt.y + 'px';
        old.el.className = 'arc-slot' + (extra ? ' ' + extra : '');
        newSlots.push({ angle: deg, el: old.el, data: s });
      } else {
        const el = document.createElement('div');
        el.className = 'arc-slot' + (extra ? ' ' + extra : '');
        el.style.cssText = `position:fixed;left:${pt.x}px;top:${pt.y}px;z-index:201;pointer-events:none;opacity:0;`;
        el.innerHTML = `<span class="arc-icon">${s.icon}</span>`
                     + (s.label ? `<span class="arc-label">${s.label}</span>` : '');
        document.body.appendChild(el);
        _arcEls.push(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        newSlots.push({ angle: deg, el, data: s });
      }
      const iconEl = newSlots[newSlots.length - 1].el.querySelector('.arc-icon');
      if (s.type === 'item') {
        deps.applyItemSpriteIcon(iconEl, deps.ITEM_DEFS[s.key], s.key);
      }
      else deps.clearItemSpriteIcon(iconEl);
    });

    _arcSlots.forEach(s => {
      const k = s.data.type === 'arrow' ? `a${s.data.dir}` : `i${s.data.index}`;
      if (!kept.has(k)) {
        s.el.style.opacity = '0';
        _arcEls = _arcEls.filter(e => e !== s.el);
        _fadingEls.push(s.el);
        const _el = s.el;
        setTimeout(() => { _el.remove(); _fadingEls = _fadingEls.filter(f => f !== _el); }, 150);
      }
    });

    _arcSlots = newSlots;
    _arcActive = newSlots.findIndex(s => s.data.type === 'item' && s.data.index === activeItemIndex);
  }

  function _openItemArc() {
    _clearArc(); _arcOpen = 'item';
    deps.toolBtn.style.visibility = 'hidden';
    _arcBd = document.createElement('div');
    _arcBd.className = 'arc-backdrop';
    document.body.appendChild(_arcBd);
    _iScroll = Math.max(0, deps.getActiveItemIndex() - Math.floor(ITEM_VIS / 2));
    _iScrollDir = 0;
    _buildItemSlots();
  }

  function _arcMove(px, py) {
    if (!_arcOpen || !_arcSlots.length) return;
    const ang = Math.max(ARC_E, Math.min(ARC_S, _cornerAng(px, py)));
    let best = 0, bd = Infinity;
    _arcSlots.forEach((s, i) => { const d = Math.abs(s.angle - ang); if (d < bd) { bd = d; best = i; } });
    if (_arcOpen === 'item') {
      const newDir = _arcSlots[best]?.data.type === 'arrow' ? _arcSlots[best].data.dir : 0;
      if (newDir !== _iScrollDir) {
        _iScrollDir = newDir;
        if (_iScrollT) { clearInterval(_iScrollT); _iScrollT = null; }
        if (newDir !== 0) {
          _iScrollT = setInterval(() => {
            _iScroll = Math.max(0, Math.min(deps.getInventoryStackItems().length - ITEM_VIS, _iScroll + _iScrollDir));
            _buildItemSlots();
          }, 200);
        }
      }
    }
    _setActive(best);
    if (_arcOpen === 'entries:potion-root') {
      const branch = _arcSlots[best]?.data.id;
      if (branch === 'medicine' || branch === 'utility') {
        _openPotionBranch(branch); // Dragging toward a side fluidly unfolds it.
        _arcMove(px, py); // Re-evaluate the same continuous drag against the newly populated category arch.
      }
    } else if (_arcOpen === 'entries:potion-medicine' || _arcOpen === 'entries:potion-utility') {
      const category = _arcSlots[best]?.data;
      if (category && !category.disabled && ['healing', 'cures', 'buffs', 'flasks'].includes(category.id)) {
        _openPotionItems(category.id);
        _arcMove(px, py); // The replacement Cancel button becomes selected immediately under the uninterrupted drag.
      }
    }
  }

  function _arcUp() {
    if (_iScrollT) { clearInterval(_iScrollT); _iScrollT = null; }
    if (!_arcOpen) return;
    const slot = _arcSlots[_arcActive];
    if (_arcOpen === 'tool' && slot) {
      deps.setHeldMode('tool'); deps.setLastHeldFarmTool(slot.data);
      deps.setActiveTool(slot.data); // calls refreshActionBar internally
    } else if (_arcOpen === 'item' && slot?.data.type === 'item') {
      deps.setHeldMode('item');
      deps.setActiveItemIndex(slot.data.index);
      window.HudUpdate.refreshItemScroll(); deps.refreshActionBar();
    } else if (_arcOpen?.startsWith('entries:') && slot && !slot.data.disabled) {
      const select = slot.data.onSelect;
      if (typeof select === 'function') {
        const previousMode = _arcOpen; // Branch callbacks replace the current arch; item callbacks do not.
        select();
        if (_arcOpen !== previousMode) return;
      }
    }
    _clearArc();
  }

  function _bindListeners() {
    window._desktopSelectionArc = {
      openTool() { if (_arcOpen !== 'tool') _openToolArc(); },
      openItem() { if (_arcOpen !== 'item') _openItemArc(); },
      openAmmo() { if (_arcOpen !== 'entries:ammo') _openAmmoArc(); },
      openPotions() { _openPotionRoot(); },
      openUtilities() { if (_arcOpen !== 'entries:utilities') _openUtilitiesArc(); },
      openEntries(mode, entries, options = {}) { _openEntries(mode, entries, options.radius || _outerR()); },
      recallLastTool() {
        const fallback = deps.WHEEL_SLOTS.find(slot => deps.equipmentSlots[slot]) || deps.WHEEL_SLOTS[0]; // Deleted/invalid remembered references degrade safely.
        const lastHeldFarmTool = deps.getLastHeldFarmTool();
        const recalled = deps.WHEEL_SLOTS.includes(lastHeldFarmTool) && deps.equipmentSlots[lastHeldFarmTool] ? lastHeldFarmTool : fallback;
        deps.setLastHeldFarmTool(recalled);
        deps.setHeldMode('tool');
        deps.setActiveTool(recalled);
        return recalled;
      },
      scrollTool(dir) {
        if (_arcOpen !== 'tool') _openToolArc();
        const activeTool = deps.getActiveTool();
        const idx = deps.WHEEL_SLOTS.indexOf(activeTool);
        const next = (idx + dir + deps.WHEEL_SLOTS.length) % deps.WHEEL_SLOTS.length;
        deps.setHeldMode('tool');
        deps.setLastHeldFarmTool(deps.WHEEL_SLOTS[next]);
        deps.setActiveTool(deps.WHEEL_SLOTS[next]);
        _arcSlots.forEach((s, i) => {
          const active = s.data === deps.getActiveTool();
          s.el.classList.toggle('arc-active', active);
          if (active) _arcActive = i;
        });
      },
      scrollItem(dir) {
        if (_arcOpen !== 'item') _openItemArc();
        deps.setHeldMode('item');
        deps.cycleActiveInventoryItem(dir);
        window.HudUpdate.refreshItemScroll(); deps.refreshActionBar();
        const activeItemIndex = deps.getActiveItemIndex();
        _iScroll = Math.max(0, Math.min(deps.getInventoryStackItems().length - ITEM_VIS, activeItemIndex - Math.floor(ITEM_VIS / 2)));
        _buildItemSlots();
        _arcSlots.forEach((s, i) => {
          const active = s.data.type === 'item' && s.data.index === activeItemIndex;
          s.el.classList.toggle('arc-active', active);
          if (active) _arcActive = i;
        });
      },
      scrollAmmo(dir) {
        if (_arcOpen !== 'entries:ammo') _openAmmoArc();
        const available = _arcSlots.map((slot, index) => ({ slot, index })).filter(entry => !entry.slot.data.disabled);
        if (!available.length) return false;
        let position = available.findIndex(entry => entry.index === _arcActive);
        position = (position + (dir < 0 ? -1 : 1) + available.length) % available.length;
        _setActive(available[position].index); // Highlight only; the held input's release commits setActiveAmmo.
        return true;
      },
      scrollEntries(dir) {
        if (!_arcOpen?.startsWith('entries:') || !_arcSlots.length) return false;
        if (_arcOpen === 'entries:potion-root') {
          _openPotionBranch(dir < 0 ? 'medicine' : 'utility'); // Direction itself chooses the first hierarchical branch.
          return true;
        }
        if (_arcOpen === 'entries:potion-medicine' || _arcOpen === 'entries:potion-utility') {
          const categoryId = _arcOpen.endsWith('medicine') ? (dir < 0 ? 'healing' : 'cures') : (dir < 0 ? 'buffs' : 'flasks');
          const category = _arcSlots.find(slot => slot.data.id === categoryId);
          if (category && !category.data.disabled) _openPotionItems(categoryId);
          else if (category) _setActive(_arcSlots.indexOf(category));
          return true;
        }
        const nextIndex = _arcActive + (dir < 0 ? -1 : 1);
        if (_arcOpen.startsWith('entries:potion-items-')) {
          _setActive(Math.max(0, Math.min(_arcSlots.length - 1, nextIndex))); // Final lists stop at Cancel instead of wrapping past it on repeated wheel events.
        } else {
          _setActive((nextIndex + _arcSlots.length) % _arcSlots.length);
        }
        return true;
      },
      movePointer(x, y) { _arcMove(x, y); },
      commit() { _arcUp(); },
      releaseSelection() {
        if (_arcOpen?.startsWith('entries:potion-') && !_arcOpen.startsWith('entries:potion-items-')) _clearArc();
        else _arcUp();
      }, // Releasing a held selector commits only a concrete item/ammo choice, never a hierarchy branch.
      beginHeldSelection(kind) { _heldEntrySelectorKind = kind === 'ammo' ? 'ammo' : kind === 'potions' ? 'potions' : null; },
      endHeldSelection() { _heldEntrySelectorKind = null; },
      heldSelectionKind() { return _heldEntrySelectorKind; },
      close() { _clearArc(); },
      entryMenuOpen() { return Boolean(_arcOpen?.startsWith('entries:')); },
      toolMenuOpen() { return _arcOpen === 'tool'; }
    };
    window.SharedSelectionArch = window._desktopSelectionArc; // One configurable arch presenter for tools/items/ammo/potions.
    document.addEventListener('hobunji-alchemy-change', () => {
      if (_arcOpen === 'entries:potion-medicine') _openPotionBranch('medicine');
      else if (_arcOpen === 'entries:potion-utility') _openPotionBranch('utility');
      else if (_arcOpen?.startsWith('entries:potion-items-')) _openPotionItems(_arcOpen.slice('entries:potion-items-'.length));
    }); // Refresh the open hierarchy only when its thresholded context changes.

    let _tPtId = null, _tHeld = false, _tTimer = null, _tDx = 0, _tDy = 0, _tMoved = false;
    deps.toolBtn.addEventListener('pointerdown', ev => {
      if (_tPtId !== null) return;
      _tPtId = ev.pointerId; _tHeld = false; _tMoved = false;
      _tDx = ev.clientX; _tDy = ev.clientY;
      // See handleJoystickPointerDown's comment: an uncaught throw here
      // (possible for a touch starting before the browser considers the
      // pointer fully active) would skip the rest of this handler and
      // leave _tPtId stuck non-null, permanently blocking this button via
      // the pointerdown guard above.
      try { deps.toolBtn.setPointerCapture(ev.pointerId); } catch (err) { /* degrade gracefully */ }
      _tTimer = setTimeout(() => { _tHeld = true; _openToolArc(); }, 350);
      ev.preventDefault();
    });
    deps.toolBtn.addEventListener('pointermove', ev => {
      if (ev.pointerId !== _tPtId) return;
      if (!_tMoved && Math.hypot(ev.clientX - _tDx, ev.clientY - _tDy) > 6) _tMoved = true;
      if (_arcOpen === 'tool') _arcMove(ev.clientX, ev.clientY);
    });
    deps.toolBtn.addEventListener('pointerup', ev => {
      if (ev.pointerId !== _tPtId) return;
      _tPtId = null;
      if (_tTimer) { clearTimeout(_tTimer); _tTimer = null; }
      if (_arcOpen === 'tool') _arcUp();
      else if (!_tHeld && !_tMoved) {
        // A Tool Select tap recalls the last valid held tool — unless a
        // tool is already out, in which case the same tap now dequips
        // instead (replacing the removed dedicated put-away button; see
        // its matching case in itemBtn's own pointerup below).
        if (deps.getHeldMode() === 'tool') deps.putAwayHeldEquipment();
        else window._desktopSelectionArc.recallLastTool();
      }
      _tHeld = false; _tMoved = false;
    });
    deps.toolBtn.addEventListener('pointercancel', ev => {
      if (ev.pointerId !== _tPtId) return;
      _tPtId = null;
      if (_tTimer) { clearTimeout(_tTimer); _tTimer = null; }
      _clearArc(); _tHeld = false; _tMoved = false;
    });

    if (_itemBtn) {
      let _iPtId = null, _iHeld = false, _iTimer = null, _iDx = 0, _iDy = 0, _iMoved = false;
      _itemBtn.addEventListener('pointerdown', ev => {
        if (_iPtId !== null) return;
        _iPtId = ev.pointerId; _iHeld = false; _iMoved = false;
        _iDx = ev.clientX; _iDy = ev.clientY;
        // See handleJoystickPointerDown's comment.
        try { _itemBtn.setPointerCapture(ev.pointerId); } catch (err) { /* degrade gracefully */ }
        _iTimer = setTimeout(() => { _iHeld = true; _openItemArc(); }, 350);
        ev.preventDefault();
      });
      _itemBtn.addEventListener('pointermove', ev => {
        if (ev.pointerId !== _iPtId) return;
        if (!_iMoved && Math.hypot(ev.clientX - _iDx, ev.clientY - _iDy) > 6) _iMoved = true;
        if (_arcOpen === 'item') _arcMove(ev.clientX, ev.clientY);
      });
      _itemBtn.addEventListener('pointerup', ev => {
        if (ev.pointerId !== _iPtId) return;
        _iPtId = null;
        if (_iTimer) { clearTimeout(_iTimer); _iTimer = null; }
        if (_arcOpen === 'item') _arcUp();
        else if (!_iHeld && !_iMoved) {
          if (deps.getHeldMode() === 'item') {
            // An item is already selected — the same tap now dequips
            // instead (replacing the removed dedicated put-away button;
            // see its matching case in toolBtn's own pointerup above).
            deps.putAwayHeldEquipment();
          } else {
            // Tap while holding a tool or hands-free → switch to item mode.
            const activeTool = deps.getActiveTool();
            if (deps.getHeldMode() === 'tool' && deps.WHEEL_SLOTS.includes(activeTool)) deps.setLastHeldFarmTool(activeTool);
            deps.setHeldMode('item');
            window.HudUpdate.refreshItemScroll(); deps.refreshActionBar();
          }
        }
        _iHeld = false; _iMoved = false;
      });
      _itemBtn.addEventListener('pointercancel', ev => {
        if (ev.pointerId !== _iPtId) return;
        _iPtId = null;
        if (_iTimer) { clearTimeout(_iTimer); _iTimer = null; }
        if (_iScrollT) { clearInterval(_iScrollT); _iScrollT = null; }
        _clearArc(); _iHeld = false; _iMoved = false;
      });
    }

    // Utility menu button: sixth/new outer-ring control, replacing the
    // removed put-away button's old slot (see the CSS angle comment on
    // #btnUtilityMenu). No tap behavior at all, unlike toolBtn/itemBtn
    // above — it only ever does anything while held, exactly like the
    // desktop 'c' key equivalent (see desktopHoldKeys.c) — so this
    // mirrors their hold-then-drag-to-select pattern but skips their
    // "what does a plain tap do" branch entirely.
    const btnUtilityMenu = document.getElementById('btnUtilityMenu');
    if (btnUtilityMenu) {
      let _uPtId = null, _uHeld = false, _uTimer = null;
      btnUtilityMenu.addEventListener('pointerdown', ev => {
        if (_uPtId !== null) return;
        _uPtId = ev.pointerId; _uHeld = false;
        try { btnUtilityMenu.setPointerCapture(ev.pointerId); } catch (err) { /* degrade gracefully */ }
        _uTimer = setTimeout(() => { _uHeld = true; _openUtilitiesArc(); }, 350);
        ev.preventDefault();
      });
      btnUtilityMenu.addEventListener('pointermove', ev => {
        if (ev.pointerId !== _uPtId) return;
        if (_arcOpen === 'entries:utilities') _arcMove(ev.clientX, ev.clientY);
      });
      btnUtilityMenu.addEventListener('pointerup', ev => {
        if (ev.pointerId !== _uPtId) return;
        _uPtId = null;
        if (_uTimer) { clearTimeout(_uTimer); _uTimer = null; }
        if (_arcOpen === 'entries:utilities') _arcUp();
        _uHeld = false;
      });
      btnUtilityMenu.addEventListener('pointercancel', ev => {
        if (ev.pointerId !== _uPtId) return;
        _uPtId = null;
        if (_uTimer) { clearTimeout(_uTimer); _uTimer = null; }
        _clearArc(); _uHeld = false;
      });
    }
  }

  window.ActionArcUI = {
    init: (injectedDeps) => { init(injectedDeps); _bindListeners(); },
  };
})();
