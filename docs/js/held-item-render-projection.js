// Renderer-facing projection for manually held off-arch bag items.
//
// held-item-state.js owns the manual selection lifecycle and keeps ActionArcUI /
// HudUpdate filtered. game.js's hand renderer still resolves bag items through
// its lexical getInventoryStackItems() -> ItemProcessing.isWheelEligible(key)
// path, which supplies only the key.
//
// To avoid making the manual item eligible too early, this bridge arms exactly
// when held-item-state invokes the canonical putAwayHeldEquipment() during Hold
// activation. That happens AFTER the previous ordinary wheel selection has been
// captured and BEFORE the projected stack is resolved for rendering.
//
// No inventory counts, save state, localStorage, or starter inventory are touched.
(() => {
  'use strict';
  if (window.HobunjiHeldItemRenderProjection) return;

  const api = window.ItemProcessing; // Canonical item eligibility API used by game.js's active-stack resolver.
  const heldState = window.HobunjiHeldItemState; // Manual Hold owner used only for its non-rendering manual-item resolver.
  const actionArc = window.ActionArcUI; // Existing module whose init receives the canonical game.js put-away dependency.
  if (!api?.isWheelEligible || !heldState?.getManualHeldThing || !actionArc?.init) {
    window.HobunjiHeldItemRenderProjection = { version: 2, ready: false };
    return;
  }

  let armedKey = null; // Manual bag key temporarily allowed through game.js's raw active-stack resolver.

  function liveManualBagKey() {
    const thing = heldState.getManualHeldThing?.(); // Safe resolver: reads manual selector/inventory only and does not resolve active wheel state.
    return thing?.kind === 'bagItem' ? thing.key : null;
  }

  const baseIsWheelEligible = api.isWheelEligible.bind(api); // Preserves all authored wheel eligibility for every non-projected key.
  api.isWheelEligible = function hobunjiHeldRenderEligibility(key, ...rest) {
    const liveKey = liveManualBagKey(); // Current valid manual selector, if any.
    if (!liveKey || liveKey !== armedKey) armedKey = null;
    if (armedKey && key === armedKey) return true;
    return baseIsWheelEligible(key, ...rest);
  };

  const previousActionInit = actionArc.init.bind(actionArc); // held-item-state's already-installed init wrapper; must remain in the chain.
  actionArc.init = (injectedDeps, ...rest) => {
    const canonicalPutAway = injectedDeps?.putAwayHeldEquipment; // Raw game.js dequip function called during Hold activation.
    const forwardedDeps = typeof canonicalPutAway === 'function' ? {
      ...injectedDeps,
      putAwayHeldEquipment: (...args) => {
        const result = canonicalPutAway(...args);
        armedKey = liveManualBagKey(); // Arm only after old equipment is gone and the manual selector is known to exist.
        return result;
      },
    } : injectedDeps;
    return previousActionInit(forwardedDeps, ...rest);
  };
  actionArc.__hobunjiHeldItemRenderProjectionBound = true;

  window.HobunjiHeldItemRenderProjection = {
    version: 2,
    ready: true,
    baseIsWheelEligible,
    projectedKey: () => armedKey,
  };
})();
