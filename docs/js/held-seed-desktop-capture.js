// Earliest desktop-key capture for held-seed Plant actions.
//
// The main held-seed bridge owns planting semantics and mobile pointer routing.
// Desktop keyboard input, however, is also routed at window level by game.js.
// Claim the configured semantic Plant key at window capture time so no later
// input handler can queue it back into the hidden tool-swing lifecycle.
(() => {
  'use strict';

  if (window.HobunjiHeldSeedDesktopCapture) return;

  const ARCH_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']; // Used to map the currently visible Plant button to action1..action5.
  let lastKeyDebug = null; // Used by lightweight diagnostics to confirm which desktop key/action was claimed most recently.

  function visiblePlantSlot() {
    if (typeof document === 'undefined') return null;
    for (let index = 0; index < ARCH_IDS.length; index++) {
      const button = document.getElementById(ARCH_IDS[index]); // Used to follow refreshActionBar's actual item-mode slot packing instead of assuming Plant is always action1.
      const action = button?.dataset?.action || '';
      if (!button || button.classList.contains('abt-hidden') || !action.startsWith('plant_')) continue;
      return { action, slot: index + 1, blocked: button.classList.contains('blocked') };
    }
    return null;
  }

  function currentDesktopBinding(slot) {
    const input = window.SCRATCHBONES_CONFIG?.game?.input || {}; // Used to preserve authored and user-remapped semantic action bindings.
    const actionId = `action${slot}`;
    const authored = Array.isArray(input.actions)
      ? input.actions.find(action => action?.id === actionId)?.desktop
      : null;
    let saved = null; // Used to merge the user's locally remapped desktop binding over the authored default.
    try { saved = JSON.parse(localStorage.getItem(input.storageKey || 'scratchbones.inputBindings.v1') || 'null'); }
    catch (_) { saved = null; }
    return saved?.desktop?.[actionId] || authored || null;
  }

  function typingTarget(target) {
    if (!target?.matches) return false;
    return target.matches('input, textarea, select, [contenteditable="true"]');
  }

  function capturePlantKey(event) {
    if (event.repeat || typingTarget(event.target)) return;
    if (document.getElementById('menuPanel')?.classList.contains('open')) return;

    const plant = visiblePlantSlot(); // Used to resolve the semantic slot that owns Plant at this exact frame.
    if (!plant) return;
    const binding = currentDesktopBinding(plant.slot); // Used to honor remapping rather than hard-coding Space.
    if (!binding || event.code !== binding) return;

    const bridge = window.HobunjiHeldSeedActionBridge; // Used as the single owner of direct held-seed dispatch into the planting metadata bridge.
    if (!bridge?.dispatchPlant?.(plant.action)) {
      lastKeyDebug = { claimed: false, code: event.code, binding, action: plant.action, slot: plant.slot, blocked: plant.blocked };
      return; // Leave game.js fallback untouched if planting dependencies are genuinely unavailable.
    }

    lastKeyDebug = { claimed: true, code: event.code, binding, action: plant.action, slot: plant.slot, blocked: plant.blocked };
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // window capture runs before document capture and before game.js's normal
  // window bubble listener, which prevents Plant from ever entering the hidden
  // tool strike queue on desktop.
  window.addEventListener('keydown', capturePlantKey, true);

  window.HobunjiHeldSeedDesktopCapture = {
    getDebug: () => ({
      plant: visiblePlantSlot(),
      lastKey: lastKeyDebug ? { ...lastKeyDebug } : null,
    }),
  };
})();
