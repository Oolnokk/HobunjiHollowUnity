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

// This file already loads synchronously before game.js. Use that existing
// bootstrap point to load the decoupled held-object/world-layer policy without
// adding another render concern back into game.js or index.html.
(() => {
  'use strict';
  if (window.HeldObjectRenderOrder?.installed) return;
  const src = 'js/held-object-render-order.js?v=20260815a';
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-hobunji-held-render-order="1" src="${src}"><\/script>`);
    return;
  }
  if (document.querySelector('script[data-hobunji-held-render-order]')) return;
  const script = document.createElement('script');
  script.dataset.hobunjiHeldRenderOrder = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[held-layer] render-order module failed to load', 'error');
  document.head.appendChild(script);
})();

// Dedicated action-arch artwork/bootstrap. It owns only HUD presentation;
// game.js and Combat.input remain authoritative for action behavior/timing.
(() => {
  'use strict';
  if (window.ActionArchIcons?.installed || document.querySelector('script[data-action-arch-icons]')) return;
  const src = 'js/action-arch-icons.js?v=20260823c';
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
  const src = 'js/action-arch-icons-fixes.js?v=20260823f';
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
  const src = 'js/action-arch-slot-colors.js?v=20260823c';
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

// Item-selector grouping/category presentation is a separate HUD layer. It
// classifies existing ITEM_DEFS metadata, keeps same-type items adjacent in the
// canonical selectable order, and decorates the item arc + curved category
// heading; selection/consumption behavior remains authoritative in game.js.
(() => {
  'use strict';
  if (window.ItemArchCategoryColors?.installed || document.querySelector('script[data-item-arch-category-colors]')) return;
  const src = 'js/item-arch-category-colors.js?v=20260830b'; // Used to cache-bust grouping/category presentation independently.
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

// Mobile edge-scroll continuity is layered after the base item-category module:
// while a scroll sentinel is active, keep the last real item's curved category
// heading visible until the thumb reaches another real item slot. This adapter
// also keeps item/category geometry aligned with Potion Select.
(() => {
  'use strict';
  if (window.ItemArchStickyCategoryHeading?.installed || document.querySelector('script[data-item-arch-sticky-category-heading]')) return;
  const src = 'js/item-arch-sticky-category-heading.js?v=20260830e'; // Used to cache-bust the mobile continuity + geometry adapter independently.
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-item-arch-sticky-category-heading="1" src="${src}"><\/script>`);
    return;
  }
  const script = document.createElement('script'); // Used to load after the base category module when parsing has already completed.
  script.dataset.itemArchStickyCategoryHeading = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[item-arch-sticky-category-heading] module failed to load', 'error');
  document.head.appendChild(script);
})();

// Final item presentation reset: category grouping/rings remain, but icon
// layout is returned to the pre-feature selector styles and the curved category
// heading uses Potion Select's sharp gold/black text rather than category color.
(() => {
  'use strict';
  if (window.ItemArchOriginalPresentation?.installed || document.querySelector('script[data-item-arch-original-presentation]')) return;
  const src = 'js/item-arch-original-presentation.js?v=20260830a'; // Used to cache-bust only the final icon/text presentation reset.
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-item-arch-original-presentation="1" src="${src}"><\/script>`);
    return;
  }
  const script = document.createElement('script'); // Used to load after every item-category presentation layer when parsing has completed.
  script.dataset.itemArchOriginalPresentation = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[item-arch-original-presentation] module failed to load', 'error');
  document.head.appendChild(script);
})();
