(() => {
  'use strict';

  if (Number(window.InventoryGearCompactEffects?.version) >= 1) return;

  const VERSION = 1;
  const STYLE_ID = 'inventoryGearCompactEffectsStyles'; // Keeps the compact Gear-effects presentation idempotent across repeated inventory rebuilds.
  const TOOL_MAX_FONT_PX = 10.5; // Upper bound used when a Tool Effects card has plenty of room.
  const CHARACTER_MAX_FONT_PX = 11; // Upper bound used by Outfit Effects / Final Values.
  const PREFERRED_MIN_FONT_PX = 5.5; // Preferred compact floor before the measured fitter enters emergency shrinking.
  const EMERGENCY_MIN_FONT_PX = 1.5; // Last-resort floor used only when an extreme aspect ratio would otherwise clip real content.

  let observedLoadout = null; // Tracks the current loadout root; EquipmentPanel can rebuild it at runtime.
  let loadoutResizeObserver = null; // Re-fits cards whenever orientation/menu geometry changes.
  let inventoryMutationObserver = null; // Watches Gear rebuilds and InventoryUI's temporary readability-floor annotations.
  let fitQueued = false; // Coalesces rebuild/resize bursts into one measured layout pass.
  let lastDebug = null; // Mobile-friendly snapshot of the most recent fit pass.

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Always reserve a visible lower Gear region. The compact upper loadout gets the remainder instead of squeezing Owned Gear to zero height. */
      #mpInventory.inv-mode-gear .gear-loadout-grid {
        flex:1 1 auto;
        min-height:0;
        height:auto;
        max-height:none;
        overflow:hidden;
        margin-bottom:calc(.45 * var(--inv-gap));
      }
      #mpInventory.inv-mode-gear .gear-owned-section {
        flex:0 0 calc(5.25 * var(--inv-row));
        min-height:calc(5.25 * var(--inv-row));
        max-height:calc(5.25 * var(--inv-row));
        box-sizing:border-box;
        overflow-y:auto;
        overflow-x:hidden;
        scrollbar-width:thin;
      }

      /* Tool Effects divides its real rendered height between cards according to how much content each card owns. */
      #mpInventory .gear-tool-stats {
        min-height:0;
        padding:calc(.28 * var(--inv-gap));
        overflow:hidden;
      }
      #mpInventory .gear-tool-stats > .gear-loadout-heading {
        flex:0 0 auto;
        min-height:calc(1.05 * var(--inv-row));
      }
      #mpInventory .gear-tool-stats > .gear-stat-list {
        flex:1 1 auto;
        min-height:0;
        display:flex !important;
        flex-direction:column !important;
        gap:1px !important;
        overflow:hidden !important;
      }
      #mpInventory .gear-tool-stats .gear-stat-item {
        flex:var(--gear-tool-card-weight,1) 1 0;
        min-height:0;
        padding:1px 2px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        overflow:hidden;
        border-radius:calc(.55 * var(--inv-radius));
      }
      #mpInventory .gear-tool-stats .gear-stat-item-head {
        flex:0 0 auto;
        min-width:0;
        min-height:0;
        gap:2px;
        line-height:.9;
      }
      #mpInventory .gear-tool-stats .gear-stat-slot,
      #mpInventory .gear-tool-stats .gear-stat-name,
      #mpInventory .gear-tool-stats .gear-stat-chip {
        font-size:var(--gear-tool-card-font,9px) !important;
        line-height:.9 !important;
      }
      #mpInventory .gear-tool-stats .gear-stat-slot { letter-spacing:.025em; }
      #mpInventory .gear-tool-stats .gear-stat-name {
        min-width:0;
        overflow:hidden;
        text-overflow:clip;
        white-space:nowrap;
      }
      #mpInventory .gear-tool-stats .gear-stat-chips {
        flex:0 1 auto;
        min-height:0;
        display:flex;
        flex-direction:column;
        flex-wrap:nowrap;
        align-items:flex-start;
        gap:0;
        margin-top:1px;
        overflow:hidden;
      }
      #mpInventory .gear-tool-stats .gear-stat-chip {
        max-width:100%;
        padding:0 2px;
        border-radius:999px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:clip;
      }
      #mpInventory .gear-tool-stats .gear-stats-empty {
        flex:0 0 auto;
        font-size:9px;
        line-height:1.05;
      }

      /* Outfit Effects / Final Values also have to survive portrait width. Give the denser card more height and fit its rows from measured pixels, not an assumed line count. */
      #mpInventory .gear-outfit-stats.gear-character-effects-host {
        display:flex !important;
        flex-direction:column !important;
        min-height:0 !important;
        overflow:hidden !important;
      }
      #mpInventory .gear-outfit-stats .gear-character-effects-card {
        flex:var(--gear-character-card-weight,1) 1 0 !important;
        min-height:0 !important;
        overflow:hidden !important;
        padding:1px 2px !important;
      }
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-loadout-heading {
        flex:0 0 auto;
        min-height:0 !important;
        font-size:var(--gear-character-card-font,9px) !important;
        line-height:1 !important;
      }
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-effects-list {
        flex:1 1 auto !important;
        min-height:0 !important;
        gap:1px 2px !important;
        overflow:hidden !important;
      }
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-effect-row,
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-effect-label,
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-effect-value {
        font-size:var(--gear-character-card-font,9px) !important;
        line-height:.95 !important;
      }
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-effect-row {
        min-height:0;
        padding:0 1px !important;
        gap:2px !important;
        overflow:hidden;
      }
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-effect-label,
      #mpInventory .gear-outfit-stats .gear-character-effects-card .gear-effect-value {
        white-space:nowrap !important;
        overflow:hidden;
        text-overflow:clip;
      }
    `;
    document.head?.appendChild(style);
  }

  function releaseInventoryFontFloor(root) {
    if (!root) return 0;
    let released = 0;
    root.querySelectorAll('[data-menu-font-floor="1"]').forEach((element) => {
      element.style.removeProperty('font-size'); // The compact upper Gear readout deliberately resizes below the menu-wide 11px floor when orientation leaves less room.
      delete element.dataset.menuFontFloor;
      released += 1;
    });
    return released;
  }

  function toolCardUnits(card) {
    const chips = card?.querySelectorAll?.('.gear-stat-chip')?.length || 0; // Each chip is deliberately one stacked line.
    return Math.max(1, 1 + chips); // One heading line plus one unit per mastery/quality/effect chip.
  }

  function characterCardUnits(card) {
    const rows = card?.querySelectorAll?.('.gear-effect-row')?.length || 0;
    return Math.max(1, 1 + Math.ceil(rows / 2)); // One heading line plus the actual two-column grid row count.
  }

  function visibleTextFits(card, selectors) {
    if (!card || card.clientHeight <= 0 || card.clientWidth <= 0) return true;
    if (card.scrollHeight > card.clientHeight + 0.75) return false;
    for (const element of card.querySelectorAll(selectors)) {
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 0.75) return false;
      if (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 0.75) return false;
    }
    return true;
  }

  function fitMeasuredFont(card, variableName, maxFontPx, selectors) {
    const setFont = (fontPx) => card.style.setProperty(variableName, `${fontPx.toFixed(2)}px`);
    setFont(maxFontPx);
    if (visibleTextFits(card, selectors)) return maxFontPx;

    let lowestFit = PREFERRED_MIN_FONT_PX;
    setFont(lowestFit);
    while (!visibleTextFits(card, selectors) && lowestFit > EMERGENCY_MIN_FONT_PX + 0.01) {
      lowestFit = Math.max(EMERGENCY_MIN_FONT_PX, lowestFit * 0.78); // Measured emergency shrink handles narrow portrait widths without clipping text.
      setFont(lowestFit);
    }
    if (!visibleTextFits(card, selectors)) return lowestFit;

    let low = lowestFit;
    let high = maxFontPx;
    for (let i = 0; i < 8; i++) { // Binary search finds the largest font that truly fits the rendered card in this orientation.
      const mid = (low + high) * 0.5;
      setFont(mid);
      if (visibleTextFits(card, selectors)) low = mid;
      else high = mid;
    }
    setFont(low);
    return low;
  }

  function fitToolPanel(panel) {
    const list = panel?.querySelector?.(':scope > .gear-stat-list');
    const cards = [...(list?.querySelectorAll?.(':scope > .gear-stat-item') || [])];
    if (!list || !cards.length) return { cardCount:cards.length, listHeight:list?.getBoundingClientRect?.().height || 0, cards:[] };

    cards.forEach((card) => card.style.setProperty('--gear-tool-card-weight', String(toolCardUnits(card))));
    const cardDebug = cards.map((card) => ({
      units:toolCardUnits(card),
      fontPx:Number(fitMeasuredFont(card, '--gear-tool-card-font', TOOL_MAX_FONT_PX, '.gear-stat-slot,.gear-stat-name,.gear-stat-chip').toFixed(2)),
      height:Number(card.getBoundingClientRect().height.toFixed(2)),
    }));
    return { cardCount:cards.length, listHeight:Number(list.getBoundingClientRect().height.toFixed(2)), cards:cardDebug };
  }

  function fitCharacterPanel(panel) {
    const cards = [...(panel?.querySelectorAll?.(':scope > .gear-character-effects-card') || [])];
    if (!cards.length) return { cardCount:0, cards:[] };

    cards.forEach((card) => card.style.setProperty('--gear-character-card-weight', String(characterCardUnits(card))));
    const cardDebug = cards.map((card) => ({
      kind:card.dataset.effectsKind || '',
      units:characterCardUnits(card),
      fontPx:Number(fitMeasuredFont(card, '--gear-character-card-font', CHARACTER_MAX_FONT_PX, '.gear-loadout-heading,.gear-effect-label,.gear-effect-value').toFixed(2)),
      height:Number(card.getBoundingClientRect().height.toFixed(2)),
    }));
    return { cardCount:cards.length, height:Number(panel.getBoundingClientRect().height.toFixed(2)), cards:cardDebug };
  }

  function fitGearEffects() {
    fitQueued = false;
    if (typeof document === 'undefined') return null;
    const loadout = document.querySelector('#mpInventory .gear-loadout-grid');
    if (!loadout) return null;
    hookLoadout(loadout);

    const releasedFloors = releaseInventoryFontFloor(loadout);
    const tool = fitToolPanel(loadout.querySelector('.gear-tool-stats'));
    const character = fitCharacterPanel(loadout.querySelector('.gear-outfit-stats'));
    const owned = document.querySelector('#mpInventory .gear-owned-section');

    lastDebug = {
      releasedFloors,
      loadoutHeight:Number(loadout.getBoundingClientRect().height.toFixed(2)),
      ownedHeight:Number((owned?.getBoundingClientRect?.().height || 0).toFixed(2)),
      viewport:[window.innerWidth || 0, window.innerHeight || 0],
      tool,
      character,
    };
    return lastDebug;
  }

  function scheduleFit() {
    if (fitQueued || typeof requestAnimationFrame !== 'function') return;
    fitQueued = true;
    requestAnimationFrame(fitGearEffects);
  }

  function hookLoadout(loadout) {
    if (!loadout || loadout === observedLoadout) return;
    loadoutResizeObserver?.disconnect?.();
    observedLoadout = loadout;
    loadoutResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFit) : null;
    loadoutResizeObserver?.observe?.(loadout);
    const toolPanel = loadout.querySelector('.gear-tool-stats');
    const characterPanel = loadout.querySelector('.gear-outfit-stats');
    if (toolPanel) loadoutResizeObserver?.observe?.(toolPanel);
    if (characterPanel) loadoutResizeObserver?.observe?.(characterPanel);
  }

  function start() {
    installStyles();
    const pane = document.getElementById('mpInventory');
    if (!pane) return;

    inventoryMutationObserver = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (record.type === 'childList') return true;
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        return !!target?.closest?.('.gear-loadout-grid');
      });
      if (relevant) scheduleFit();
    });
    inventoryMutationObserver.observe(pane, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['data-menu-font-floor'],
    });
    window.addEventListener?.('resize', scheduleFit, { passive:true }); // Orientation changes surface here on mobile browsers.
    window.addEventListener?.('orientationchange', scheduleFit, { passive:true });
    scheduleFit();
  }

  function debugSnapshot() {
    return {
      version:VERSION,
      loadoutReady:!!observedLoadout?.isConnected,
      lastFit:lastDebug ? JSON.parse(JSON.stringify(lastDebug)) : null,
    };
  }

  window.InventoryGearCompactEffects = Object.freeze({ version:VERSION, refresh:fitGearEffects, debugSnapshot });
  window.__inventoryGearCompactEffectsDebug = debugSnapshot;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
    else start();
  }
})();