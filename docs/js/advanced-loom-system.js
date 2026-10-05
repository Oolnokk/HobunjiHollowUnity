(() => {
  'use strict';

  if (Number(window.AdvancedLoomSystem?.version) >= 1) return;

  const MASTERY_ID = 'advancedLoomBlueprint'; // Used by Crafting Mastery and the world-scoped blueprint ownership check.
  const MOTE_COST = 8; // Used as the one-time world purchase price for the Advanced Loom blueprint.

  function registerMasteryNode() {
    const mastery = window.CraftingMasterySystem;
    if (!mastery?.registerNode) return false;
    mastery.registerNode({
      id: MASTERY_ID,
      name: 'Advanced Loom Blueprint',
      category: 'weaving',
      tier: 1,
      maxRank: 1,
      cost: MOTE_COST,
      desc: () => 'Permanently unlocks the Advanced Loom blueprint for this world. Advanced Looms can add a second overpass pattern for double the normal wool cost.',
    });
    return true;
  }

  function installProceduralFallbacks() {
    const catalog = window.ProceduralFurniture?.CATALOG;
    if (!catalog) return false;
    const box = (x, y, z, sx, sy, sz, tint = 0.9) => ({ type: 'box', x, y, z, sx, sy, sz, color: 0x7d5b3a, tint }); // Used by the two loom fallback frames when authored furniture JSON is unavailable.
    const leg = (x, z, h, thick = 0.1, tint = 0.8) => ({ type: 'legSquare', x, y: h / 2, z, sx: thick, sy: h, sz: thick, color: 0x6f5133, tint }); // Used to keep Simple and Advanced loom fallback proportions consistent.

    catalog.loom = [
      leg(-0.22, -0.36, 1.0), leg(0.22, -0.36, 1.0),
      leg(-0.22, 0.36, 1.0), leg(0.22, 0.36, 1.0),
      box(0, 0.92, -0.36, 0.56, 0.07, 0.09),
      box(0, 0.18, -0.36, 0.56, 0.07, 0.09),
      box(0, 0.92, 0.36, 0.56, 0.07, 0.09),
      box(0, 0.18, 0.36, 0.56, 0.07, 0.09),
    ];

    catalog.advancedLoom = [
      leg(-0.32, -0.82, 1.65, 0.12), leg(0.32, -0.82, 1.65, 0.12),
      leg(-0.32, 0.82, 1.65, 0.12), leg(0.32, 0.82, 1.65, 0.12),
      box(0, 1.55, -0.82, 0.82, 0.09, 0.12),
      box(0, 0.26, -0.82, 0.82, 0.09, 0.12),
      box(0, 1.55, 0.82, 0.82, 0.09, 0.12),
      box(0, 0.26, 0.82, 0.82, 0.09, 0.12),
      box(0, 1.08, -0.82, 0.72, 0.06, 0.08, 1.0),
      box(0, 1.08, 0.82, 0.72, 0.06, 0.08, 1.0),
    ];
    return true;
  }

  function install() {
    registerMasteryNode();
    installProceduralFallbacks();
  }

  function debugSnapshot() {
    return {
      version: 1,
      masteryId: MASTERY_ID,
      moteCost: MOTE_COST,
      unlocked: !!window.CraftingMasterySystem?.hasUnlock?.(MASTERY_ID),
      simpleFallbackParts: window.ProceduralFurniture?.CATALOG?.loom?.length || 0,
      advancedFallbackParts: window.ProceduralFurniture?.CATALOG?.advancedLoom?.length || 0,
    };
  }

  window.AdvancedLoomSystem = Object.freeze({
    version: 1,
    MASTERY_ID,
    MOTE_COST,
    registerMasteryNode,
    installProceduralFallbacks,
    debugSnapshot,
  });

  install();
  if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
})();
