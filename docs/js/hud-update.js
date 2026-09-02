(() => {
  'use strict';

  // Key HUD row, item-scroll widget, and the per-frame status-pill HUD
  // refresh, extracted out of game.js following the same window.<Namespace>
  // + init(deps) pattern as its siblings. Audited every reference first:
  // grid/activeTool/heldMode/activeAction/currentArea/menuOpen/
  // activeItemIndex are all game.js `let`s reassigned elsewhere, so they're
  // threaded as getters (activeItemIndex also needs the setter this cluster
  // itself uses, reusing the exact getActiveItemIndex/setActiveItemIndex
  // names already established for other modules). equipmentSlots/
  // TOOL_ITEM_DEFS/inventory/tileStyles/calendar/ITEM_DEFS are `const`s only
  // ever mutated in place, so they're passed by direct reference.
  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    deps.itemPrev.addEventListener('click', () => {
      deps.cycleActiveInventoryItem(-1);
      refreshItemScroll();
      deps.refreshActionBar();
    });
    deps.itemNext.addEventListener('click', () => {
      deps.cycleActiveInventoryItem(1);
      refreshItemScroll();
      deps.refreshActionBar();
    });
  }

  function refreshKeyHud(btns) {
    if (!deps.keyHudEl) return;
    const item = deps.getActiveInventoryItem();
    const reticle = deps.getReticleTile();
    const tile = deps.getGrid()[reticle.row][reticle.col];
    const obj  = deps.getWorldObjectAt(reticle.col, reticle.row);

    const parts = [];

    // Tool
    const activeTool = deps.getActiveTool();
    const _eqItem = deps.equipmentSlots[activeTool];
    const _eqDef  = _eqItem ? deps.TOOL_ITEM_DEFS[_eqItem] : null;
    const _khFallback = ({ shovel:['⛏️','Shovel'], hoe:['🪓','Hoe'], axe:['🪓','Axe'], pick:['⛏️','Pick'], harpoon:['🎣','Harpoon'], weapon:['🗡️','Weapon'], machete:['🗡️','Weapon'] }[activeTool] || ['🔧', activeTool]);
    const toolInfo = [deps.toolSelectIconHTML(_eqDef, _khFallback[0], '13px'), _eqDef?.label || _khFallback[1]];
    parts.push(`<div class="kh-group"><span class="kh-key">1/2/3</span><span class="kh-tool">${toolInfo[0]} ${toolInfo[1]}</span></div>`);
    parts.push('<div class="kh-div"></div>');

    // Action buttons → key prompts: first = [Space/E], second = [Q]
    btns.forEach((b, idx) => {
      const keyLabel = idx === 0 ? 'E' : idx === 1 ? 'Q' : `F${idx}`;
      const blocked  = !b.allowed;
      parts.push(
        `<div class="kh-group">` +
        `<span class="kh-key${blocked ? '" style="opacity:0.35' : ''}">${keyLabel}</span>` +
        `<span class="kh-action ${b.style}${blocked ? ' blocked' : ''}">${b.icon} ${b.label}</span>` +
        `</div>`
      );
    });

    parts.push('<div class="kh-div"></div>');

    // Item scroll
    if (item) {
      const count = deps.inventory[item.key] || 0;
      parts.push(
        `<div class="kh-group">` +
        `<span class="kh-key">,</span><span class="kh-label"> </span>` +
        `<span class="kh-item"><span class="kh-item-icon">${item.icon}</span> ${item.label} ×${count}</span>` +
        `<span class="kh-label"> </span><span class="kh-key">.</span>` +
        `</div>`
      );
    }

    parts.push('<div class="kh-div"></div>');

    // Tile info
    const tileStyle = deps.tileStyles[tile.type] || deps.tileStyles.grass;
    const waterPct  = Math.round((tile.water / deps.MAX_WATER) * 100);
    parts.push(
      `<div class="kh-group">` +
      `<span class="kh-label">${tileStyle.label}` +
      (obj ? ` · ${obj.label}` : '') +
      ` · 💧${waterPct}%</span>` +
      `</div>`
    );

    parts.push('<div class="kh-div"></div>');
    parts.push('<div class="kh-group"><span class="kh-key">Esc</span><span class="kh-label">Menu</span></div>');

    deps.keyHudEl.innerHTML = parts.join('');
    if (item) {
      deps.applyItemSpriteIcon(deps.keyHudEl.querySelector('.kh-item-icon'), deps.ITEM_DEFS[item.key], item.key);
    }
  }

  function contextualActionLabel(action, tile) {
    if (action === 'dig')   return tile.type === deps.TileType.TRENCH ? 'Redig' : 'Dig';
    if (action === 'fill')  return 'Fill';
    if (action === 'raise') return tile.type === deps.TileType.RAISED ? 'Lower' : 'Raise';
    if (action === 'till')  return tile.type === deps.TileType.TILLED ? 'Untill' : 'Till';
    if (action === 'smooth') return 'Smooth';
    if (action === 'cut')   return 'Cut';
    if (action === 'slash') return 'Slash 3×';
    if (action === 'chop')  return 'Chop';
    if (action === 'hack')  return 'Hack 3×';
    if (action === 'mine')  return 'Mine';
    if (action === 'harvest') return tile.cropReady ? '✓ Harvest' : 'Growing';
    if (action === 'fish') return 'Fish';
    if (action === 'shoot') return window.RangedWeapons?.playerActionLabel?.(deps.equipmentSlots.ranged) || 'Fire';
    if (action === 'ammo_select') return window.RangedWeapons?.ammoActionLabel?.(deps.equipmentSlots.ranged) || 'Basic Ammo';
    if (action === 'potion_select') return 'Potions';
    if (action.startsWith('place_')) return 'Place';
    if (action.startsWith('obj_process_')) return 'Process';
    return action;
  }

  // ── Item scroll ────────────────────────────────────────
  let _lastItemScrollKey = null;
  function refreshItemScroll(stacks = deps.getInventoryStackItems()) {
    const n = stacks.length;
    const iBtnEl = deps.itemBtnEl;
    if (n === 0) {
      if (_lastItemScrollKey === 'empty') return;
      _lastItemScrollKey = 'empty';
      deps.itemIcon.textContent  = '□';
      deps.itemName.textContent  = 'EMPTY';
      deps.itemCount.textContent = '×0';
      deps.itemCount.className   = 'is-count empty';
      if (iBtnEl) iBtnEl.textContent = '□';
      const prevEl = deps.isPrevIconEl;
      const nextEl = deps.isNextIconEl;
      deps.clearItemSpriteIcon(deps.itemIcon);
      deps.clearItemSpriteIcon(iBtnEl);
      if (prevEl) prevEl.textContent = '□';
      if (nextEl) nextEl.textContent = '□';
      deps.clearItemSpriteIcon(prevEl);
      deps.clearItemSpriteIcon(nextEl);
      return;
    }
    let activeItemIndex = deps.getActiveItemIndex();
    if (activeItemIndex >= n) { activeItemIndex = 0; deps.setActiveItemIndex(0); }
    if (activeItemIndex < 0) { activeItemIndex = n - 1; deps.setActiveItemIndex(n - 1); }
    const curr = stacks[activeItemIndex];
    const prev = stacks[(activeItemIndex - 1 + n) % n];
    const next = stacks[(activeItemIndex + 1) % n];
    const count = deps.inventory[curr.key] || 0;
    const key = `${curr.key}:${count}:${prev.key}:${next.key}`;
    if (key === _lastItemScrollKey) return;
    _lastItemScrollKey = key;
    // Current item
    deps.itemIcon.textContent  = curr.icon;
    deps.itemName.textContent  = curr.label;
    if (iBtnEl) iBtnEl.textContent = curr.icon;
    deps.applyItemSpriteIcon(deps.itemIcon, deps.ITEM_DEFS[curr.key], curr.key);
    deps.applyItemSpriteIcon(iBtnEl, deps.ITEM_DEFS[curr.key], curr.key);
    deps.itemCount.textContent = `×${count}`;
    deps.itemCount.className   = 'is-count' + (count === 0 ? ' empty' : '');
    // Peek icons (prev/next previews)
    const prevEl = deps.isPrevIconEl;
    const nextEl = deps.isNextIconEl;
    if (prevEl) {
      prevEl.textContent = prev.icon;
      deps.applyItemSpriteIcon(prevEl, deps.ITEM_DEFS[prev.key], prev.key);
    }
    if (nextEl) {
      nextEl.textContent = next.icon;
      deps.applyItemSpriteIcon(nextEl, deps.ITEM_DEFS[next.key], next.key);
    }
  }

  // Status-pill fields only actually change a few times a (real) second at
  // most (season/weather/day/gold on world-state events, time once a
  // simulated minute, tool/tile/water on reticle or equip changes) —
  // updateHud runs every frame, so each field caches its last-written
  // string/color and skips the DOM write (and, for spTile/spWater, the
  // string-building) when nothing changed.
  const _hud = { season: null, weather: null, time: null, day: null, tool: null, tile: null, waterText: null, waterColor: null, gold: null, item: null };

  function updateHud() {
    const season = window.CalendarSystem.currentSeason();
    const clock  = window.FormatUtils.formatClock(window.CalendarSystem.getHour());

    // Season (changes slowly)
    const seasonText = season.emoji + ' ' + season.name;
    if (seasonText !== _hud.season) { _hud.season = seasonText; deps.spSeason.textContent = seasonText; }

    // Current weather + precipitation rate
    let weatherText, precipText;
    if (deps.calendar.isRaining) {
      const str = deps.calendar.rainStrength;
      if (str >= 3) {
        weatherText = '⛈️ Storm';
        precipText  = '⬇️ heavy';
      } else {
        weatherText = '🌧️ Rain';
        // RAIN_RATE * str * ticks/hr ≈ mm equivalent display
        const mmEq  = (deps.RAIN_RATE * str * 51).toFixed(1); // ~51 ticks/hr at 0.7s/tick
        precipText  = `⬇️ ${mmEq}mm/hr`;
      }
    } else {
      weatherText = deps.calendar.weather === 'clear' ? '☀️ Clear' : '🌤️ Dry';
      precipText  = '⬇️ none';
    }
    const weatherFull = weatherText + ' ' + precipText;
    if (weatherFull !== _hud.weather) { _hud.weather = weatherFull; deps.spWeather.textContent = weatherFull; }

    if (clock !== _hud.time) { _hud.time = clock; deps.spTime.textContent = clock; }
    if (deps.spDay) {
      const dayText = window.CalendarSystem.formatCalendarDate();
      if (dayText !== _hud.day) { _hud.day = dayText; deps.spDay.textContent = dayText; }
    }
    const toolText = deps.getHeldMode() === 'none' ? '✋ Hands free' : window.FormatUtils.toolEmoji(deps.getActiveTool()) + ' ' + window.FormatUtils.actionName(deps.getActiveAction());
    if (toolText !== _hud.tool) { _hud.tool = toolText; deps.spTool.textContent = toolText; }

    // Reticle tile info
    const reticle  = deps.getReticleTile();
    const tile     = deps.getActiveTileAt(reticle.col, reticle.row);
    const tStyle   = deps.tileStyles[tile.type] || deps.tileStyles.grass;
    const cropStr  = tile.crop ? ` · ${tile.crop}${tile.cropReady ? ' ✓' : ''}` : '';
    const tileText = (deps.getCurrentArea() === 'interior' ? '🏠 ' : '') + tStyle.label + cropStr;
    if (tileText !== _hud.tile) { _hud.tile = tileText; deps.spTile.textContent = tileText; }

    const waterPct = Math.round((tile.water / deps.MAX_WATER) * 100);
    const depthStr = tile.water > 0.01 ? `${waterPct}%` : 'dry';
    const waterText = '💧 ' + depthStr;
    if (waterText !== _hud.waterText) { _hud.waterText = waterText; deps.spWater.textContent = waterText; }
    const waterColor = waterPct > 80 ? '#4488ff'
                      : waterPct > 40 ? '#6ec6f0'
                      : waterPct > 10 ? '#aaddee' : '#888';
    if (waterColor !== _hud.waterColor) { _hud.waterColor = waterColor; deps.spWater.style.color = waterColor; }
    if (deps.spGoldAmount && deps.inventory.gold !== _hud.gold) { _hud.gold = deps.inventory.gold; deps.spGoldAmount.textContent = deps.inventory.gold; }

    // Computed once and threaded through below instead of letting
    // refreshItemScroll/refreshActionBar (and the desktop item pill) each
    // re-filter-and-sort the whole inventory from scratch — this runs every
    // frame, and inventory contents don't change nearly that often.
    const stacks = deps.getInventoryStackItems();

    // Desktop: show active item in status pill (item scroll is hidden)
    if (deps.isDesktop) {
      const item = deps.getActiveInventoryItem(stacks);
      if (deps.spItem && item) {
        deps.spItem.style.display = '';
        deps.spItemDiv.style.display = '';
        const itemText = '[Tab] ' + item.icon + ' ' + item.label + ' ×' + (deps.inventory[item.key] || 0);
        if (itemText !== _hud.item) { _hud.item = itemText; deps.spItem.textContent = itemText; }
      }
    }

    refreshItemScroll(stacks);
    // refreshActionBar is called after actions and on tool/item change; the
    // dirty-key check makes it cheap to call here too for reticle updates
    deps.refreshActionBar(stacks);
    if (deps.isMenuOpen()) {
      // Keep wallet display live while menu is open
      const wd = document.getElementById('invWalletAmount');
      if (wd) wd.textContent = (deps.inventory.gold || 0);
    }
  }

  window.HudUpdate = {
    init, refreshKeyHud, contextualActionLabel, refreshItemScroll, updateHud,
  };
})();
