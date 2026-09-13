// Renderer-facing projection for manually held off-arch bag items.
//
// held-item-state.js owns the manual selection lifecycle and keeps ActionArcUI /
// HudUpdate filtered. The actual game.js renderer, however, resolves held bag
// items through the lexical getInventoryStackItems() -> ItemProcessing
// .isWheelEligible(key) path. That path passes only the key, so a callback-
// signature detector cannot distinguish it from an ordinary eligibility query.
//
// While held-item-state reports a live projectionKey, this tiny bridge lets that
// one key pass the canonical eligibility gate. Visible arch consumers are still
// filtered by held-item-state.js, so the item remains absent from the item arch.
// This module never changes inventory counts, save state, or localStorage.
(() => {
  'use strict';
  if (window.HobunjiHeldItemRenderProjection) return;

  const api = window.ItemProcessing; // Canonical item eligibility API used by game.js's active-stack resolver.
  const heldState = window.HobunjiHeldItemState; // Manual Hold owner; exposes the currently projected bag key for diagnostics.
  if (!api?.isWheelEligible || !heldState?.getDebug) {
    window.HobunjiHeldItemRenderProjection = { version: 1, ready: false };
    return;
  }

  const baseIsWheelEligible = api.isWheelEligible.bind(api); // Preserves all ordinary authored wheel-eligibility behavior.
  api.isWheelEligible = function hobunjiHeldRenderEligibility(key, ...rest) {
    const projectionKey = heldState.getDebug()?.projectionKey || null; // Live manual bag key that must resolve through game.js for hand rendering.
    if (projectionKey && key === projectionKey) return true;
    return baseIsWheelEligible(key, ...rest);
  };

  window.HobunjiHeldItemRenderProjection = {
    version: 1,
    ready: true,
    baseIsWheelEligible,
    projectedKey: () => heldState.getDebug()?.projectionKey || null,
  };
})();
