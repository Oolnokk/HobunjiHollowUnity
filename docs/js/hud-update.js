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
  const BRONZE_BAR_SELL_FLOORS = Object.freeze({ // Used by applyLoreEconomy() to keep every ordinary bronze alloy dramatically more valuable than common gold.
    bar_lowTinBronze: 400,
    bar_tinBronze: 500,
    bar_highTinBronze: 650,
    bar_arsenicalBronze: 550,
    bar_leadedBronze: 450,
  });
  const pendingGoldDigTiles = new WeakSet(); // Used by the dig-contact hook to prevent repeated contact cues from paying twice for one hole.
  const loreEconomyDebug = { // Used by mobile-visible diagnostics through window.HobunjiLoreEconomy.getDebug().
    goldOreSellPrice: null,
    goldBarSellPrice: null,
    bronzeBarSellPrices: {},
    digHookInstalled: false,
    textObserverInstalled: false,
    textRewriteCount: 0,
    lastTextRewrite: null,
    lastDig: null,
  };
  let currencyTextObserver = null; // Used to normalize legacy currency wording produced by older shop/task modules without renaming their save-compatible `gold` fields.

  function firstFinite(...values) {
    for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
    return null;
  }

  function itemSellValue(def, fallback = 1) {
    const sell = firstFinite(def?.sellPrice, def?.sellValue, def?.value, def?.baseValue); // Used to read the same authored sale-value fields accepted elsewhere in the economy.
    if (sell != null && sell >= 0) return sell;
    const retail = firstFinite(def?.price, def?.buyPrice, def?.cost); // Used only when an item has a retail price but no explicit sale value.
    return retail != null && retail > 0 ? Math.max(1, Math.round(retail * 0.4)) : Math.max(1, Number(fallback) || 1);
  }

  function formatCurrencyText(value) {
    const original = String(value ?? ''); // Used as the exact rendered copy supplied by legacy systems before currency-lore normalization.
    let text = original;
    text = text.replace(/\bNot enough gold\b/gi, match => match[0] === 'N' ? 'Not enough gananji' : 'not enough gananji');
    text = text.replace(/\b(\d[\d,]*(?:\.\d+)?)\s+gold\b/gi, '$1 gananji');
    text = text.replace(/\bGold\s+(reward|wallet|currency|payment|payout|bounty|wages?)\b/g, 'Gananji $1');
    text = text.replace(/\bgold\s+(reward|wallet|currency|payment|payout|bounty|wages?|fee|cost)\b/g, 'gananji $1');
    text = text.replace(/\b(reward|fee|cost|price|payment|payout|bounty|wages?)\s+in\s+gold\b/gi, (match, noun) => `${noun} in gananji`);
    return text;
  }

  function rewriteCurrencyTextNode(node) {
    if (!node || node.nodeType !== 3 || typeof node.nodeValue !== 'string') return false;
    const before = node.nodeValue; // Used to preserve physical-metal wording whenever no currency-specific pattern matches.
    const after = formatCurrencyText(before); // Used to translate only unambiguous legacy money phrases into gananji.
    if (after === before) return false;
    node.nodeValue = after;
    loreEconomyDebug.textRewriteCount++;
    loreEconomyDebug.lastTextRewrite = { before, after, at: Date.now() };
    return true;
  }

  function rewriteCurrencySubtree(root) {
    if (!root) return 0;
    let changed = 0; // Used by diagnostics/tests to report how many visible text nodes were normalized.
    if (rewriteCurrencyTextNode(root)) changed++;
    const children = root.childNodes ? Array.from(root.childNodes) : [];
    for (const child of children) changed += rewriteCurrencySubtree(child);
    return changed;
  }

  function installCurrencyTextObserver() {
    if (currencyTextObserver) { loreEconomyDebug.textObserverInstalled = true; return true; }
    if (typeof MutationObserver !== 'function' || !document?.body) return false;
    rewriteCurrencySubtree(document.body); // Normalizes any static or already-rendered currency copy before watching future menus/toasts/dialogue.
    currencyTextObserver = new MutationObserver(records => {
      for (const record of records || []) {
        if (record.type === 'characterData') rewriteCurrencyTextNode(record.target);
        for (const node of record.addedNodes || []) rewriteCurrencySubtree(node);
      }
    });
    currencyTextObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    loreEconomyDebug.textObserverInstalled = true;
    return true;
  }

  function patchEconomyItem(itemKey, patch) {
    const existing = deps?.ITEM_DEFS?.[itemKey] || {}; // Used to preserve authored icons, categories, sprites, tags, and future metadata while changing lore/economy fields.
    if (!deps?.ITEM_DEFS) return null;
    deps.ITEM_DEFS[itemKey] = { ...existing, ...patch };
    return deps.ITEM_DEFS[itemKey];
  }

  function applyLoreEconomy() {
    if (!deps?.ITEM_DEFS) return false;
    const mulchSell = itemSellValue(deps.ITEM_DEFS.mulch, 1); // Used as the canonical baseline so Gold Ore always stays exactly one gananji above Mulch.
    const goldOreSell = Math.max(1, Math.round(mulchSell) + 1); // Used for physical Gold Ore, intentionally almost worthless despite its familiar name.
    const goldBarSell = Math.max(goldOreSell + 1, goldOreSell * 5 + 1); // Used for refined Gold Bars without restoring gold to prestige-metal pricing.

    patchEconomyItem('ore_gold', {
      label: deps.ITEM_DEFS.ore_gold?.label || 'Gold Ore',
      cat: deps.ITEM_DEFS.ore_gold?.cat || 'material',
      sellPrice: goldOreSell,
      desc: 'A very common soft metal turned up in ordinary soil. Around Hobunji, raw gold is worth only a little more than mulch.',
    });
    patchEconomyItem('bar_gold', {
      label: deps.ITEM_DEFS.bar_gold?.label || 'Gold Bar',
      cat: deps.ITEM_DEFS.bar_gold?.cat || 'material',
      sellPrice: goldBarSell,
      desc: 'Refined common gold. Easy to find, soft, and cheap; it carries none of bronze’s prestige or scarcity.',
    });
    const bronzeLabels = { // Used when a bronze bar definition is missing a label but still needs a complete player-facing economy entry.
      bar_lowTinBronze: 'Low-Tin Bronze Bar',
      bar_tinBronze: 'Tin Bronze Bar',
      bar_highTinBronze: 'High-Tin Bronze Bar',
      bar_arsenicalBronze: 'Arsenical Bronze Bar',
      bar_leadedBronze: 'Leaded Bronze Bar',
    };
    for (const [itemKey, floor] of Object.entries(BRONZE_BAR_SELL_FLOORS)) {
      const existing = deps.ITEM_DEFS[itemKey] || {}; // Used to retain any authored value above the lore floor rather than accidentally nerfing an already rarer bronze alloy.
      const sellPrice = Math.max(floor, itemSellValue(existing, floor)); // Used to enforce bronze’s high-value floor while preserving intentionally higher authored prices.
      patchEconomyItem(itemKey, {
        label: existing.label || bronzeLabels[itemKey],
        cat: existing.cat || 'material',
        sellPrice,
        desc: 'High-value bronze: scarce, prestigious, and trusted as a store of wealth. Finished bronze is worth vastly more than common gold.',
      });
      loreEconomyDebug.bronzeBarSellPrices[itemKey] = sellPrice;
    }

    loreEconomyDebug.goldOreSellPrice = goldOreSell;
    loreEconomyDebug.goldBarSellPrice = goldBarSell;
    window.HobunjiCurrencyLore = Object.freeze({ // Used as the canonical player-facing interpretation of the legacy inventory.gold save key.
      storageKey: 'gold',
      name: 'gananji',
      meaning: 'bronze',
      suffix: 'g',
      formatText: formatCurrencyText,
      rewriteSubtree: rewriteCurrencySubtree,
      installTextObserver: installCurrencyTextObserver,
    });
    return true;
  }

  function grantDugGoldOre(watch) {
    const itemKey = 'ore_gold'; // Used as the physical ore stack; deliberately distinct from legacy inventory.gold, which stores gananji currency.
    const before = Math.max(0, Number(deps?.inventory?.[itemKey]) || 0); // Used to respect the ordinary 99-item stack cap.
    if (before >= 99) {
      deps?.showToast?.('Gold Ore stack is full.', false);
      loreEconomyDebug.lastDig = { area: watch.area, col: watch.col, row: watch.row, granted: 0, reason: 'stack-full', at: Date.now() };
      return 0;
    }
    deps.inventory[itemKey] = Math.min(99, before + 1);
    deps?.clampInventoryStack?.(itemKey);
    deps?.showToast?.('Dug up 1 Gold Ore.', true);
    deps?.buildInventoryGrid?.();
    deps?.saveMemberWorldData?.();
    loreEconomyDebug.lastDig = { area: watch.area, col: watch.col, row: watch.row, granted: 1, before, after: deps.inventory[itemKey], at: Date.now() };
    window.__farmLog?.(`[economy] fresh hole yielded 1 Gold Ore at ${watch.area || '?'} ${watch.col},${watch.row}`, 'economy');
    return 1;
  }

  function verifyFreshDig(watch, attempt = 0) {
    if (!watch?.tile) return;
    if (watch.tile.type === deps?.TileType?.TRENCH) {
      pendingGoldDigTiles.delete(watch.tile);
      grantDugGoldOre(watch);
      return;
    }
    if (attempt >= 12) {
      pendingGoldDigTiles.delete(watch.tile);
      loreEconomyDebug.lastDig = { area: watch.area, col: watch.col, row: watch.row, granted: 0, reason: 'no-trench-transition', at: Date.now() };
      return;
    }
    setTimeout(() => verifyFreshDig(watch, attempt + 1), 40);
  }

  function installGoldDigHook() {
    const audio = window.AudioSystem; // Used as the existing shovel contact boundary; the reward still verifies the authoritative tile mutation before paying out.
    if (!audio?.playObjectSfxKey) return false;
    if (audio.__hobunjiGoldDigEconomyHook) { loreEconomyDebug.digHookInstalled = true; return true; }
    const originalPlayObjectSfxKey = audio.playObjectSfxKey.bind(audio); // Used to preserve every existing configured sound and the dew-specific override chain.
    audio.playObjectSfxKey = function loreAwareObjectSfxKey(key, ...args) {
      let watch = null; // Used only for a non-trench tile targeted at the moment an actual dig contact cue fires.
      if (key === 'dig' && deps?.getReticleTile && deps?.getActiveTileAt && deps?.TileType) {
        const reticle = deps.getReticleTile(); // Used to capture the exact gameplay target before the shovel mutation occurs.
        const tile = reticle ? deps.getActiveTileAt(reticle.col, reticle.row) : null; // Used as the authoritative mutable tile object checked after contact.
        if (tile && tile.type !== deps.TileType.TRENCH && !pendingGoldDigTiles.has(tile)) {
          pendingGoldDigTiles.add(tile);
          watch = { tile, col: reticle.col, row: reticle.row, area: deps.getCurrentArea?.() || null };
        }
      }
      const result = originalPlayObjectSfxKey(key, ...args);
      if (watch) setTimeout(() => verifyFreshDig(watch, 0), 0);
      return result;
    };
    audio.__hobunjiGoldDigEconomyHook = true;
    loreEconomyDebug.digHookInstalled = true;
    return true;
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    applyLoreEconomy();
    installGoldDigHook();
    installCurrencyTextObserver();
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
  // most (season/weather/day/gananji on world-state events, time once a
  // simulated minute, tool/tile/water on reticle or equip changes) —
  // updateHud runs every frame, so each field caches its last-written
  // string/color and skips the DOM write (and, for spTile/spWater, the
  // string-building) when nothing changed.
  const _hud = { season: null, weather: null, time: null, day: null, tool: null, tile: null, waterText: null, waterColor: null, gold: null, item: null };

  function updateHud() {
    if (!loreEconomyDebug.digHookInstalled) installGoldDigHook();
    if (!loreEconomyDebug.textObserverInstalled) installCurrencyTextObserver();
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

  window.HobunjiLoreEconomy = { // Exposes concise mobile-safe state without requiring devtools or console access.
    apply: applyLoreEconomy,
    installGoldDigHook,
    formatCurrencyText,
    installCurrencyTextObserver,
    getDebug: () => ({ ...loreEconomyDebug, bronzeBarSellPrices: { ...loreEconomyDebug.bronzeBarSellPrices } }),
    formatDebug: () => `Lore economy: Gold Ore ${loreEconomyDebug.goldOreSellPrice ?? '?'}g | Gold Bar ${loreEconomyDebug.goldBarSellPrice ?? '?'}g | dig hook ${loreEconomyDebug.digHookInstalled ? 'on' : 'off'} | text ${loreEconomyDebug.textObserverInstalled ? 'on' : 'off'} (${loreEconomyDebug.textRewriteCount}) | last dig ${loreEconomyDebug.lastDig ? JSON.stringify(loreEconomyDebug.lastDig) : 'none'}`,
  };

  window.HudUpdate = {
    init, refreshKeyHud, contextualActionLabel, refreshItemScroll, updateHud,
  };
})();