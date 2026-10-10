// Hold-to-loot for corpses that ask for it (entity.lootHoldSeconds > 0, e.g.
// cave catacomb skeletons from js/cave-site-system.js). Same input contract
// as the den-nest take and bandit-tent loot holds: the corpse's world object
// offers the 'corpse_hold_loot' action, Action 1 held on it fills
// #corpseLootHud, and completing the hold runs the corpse's ordinary
// 'obj_loot_corpse' loot. Getting hit interrupts it until the button is
// released.
(() => {
  'use strict';

  const HOLD_ACTION = 'corpse_hold_loot';
  let deps = null; // { getActiveAction, getActionHeldDown, getAimedHoldCorpse, showToast }
  let holdT = 0; // Seconds held on the current target.
  let holdId = null; // World-object id being looted.
  let interrupted = false; // Set by a hit; cleared once the button is released.
  let hud = null; // { root, label, fill } resolved lazily.
  let hudVisible = false; // Tracked so idle frames make no DOM writes.
  let lastResult = null; // Diagnostics.

  function init(injectedDeps) { deps = injectedDeps; }

  function hudEls() {
    if (!hud && typeof document !== 'undefined') {
      hud = { root: document.getElementById('corpseLootHud'), label: document.getElementById('corpseLootLabel'), fill: document.getElementById('corpseLootFill') };
    }
    return hud;
  }

  function hideHud() {
    if (!hudVisible) return;
    hudVisible = false;
    hudEls()?.root?.classList.remove('visible');
  }

  function showHud(label, pct) {
    const els = hudEls();
    if (!els?.root) return;
    if (!hudVisible) { hudVisible = true; els.root.classList.add('visible'); if (els.label) els.label.textContent = label; }
    if (els.fill) els.fill.style.width = Math.min(100, Math.round(pct)) + '%';
  }

  function reset() {
    holdT = 0;
    holdId = null;
    hideHud();
  }

  function update(dt) {
    if (!deps) return;
    const held = !!deps.getActionHeldDown();
    if (!held) interrupted = false;
    const target = held && !interrupted && deps.getActiveAction() === HOLD_ACTION ? deps.getAimedHoldCorpse() : null;
    if (!target) { if (holdId !== null || hudVisible) reset(); return; }
    if (holdId !== target.id) { holdId = target.id; holdT = 0; hideHud(); }
    holdT += dt;
    const holdSeconds = Math.max(0.1, Number(target.holdSeconds) || 2);
    showHud(target.holdLabel || 'Looting...', (holdT / holdSeconds) * 100);
    if (holdT < holdSeconds) return;
    reset();
    interrupted = true; // One loot per press: release before the next body starts filling.
    lastResult = target.onAction('obj_loot_corpse') || null;
    if (lastResult?.message) deps.showToast?.(lastResult.message, !!lastResult.ok);
  }

  function interrupt() {
    if (holdId !== null) interrupted = true;
    reset();
  }

  window.CorpseHoldLoot = Object.freeze({
    HOLD_ACTION,
    init,
    update,
    interrupt,
    debugSnapshot: () => ({ holdT, holdId, interrupted, hudVisible, lastResult }),
  });
})();
