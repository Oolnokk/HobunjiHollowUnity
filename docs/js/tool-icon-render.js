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
  const src = 'js/action-arch-icons.js?v=20260823b';
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
  const src = 'js/action-arch-icons-fixes.js?v=20260823b';
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