(() => {
  'use strict';

  if (Number(window.InventoryGearCompactEffects?.version) >= 1) return;

  const VERSION = 1;
  const STYLE_ID = 'inventoryGearCompactEffectsStyles'; // Keeps the compact Tool Effects presentation idempotent across repeated inventory rebuilds.
  const MIN_EFFECT_FONT_PX = 5.5; // Hard floor for the slot-aligned readout when many chips must share one short card.
  const MAX_EFFECT_FONT_PX = 10.5; // Keeps a sparse Tool Effects list visually subordinate to the main inventory labels.

  let observedPanel = null; // Tracks the currently rendered Tool Effects panel; EquipmentPanel can replace it during rebuilds.
  let panelResizeObserver = null; // Re-fits cards when menu size/aspect changes without polling every frame.
  let inventoryMutationObserver = null; // Watches gear rebuilds and InventoryUI's temporary readability-floor annotations.
  let fitQueued = false; // Coalesces rebuild/resize bursts into one layout measurement.
  let lastDebug = null; // Mobile-friendly snapshot of the most recent fit pass.

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Always reserve a visible lower Gear region. The compact upper loadout gets the remainder instead of being allowed to squeeze Owned Gear to zero height. */
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

      /* Tool Effects shares the current-loadout height with the seven slot buttons beside it. Its cards therefore divide the available height instead of growing from content. */
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
        flex:1 1 0;
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
        font-size:var(--gear-tool-card-font, 9px) !important;
        line-height:.9 !important;
      }
      #mpInventory .gear-tool-stats .gear-stat-slot {
        letter-spacing:.025em;
      }
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
    `;
    document.head?.appendChild(style);
  }

  function releaseInventoryFontFloor(panel) {
    if (!panel) return 0;
    let released = 0;
    panel.querySelectorAll('[data-menu-font-floor="1"]').forEach((element) => {
      element.style.removeProperty('font-size'); // InventoryUI normally enforces 11px globally; this compact readout is intentionally allowed to shrink to fit its fixed loadout column.
      delete element.dataset.menuFontFloor;
      released += 1;
    });
    return released;
  }

  function cardLineCount(card) {
    const chips = card?.querySelectorAll?.('.gear-stat-chip')?.length || 0; // Each chip is deliberately stacked on its own compact line.
    return Math.max(1, 1 + chips); // One heading line plus one line for each mastery/quality/effect chip.
  }

  function fitToolEffects() {
    fitQueued = false;
    if (typeof document === 'undefined') return null;
    const panel = document.querySelector('#mpInventory .gear-tool-stats');
    if (!panel) return null;
    hookPanel(panel);

    const releasedFloors = releaseInventoryFontFloor(panel);
    const list = panel.querySelector(':scope > .gear-stat-list');
    const cards = [...(list?.querySelectorAll?.(':scope > .gear-stat-item') || [])];
    if (!list || !cards.length) {
      lastDebug = { cardCount: cards.length, releasedFloors, listHeight: list?.getBoundingClientRect?.().height || 0, cards: [] };
      return lastDebug;
    }

    const listHeight = Math.max(0, list.getBoundingClientRect().height); // Real rendered height keeps this responsive to desktop/mobile menu geometry.
    const sharedCardHeight = Math.max(1, (listHeight - Math.max(0, cards.length - 1)) / cards.length); // One-pixel list gaps are already reserved above.
    const cardDebug = [];

    for (const card of cards) {
      const lines = cardLineCount(card);
      const usableHeight = Math.max(1, sharedCardHeight - 2); // Leaves the card's one-pixel top/bottom padding outside the text budget.
      const fontPx = Math.max(MIN_EFFECT_FONT_PX, Math.min(MAX_EFFECT_FONT_PX, usableHeight / Math.max(1, lines * 0.96)));
      card.style.setProperty('--gear-tool-card-font', `${fontPx.toFixed(2)}px`); // Per-card sizing lets a simple tool stay larger while a chip-heavy tool compresses farther.
      cardDebug.push({ lines, fontPx:Number(fontPx.toFixed(2)), sharedCardHeight:Number(sharedCardHeight.toFixed(2)) });
    }

    lastDebug = {
      cardCount: cards.length,
      releasedFloors,
      listHeight:Number(listHeight.toFixed(2)),
      sharedCardHeight:Number(sharedCardHeight.toFixed(2)),
      cards:cardDebug,
    };
    return lastDebug;
  }

  function scheduleFit() {
    if (fitQueued || typeof requestAnimationFrame !== 'function') return;
    fitQueued = true;
    requestAnimationFrame(fitToolEffects);
  }

  function hookPanel(panel) {
    if (!panel || panel === observedPanel) return;
    panelResizeObserver?.disconnect?.();
    observedPanel = panel;
    panelResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFit) : null;
    panelResizeObserver?.observe?.(panel);
  }

  function start() {
    installStyles();
    const pane = document.getElementById('mpInventory');
    if (!pane) return;

    inventoryMutationObserver = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (record.type === 'childList') return true;
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        return !!target?.closest?.('.gear-tool-stats');
      });
      if (relevant) scheduleFit();
    });
    inventoryMutationObserver.observe(pane, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['data-menu-font-floor'],
    });
    window.addEventListener?.('resize', scheduleFit, { passive:true });
    scheduleFit();
  }

  function debugSnapshot() {
    return {
      version:VERSION,
      panelReady:!!observedPanel?.isConnected,
      lastFit:lastDebug ? JSON.parse(JSON.stringify(lastDebug)) : null,
    };
  }

  window.InventoryGearCompactEffects = Object.freeze({ version:VERSION, refresh:fitToolEffects, debugSnapshot });
  window.__inventoryGearCompactEffectsDebug = debugSnapshot;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
    else start();
  }
})();