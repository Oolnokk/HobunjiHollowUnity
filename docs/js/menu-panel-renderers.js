// Central menu-render dispatch. Main game owns panel visibility; features register render callbacks.
(() => {
  'use strict';
  const renderers = new Map(); // Each panel id has one owner; replaces duplicate open/switch rendering chains.
  const renderCounts = new Map(); // Mobile debug readout for unexpected duplicate panel renders.
  let lastPanel = null; // Most recently rendered panel, shown in the Dev Companion.
  let lastError = null; // Retains the last panel fault without breaking the menu.
  function register(id, render) {
    if (!id || typeof render !== 'function') return false;
    renderers.set(String(id), render);
    return true;
  }
  function init(entries) {
    for (const [id, render] of Object.entries(entries || {})) register(id, render);
  }
  function render(id) {
    lastPanel = String(id || '');
    const handler = renderers.get(lastPanel);
    if (!handler) return false;
    renderCounts.set(lastPanel, (renderCounts.get(lastPanel) || 0) + 1);
    try { handler(); lastError = null; return true; }
    catch (error) {
      lastError = lastPanel + ': ' + String(error?.message || error);
      console.error('[menu-panel-renderers]', lastError);
      return false;
    }
  }
  function debugSnapshot() {
    return { registered: [...renderers.keys()], lastPanel, lastError,
      renderCounts: Object.fromEntries(renderCounts) };
  }
  window.MenuPanelRenderers = Object.freeze({ init, register, render, debugSnapshot });
  window.DevCompanion?.registerStateProvider?.('menuPanelRenderers', debugSnapshot);
})();