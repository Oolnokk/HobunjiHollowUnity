// Throwing-flask sprite/color presentation adapter.
//
// AlchemySystem remains authoritative for recipes, ingredients, inventory, and
// brewing. This module only maps the existing reagent colors onto the authored
// throwing_flask.png's two recolor regions:
//   - ordinary green key: every non-Afflict ingredient, averaged together;
//   - yellow key: every ingredient whose native Drive is Afflict, averaged.
// If all three ingredients are Afflict, both regions use their shared average
// rather than inventing an unrelated fourth color.
(() => {
  'use strict';

  const THROWING_FLASK_SPRITE = 'throwing_flask.png'; // Used by Afflict recipes whose useMode is throw.
  const FALLBACK_COLOR = 0x8A5FB0; // Used when an item was created without brew-ingredient provenance (treasure/shop/save reconstruction).
  const DUAL_KEY_MODE_PREFIX = 'dual-keyed:'; // Used to pass the Afflict tint through existing spriteMode render paths.
  let deps = null; // Used to reach the canonical ITEM_DEFS injected into AlchemySystem.init().
  let alchemySystem = null; // Used by brew-event recoloring and reagent metadata lookups after AlchemySystem is assigned.
  let lastPatch = null; // Used by mobile-safe diagnostics without requiring the browser console.

  function hex6(color) {
    return (Number(color) & 0xFFFFFF).toString(16).padStart(6, '0');
  }

  function mixColor(keys, fallback = FALLBACK_COLOR) {
    let red = 0, green = 0, blue = 0, count = 0; // Used to mirror AlchemySystem's existing equal-weight reagent color average.
    (keys || []).forEach(key => {
      const color = alchemySystem?.REAGENT_DEFS?.[key]?.color; // Used to read the same authored reagent tint already used by ordinary potions.
      if (color == null) return;
      red += color >> 16 & 255; green += color >> 8 & 255; blue += color & 255; count++;
    });
    return count ? Math.round(red / count) << 16 | Math.round(green / count) << 8 | Math.round(blue / count) : fallback;
  }

  function splitReagentColors(reagentKeys) {
    const validKeys = (reagentKeys || []).filter(key => alchemySystem?.REAGENT_DEFS?.[key]); // Used to ignore stale/unknown saved keys without corrupting the tint.
    const afflictKeys = validKeys.filter(key => alchemySystem.REAGENT_DEFS[key].traits?.drive === 'afflict'); // Used exclusively for the new yellow recolor target.
    const otherKeys = validKeys.filter(key => alchemySystem.REAGENT_DEFS[key].traits?.drive !== 'afflict'); // Used exclusively for the original green recolor target.
    const allColor = mixColor(validKeys, FALLBACK_COLOR); // Used as the truthful fallback when one side of the split has no ingredients.
    const afflictColor = mixColor(afflictKeys, allColor); // Used by the yellow key; two/three Afflict ingredients blend exactly like ordinary potion colors.
    const primaryColor = mixColor(otherKeys, allColor); // Used by the original green key; all-Afflict brews intentionally fall back to the same full blend.
    return { validKeys, afflictKeys, otherKeys, primaryColor, afflictColor };
  }

  function patchItemDef(itemKey, recipeId, reagentKeys = null) {
    const definition = alchemySystem?.RECIPE_DEFS?.[recipeId]; // Used to restrict the special sprite to authored throwable Afflict recipes.
    const itemDef = itemKey && deps?.ITEM_DEFS?.[itemKey]; // Used to mutate the same canonical item definition every inventory/world renderer already consumes.
    if (!definition || definition.useMode !== 'throw' || !itemDef) return false;

    const colors = splitReagentColors(reagentKeys); // Used to derive independent ordinary/Afflict target colors from this brew's ingredients.
    const hasIngredientColors = colors.validKeys.length > 0; // Used to distinguish real brew provenance from shop/treasure/save reconstruction.
    if (!hasIngredientColors && itemDef.alchemyFlaskColorSource === 'ingredients') return false;
    if (hasIngredientColors && itemDef.alchemyFlaskColorSource === 'ingredients') return false; // Preserve the first-brew tint for a stack key, matching existing potion stack-color behavior.

    itemDef.spriteIcon = THROWING_FLASK_SPRITE;
    itemDef.spriteColor = colors.primaryColor;
    itemDef.spriteSecondaryColor = colors.afflictColor; // Used by diagnostics/future renderers; the current shared renderer carries this same value in spriteMode.
    itemDef.spriteMode = `${DUAL_KEY_MODE_PREFIX}${hex6(colors.afflictColor)}`;
    itemDef.alchemyFlaskColorSource = hasIngredientColors ? 'ingredients' : 'fallback';

    lastPatch = { // Used by the existing in-game diagnostic surfaces through AlchemySystem.diagnosticsSnapshot().
      itemKey,
      recipeId,
      reagentKeys: [...colors.validKeys],
      afflictKeys: [...colors.afflictKeys],
      otherKeys: [...colors.otherKeys],
      primaryColor: `#${hex6(colors.primaryColor)}`,
      afflictColor: `#${hex6(colors.afflictColor)}`,
      colorSource: itemDef.alchemyFlaskColorSource,
      spriteIcon: itemDef.spriteIcon,
      spriteMode: itemDef.spriteMode,
    };
    window.__farmLog?.(`[alchemy-flask-sprite] ${recipeId} primary=${lastPatch.primaryColor} afflict=${lastPatch.afflictColor} source=${lastPatch.colorSource}`, 'alchemy');
    return true;
  }

  function patchExistingThrowables() {
    const definitions = deps?.ITEM_DEFS || {}; // Used to cover throwables registered before this adapter captures AlchemySystem.init().
    Object.entries(definitions).forEach(([itemKey, itemDef]) => {
      if (!itemDef?.alchemyRecipeId) return;
      patchItemDef(itemKey, itemDef.alchemyRecipeId, null);
    });
  }

  function debugSnapshot() {
    return {
      installed: true,
      capturedDeps: !!deps,
      throwingFlaskSprite: THROWING_FLASK_SPRITE,
      yellowKeys: ['#E6DD2C', '#C09C09'],
      lastPatch: lastPatch ? { ...lastPatch } : null,
    };
  }

  function wrapAlchemySystem(system) {
    if (!system || system.__alchemyFlaskSpriteWrapped) return system;
    alchemySystem = system;

    const originalInit = system.init; // Used to capture AlchemySystem's already-established dependency injection without changing its core module.
    const originalEnsureRecipeItemDef = system.ensureRecipeItemDef; // Used to cover shop/treasure/festival-created flask definitions outside the internal brew path.
    const originalDiagnosticsSnapshot = system.diagnosticsSnapshot; // Used to expose this visual split in the existing mobile-friendly alchemy diagnostics.

    system.init = function wrappedAlchemyInit(injectedDeps = {}) {
      deps = injectedDeps;
      const result = originalInit.call(this, injectedDeps); // Used to preserve every existing AlchemySystem initialization side effect before presentation patching.
      patchExistingThrowables();
      return result;
    };

    system.ensureRecipeItemDef = function wrappedEnsureRecipeItemDef(recipeId, tier = 0, reagentKeys = null) {
      const itemKey = originalEnsureRecipeItemDef.call(this, recipeId, tier, reagentKeys); // Used as the unchanged canonical stack identity.
      patchItemDef(itemKey, recipeId, reagentKeys);
      return itemKey;
    };

    system.diagnosticsSnapshot = function wrappedDiagnosticsSnapshot() {
      const snapshot = originalDiagnosticsSnapshot.call(this); // Used to preserve the full existing alchemy report.
      return { ...snapshot, flaskSprite: debugSnapshot() };
    };

    system.__alchemyFlaskSpriteWrapped = true;
    return system;
  }

  function installAssignmentHook() {
    const existingSystem = window.AlchemySystem; // Used when this adapter loads after alchemy-system.js in a tool/test page.
    if (existingSystem) {
      wrapAlchemySystem(existingSystem);
      return;
    }

    let assignedSystem = null; // Used to intercept the later parser-time window.AlchemySystem assignment when this adapter loads first.
    Object.defineProperty(window, 'AlchemySystem', {
      configurable: true,
      enumerable: true,
      get() { return assignedSystem; },
      set(value) {
        assignedSystem = wrapAlchemySystem(value);
        Object.defineProperty(window, 'AlchemySystem', { configurable: true, enumerable: true, writable: true, value: assignedSystem });
      },
    });
  }

  document.addEventListener('hobunji-alchemy-change', event => {
    const detail = event?.detail; // Used to react only after a real brew has selected a recipe/item key.
    if (detail?.type !== 'brew' || !alchemySystem) return;
    const lastBrew = alchemySystem.diagnosticsSnapshot?.()?.lastBrew; // Used to recover the exact three ingredient keys without widening the core brew event payload.
    if (!lastBrew || lastBrew.chosenRecipeId !== detail.recipeId) return;
    patchItemDef(detail.itemKey, detail.recipeId, lastBrew.keys);
  });

  window.AlchemyFlaskSprite = { patchItemDef, splitReagentColors, debugSnapshot };
  installAssignmentHook();
})();
