// HUD/tool icon compatibility bridge.
//
// Gameplay buttons used to rasterize the literal equipped tool/item sprite.
// The action HUD now has purpose-built symbols under assets/hud/action_icons,
// so these legacy calls deliberately return null and their callers use the
// existing generic fallback. Inventory/equipment rendering remains separate.
(() => {
  'use strict';

  function getIconHTML() { return null; }
  function warm() {}
  function registerCanvasSource() {}
  function invalidate() {}

  window.ToolIconRender = {
    getIconHTML,
    warm,
    registerCanvasSource,
    invalidate,
    spriteButtonRenderingDisabled: true,
  };
})();

// Dedicated action-arch artwork/bootstrap. It owns only HUD presentation;
// game.js and Combat.input remain authoritative for action behavior/timing.
(() => {
  'use strict';
  if (window.ActionArchIcons?.installed || document.querySelector('script[data-action-arch-icons]')) return;
  const src = 'js/action-arch-icons.js?v=20261125materializationAudit1';
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-action-arch-icons="1" src="${src}"><\/script>`);
    return;
  }
  const script = document.createElement('script');
  script.dataset.actionArchIcons = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[action-arch-icons] module failed to load', 'error');
  document.head.appendChild(script);
})();

// Follow-up presentation fixes stay separate from the base resolver so the
// clipping/combo/ranged-shortcut corrections can be iterated without widening
// game.js. Loaded synchronously after action-arch-icons.js.
(() => {
  'use strict';
  if (window.ActionArchIconFixes?.installed || document.querySelector('script[data-action-arch-icon-fixes]')) return;
  const src = 'js/action-arch-icons-fixes.js?v=20261125deepHotpaths1';
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-action-arch-icon-fixes="1" src="${src}"><\/script>`);
    return;
  }
  const script = document.createElement('script');
  script.dataset.actionArchIconFixes = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[action-arch-fixes] module failed to load', 'error');
  document.head.appendChild(script);
})();

// Slot-color presentation is intentionally last: it tints whichever attack
// artwork the two arch modules resolved, but leaves potion/ammo utility buttons
// white and never changes the underlying combat/loadout state.
(() => {
  'use strict';
  if (window.ActionArchSlotColors?.installed || document.querySelector('script[data-action-arch-slot-colors]')) return;
  const src = 'js/action-arch-slot-colors.js?v=20261107h7345c84';
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-action-arch-slot-colors="1" src="${src}"><\/script>`);
    return;
  }
  const script = document.createElement('script');
  script.dataset.actionArchSlotColors = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[action-arch-slot-colors] module failed to load', 'error');
  document.head.appendChild(script);
})();

// Item-selector grouping and ALL item-only presentation now share one owner.
// It groups canonical ITEM_DEFS, colors item slots, preserves edge-scroll labels,
// and draws one fixed category heading/inset. game.js still owns item actions.
(() => {
  'use strict';
  if (window.ItemArchCategoryColors?.installed || document.querySelector('script[data-item-arch-category-colors]')) return;
  const src = 'js/item-arch-category-colors.js?v=20261119itemArchOneOwner1'; // Used to cache-bust grouping/category presentation independently.
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-item-arch-category-colors="1" src="${src}"><\/script>`);
    return;
  }
  const script = document.createElement('script'); // Used to load the item selector adapter when this bootstrap runs after parsing.
  script.dataset.itemArchCategoryColors = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[item-arch-category-colors] module failed to load', 'error');
  document.head.appendChild(script);
})();

// Loading-screen lettering stays in its own presentation module. This bootstrap
// runs before ToolMetalRecolor and LoadingScreenRuntime, so the module installs
// its CSS immediately and waits for those existing dependencies/DOM hooks.
(() => {
  'use strict';
  if (window.LoadingScreenMetalText?.installed || document.querySelector('script[data-loading-screen-metal-text]')) return;
  const src = 'js/loading-screen-metal-text.js?v=20260908a'; // Used to cache-bust the bronze/verdigris loading-screen treatment independently.
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-loading-screen-metal-text="1" src="${src}"><\/script>`);
    return;
  }
  const script = document.createElement('script'); // Used to load the presentation module if this bootstrap is evaluated after document parsing.
  script.dataset.loadingScreenMetalText = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[loading-metal-text] module failed to load', 'error');
  document.head.appendChild(script);
})();
