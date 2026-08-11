// Alcohol serving badges for inventory and HUD item icons.
//
// The game supplies live inventory/status readers once. Icon renderers then
// delegate here so alcohol-specific DOM and fraction formatting stay outside
// game.js.
(() => {
  'use strict';

  let deps = null;

  function clearSwigBadge(element) {
    if (!element) return;
    element.querySelector?.(':scope > .alcohol-swig-badge')?.remove();
    delete element.dataset.swigFraction;
  }

  function applySwigBadge(element, itemKey, itemDef) {
    clearSwigBadge(element);
    if (!element || !deps) return null;
    const status = deps.getBottleSwigStatus?.(itemKey, itemDef, deps.getInventory?.());
    if (!status) return null;
    const fraction = `${status.remaining}/${status.total}`;
    const badge = document.createElement('span');
    badge.className = 'alcohol-swig-badge';
    badge.textContent = fraction;
    badge.setAttribute('aria-hidden', 'true');
    element.dataset.swigFraction = fraction;
    element.appendChild(badge);
    return status;
  }

  function init(injectedDeps) {
    deps = injectedDeps || null;
    return api;
  }

  const api = Object.freeze({ init, applySwigBadge, clearSwigBadge });
  window.AlcoholInventoryUI = api;
})();
