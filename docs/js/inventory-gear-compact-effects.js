(() => {
  'use strict';

  if (Number(window.InventoryGearCompactEffects?.version) >= 2) return;

  const VERSION = 2;
  const STYLE_ID = 'inventoryGearCompactEffectsStyles'; // Keeps the three-panel Gear presentation idempotent across rebuilds.
  const INFO_MAX_FONT_PX = 10.5; // Largest item-detail text size used when the narrowed right panel has room.
  const INFO_MIN_FONT_PX = 2.75; // Emergency floor used only when a very dense item detail must remain non-scrolling.

  let observedSection = null; // Tracks the current Gear equipment root; EquipmentPanel may rebuild it at runtime.
  let observedInfo = null; // Tracks the item-detail panel so resize fitting follows menu/orientation changes.
  let resizeObserver = null; // Re-fits only when one of the three Gear regions actually changes size.
  let inventoryMutationObserver = null; // Watches Gear rebuilds, item-detail changes, and readability-floor annotations.
  let fitQueued = false; // Coalesces rebuild/resize/orientation bursts into one presentation pass.
  let lastDebug = null; // Mobile-friendly snapshot of the latest workspace + item-detail fit.

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Gear gets three horizontal regions: scrollable summary, roomy owned inventory, compact non-scrolling item detail. */
      #mpInventory.inv-mode-gear .inv-equip-section {
        left:calc(1 * var(--inv-col)) !important;
        top:calc(4 * var(--inv-row)) !important;
        width:calc(40 * var(--inv-col)) !important;
        height:calc(23 * var(--inv-row)) !important;
        max-height:calc(23 * var(--inv-row)) !important;
        display:grid !important;
        grid-template-columns:minmax(0,.82fr) minmax(0,1.68fr) !important;
        gap:calc(.8 * var(--inv-gap)) !important;
        padding:0 !important;
        background:transparent !important;
        overflow:hidden !important;
        box-sizing:border-box;
      }

      /* The old four-column loadout becomes one left summary rail. It owns all scrolling for slots/effects. */
      #mpInventory.inv-mode-gear .gear-loadout-grid.gear-summary-panel {
        display:flex !important;
        flex-direction:column !important;
        min-width:0 !important;
        min-height:0 !important;
        height:100% !important;
        max-height:none !important;
        gap:calc(.8 * var(--inv-gap)) !important;
        margin:0 !important;
        padding:calc(.55 * var(--inv-gap)) !important;
        border:1px solid #ffffff17 !important;
        border-radius:var(--inv-radius) !important;
        background:#00000018 !important;
        overflow-y:auto !important;
        overflow-x:hidden !important;
        scrollbar-width:thin;
      }
      #mpInventory.inv-mode-gear .gear-slot-pair {
        flex:0 0 auto;
        min-width:0;
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:calc(.7 * var(--inv-gap));
        align-items:start;
      }
      #mpInventory.inv-mode-gear .gear-slot-pair > .gear-loadout-column {
        min-width:0;
        gap:2px;
      }
      #mpInventory.inv-mode-gear .gear-slot-pair .gear-loadout-heading {
        min-height:calc(1.05 * var(--inv-row));
        font-size:clamp(8px,calc(.5 * var(--inv-row)),11px);
        line-height:1;
      }
      #mpInventory.inv-mode-gear .gear-slot-pair .inv-equip-row {
        gap:2px !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-slot-pair .inv-equip-slot {
        flex:0 0 calc(1.45 * var(--inv-row)) !important;
        min-height:calc(1.45 * var(--inv-row)) !important;
        padding:1px 2px !important;
      }
      #mpInventory.inv-mode-gear .gear-slot-pair .ies-label {
        min-width:0;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      /* Every effect section grows from its real content; the summary rail scrolls instead of clipping a card. */
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-tool-stats,
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-outfit-stats {
        flex:0 0 auto !important;
        min-height:0 !important;
        height:auto !important;
        max-height:none !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-tool-stats > .gear-stat-list {
        display:flex !important;
        flex-direction:column !important;
        gap:2px !important;
        min-height:0 !important;
        height:auto !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-tool-stats .gear-stat-item {
        flex:0 0 auto !important;
        min-height:0 !important;
        padding:2px 3px !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-tool-stats .gear-stat-item-head {
        align-items:flex-start;
        line-height:1.05;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-tool-stats .gear-stat-name {
        white-space:normal !important;
        overflow:visible !important;
        text-overflow:clip !important;
        overflow-wrap:anywhere;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-tool-stats .gear-stat-chips {
        display:flex !important;
        flex-direction:column !important;
        flex-wrap:nowrap !important;
        align-items:flex-start;
        gap:1px !important;
        margin-top:2px !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-tool-stats .gear-stat-chip {
        max-width:100%;
        white-space:normal !important;
        overflow:visible !important;
        text-overflow:clip !important;
        line-height:1.05 !important;
      }

      /* Outfit Effects + Final Values remain two-column lists, but rows may wrap vertically because the left rail itself scrolls. */
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-outfit-stats.gear-character-effects-host {
        display:flex !important;
        flex-direction:column !important;
        gap:calc(.7 * var(--inv-gap)) !important;
        padding:0 !important;
        border:0 !important;
        background:none !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-character-effects-card {
        flex:0 0 auto !important;
        min-height:0 !important;
        height:auto !important;
        padding:calc(.35 * var(--inv-gap)) !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-character-effects-card .gear-loadout-heading {
        min-height:calc(1.05 * var(--inv-row)) !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-character-effects-card .gear-effects-list {
        flex:none !important;
        display:grid !important;
        grid-template-columns:repeat(2,minmax(0,1fr)) !important;
        gap:1px 2px !important;
        height:auto !important;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-character-effects-card .gear-effect-row {
        min-width:0;
        min-height:0;
        padding:1px 2px !important;
        align-items:flex-start;
        overflow:visible !important;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-character-effects-card .gear-effect-label {
        min-width:0;
        white-space:normal !important;
        overflow:visible !important;
        text-overflow:clip !important;
        overflow-wrap:anywhere;
      }
      #mpInventory.inv-mode-gear .gear-summary-panel .gear-character-effects-card .gear-effect-value {
        flex:0 0 auto;
        white-space:nowrap !important;
        overflow:visible !important;
      }

      /* Owned tools/clothing become the middle inventory and get most of the usable Gear width. */
      #mpInventory.inv-mode-gear .gear-owned-section.gear-middle-inventory {
        position:relative !important;
        z-index:0;
        min-width:0 !important;
        min-height:0 !important;
        width:auto !important;
        height:100% !important;
        max-height:none !important;
        margin:0 !important;
        padding:calc(.55 * var(--inv-gap)) !important;
        border:1px solid #ffffff17;
        border-radius:var(--inv-radius);
        background:#00000018;
        overflow-y:auto !important;
        overflow-x:hidden !important;
        scrollbar-width:thin;
      }
      #mpInventory.inv-mode-gear .gear-middle-inventory .gear-owned-group + .gear-owned-group {
        margin-top:calc(1.2 * var(--inv-gap)) !important;
      }
      #mpInventory.inv-mode-gear .gear-middle-inventory .inv-equip-label {
        margin:0 0 calc(.55 * var(--inv-gap)) !important;
        padding:1px 2px;
      }
      #mpInventory.inv-mode-gear .gear-middle-inventory .inv-equip-row {
        display:grid !important;
        grid-template-columns:repeat(auto-fill,minmax(calc(7.4 * var(--inv-col)),1fr)) !important;
        gap:calc(.75 * var(--inv-gap)) !important;
        min-height:0 !important;
      }
      #mpInventory.inv-mode-gear .gear-middle-inventory .inv-equip-slot {
        min-height:calc(3.35 * var(--inv-row)) !important;
      }

      /* The Gear-only item-detail panel is ~70% of its original 17-column width: 12 columns. */
      #mpInventory.inv-mode-gear .inv-info {
        --gear-info-font:9px;
        --gear-info-gap:2px;
        --gear-info-pad:3px;
        --gear-info-icon-height:calc(3.2 * var(--inv-row));
        --gear-info-icon-font:28px;
        --gear-info-button-height:22px;
        left:calc(42 * var(--inv-col)) !important;
        width:calc(12 * var(--inv-col)) !important;
        padding:var(--gear-info-pad) !important;
        gap:var(--gear-info-gap) !important;
        overflow:hidden !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-detail {
        gap:var(--gear-info-gap) !important;
        min-height:0 !important;
        overflow:hidden !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-icon-wrap {
        flex:0 0 var(--gear-info-icon-height) !important;
        min-height:0 !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-icon {
        font-size:var(--gear-info-icon-font) !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-name,
      #mpInventory.inv-mode-gear .inv-info .ii-price,
      #mpInventory.inv-mode-gear .inv-info .ii-quality,
      #mpInventory.inv-mode-gear .inv-info .ii-desc,
      #mpInventory.inv-mode-gear .inv-info .ii-desc::before,
      #mpInventory.inv-mode-gear .inv-info .ii-btn,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-head,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-foot,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-label,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-xp,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-next,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-level,
      #mpInventory.inv-mode-gear .inv-info .ii-empty {
        font-size:var(--gear-info-font) !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-name,
      #mpInventory.inv-mode-gear .inv-info .ii-price,
      #mpInventory.inv-mode-gear .inv-info .ii-quality,
      #mpInventory.inv-mode-gear .inv-info .ii-btn,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-head,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-foot,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-xp,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-next,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-level {
        white-space:normal !important;
        overflow-wrap:anywhere;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery {
        gap:var(--gear-info-gap) !important;
        padding:var(--gear-info-pad) !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-head,
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-foot {
        gap:var(--gear-info-gap) !important;
        flex-wrap:wrap;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-tool-mastery-track {
        height:max(3px,calc(var(--gear-info-font) * .55));
      }
      #mpInventory.inv-mode-gear .inv-info .ii-desc {
        flex:1 1 auto !important;
        min-height:0 !important;
        padding:var(--gear-info-pad) !important;
        line-height:1.18 !important;
        overflow:hidden !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-desc::before {
        margin-bottom:var(--gear-info-gap) !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-actions {
        flex:0 0 auto !important;
        max-height:none !important;
        gap:var(--gear-info-gap) !important;
        padding-top:var(--gear-info-gap) !important;
        overflow:hidden !important;
      }
      #mpInventory.inv-mode-gear .inv-info .ii-btn {
        min-height:var(--gear-info-button-height) !important;
        padding:1px var(--gear-info-pad) !important;
        line-height:1.08 !important;
      }
    `;
    document.head?.appendChild(style);
  }

  function ensureGearWorkspace() {
    if (typeof document === 'undefined') return null;
    const section = document.getElementById('invEquipSection');
    const summary = section?.querySelector?.(':scope > .gear-loadout-grid');
    const owned = section?.querySelector?.(':scope > .gear-owned-section');
    if (!section || !summary || !owned) return null;

    if (!summary.classList.contains('gear-summary-panel')) {
      const toolSlots = summary.querySelector('.gear-tool-slots');
      const clothingSlots = summary.querySelector('.gear-clothing-slots');
      const toolStats = summary.querySelector('.gear-tool-stats');
      const outfitStats = summary.querySelector('.gear-outfit-stats');
      if (!toolSlots || !clothingSlots || !toolStats || !outfitStats) return null;

      const slotPair = document.createElement('div'); // Single top container requested for tool slots left + clothing slots right.
      slotPair.className = 'gear-slot-pair';
      slotPair.append(toolSlots, clothingSlots);
      summary.replaceChildren(slotPair, toolStats, outfitStats);
      summary.classList.add('gear-summary-panel');
    }
    owned.classList.add('gear-middle-inventory');
    return { section, summary, owned };
  }

  function releaseInventoryFontFloor(root) {
    if (!root) return 0;
    let released = 0;
    root.querySelectorAll('[data-menu-font-floor="1"]').forEach((element) => {
      element.style.removeProperty('font-size'); // Item detail intentionally scales below the global menu text floor to stay fully visible without scrolling.
      delete element.dataset.menuFontFloor;
      released += 1;
    });
    return released;
  }

  function applyInfoMetrics(info, fontPx) {
    const ratio = Math.max(.2, Math.min(1, fontPx / INFO_MAX_FONT_PX)); // Drives spacing/icon/button density together with text size.
    const iconRows = Math.max(1.45, 3.15 * ratio);
    info.style.setProperty('--gear-info-font', `${fontPx.toFixed(2)}px`);
    info.style.setProperty('--gear-info-gap', `${Math.max(.5, fontPx * .20).toFixed(2)}px`);
    info.style.setProperty('--gear-info-pad', `${Math.max(1, fontPx * .30).toFixed(2)}px`);
    info.style.setProperty('--gear-info-icon-height', `calc(${iconRows.toFixed(2)} * var(--inv-row))`);
    info.style.setProperty('--gear-info-icon-font', `${Math.max(12, fontPx * 3.0).toFixed(2)}px`);
    info.style.setProperty('--gear-info-button-height', `${Math.max(12, fontPx * 2.05).toFixed(2)}px`);
  }

  function infoContentFits(info) {
    const detail = info?.querySelector?.('.ii-detail');
    if (!detail || detail.offsetParent === null) return true;
    if (detail.clientHeight <= 0 || detail.clientWidth <= 0) return true;
    if (detail.scrollHeight > detail.clientHeight + .75 || detail.scrollWidth > detail.clientWidth + .75) return false;

    const constrained = detail.querySelectorAll('.ii-desc,.ii-actions,.ii-tool-mastery,.ii-name,.ii-price,.ii-quality,.ii-btn');
    for (const element of constrained) {
      if (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + .75) return false;
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + .75) return false;
    }
    return true;
  }

  function fitInfoPanel(info) {
    if (!info || !document.getElementById('mpInventory')?.classList.contains('inv-mode-gear')) return null;
    const releasedFloors = releaseInventoryFontFloor(info);
    applyInfoMetrics(info, INFO_MAX_FONT_PX);
    if (infoContentFits(info)) return { fontPx:INFO_MAX_FONT_PX, releasedFloors, fits:true };

    applyInfoMetrics(info, INFO_MIN_FONT_PX);
    if (!infoContentFits(info)) return { fontPx:INFO_MIN_FONT_PX, releasedFloors, fits:false };

    let low = INFO_MIN_FONT_PX;
    let high = INFO_MAX_FONT_PX;
    for (let i = 0; i < 9; i++) { // Largest measured text size that leaves every detail child inside its real box.
      const mid = (low + high) * .5;
      applyInfoMetrics(info, mid);
      if (infoContentFits(info)) low = mid;
      else high = mid;
    }
    applyInfoMetrics(info, low);
    return { fontPx:Number(low.toFixed(2)), releasedFloors, fits:infoContentFits(info) };
  }

  function hookResizeTargets(workspace, info) {
    if (workspace?.section === observedSection && info === observedInfo) return;
    resizeObserver?.disconnect?.();
    observedSection = workspace?.section || null;
    observedInfo = info || null;
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFit) : null;
    [workspace?.section, workspace?.summary, workspace?.owned, info].filter(Boolean).forEach((node) => resizeObserver?.observe?.(node));
  }

  function refreshPresentation() {
    fitQueued = false;
    if (typeof document === 'undefined') return null;
    const workspace = ensureGearWorkspace();
    const info = document.getElementById('invInfo');
    hookResizeTargets(workspace, info);
    const detailFit = fitInfoPanel(info);

    lastDebug = {
      version:VERSION,
      workspaceReady:!!workspace,
      summaryScrollHeight:Number((workspace?.summary?.scrollHeight || 0).toFixed?.(2) || 0),
      summaryClientHeight:Number((workspace?.summary?.clientHeight || 0).toFixed?.(2) || 0),
      ownedClientHeight:Number((workspace?.owned?.clientHeight || 0).toFixed?.(2) || 0),
      detailWidth:Number((info?.getBoundingClientRect?.().width || 0).toFixed?.(2) || 0),
      detailFit,
      viewport:[window.innerWidth || 0, window.innerHeight || 0],
    };
    return lastDebug;
  }

  function scheduleFit() {
    if (fitQueued || typeof requestAnimationFrame !== 'function') return;
    fitQueued = true;
    requestAnimationFrame(refreshPresentation);
  }

  function start() {
    installStyles();
    const pane = document.getElementById('mpInventory');
    if (!pane) return;

    inventoryMutationObserver = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (record.type === 'childList' || record.type === 'characterData') return true;
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        return !!target?.closest?.('#mpInventory');
      });
      if (relevant) scheduleFit();
    });
    inventoryMutationObserver.observe(pane, {
      childList:true,
      subtree:true,
      characterData:true,
      attributes:true,
      attributeFilter:['class','data-menu-font-floor'],
    });
    window.addEventListener?.('resize', scheduleFit, { passive:true });
    window.addEventListener?.('orientationchange', scheduleFit, { passive:true });
    scheduleFit();
  }

  function debugSnapshot() {
    return lastDebug ? JSON.parse(JSON.stringify(lastDebug)) : { version:VERSION, workspaceReady:false };
  }

  window.InventoryGearCompactEffects = Object.freeze({ version:VERSION, refresh:refreshPresentation, debugSnapshot });
  window.__inventoryGearCompactEffectsDebug = debugSnapshot;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
    else start();
  }
})();