#!/usr/bin/env python3
from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


alchemy_path = Path('docs/js/alchemy-system.js')
alchemy = alchemy_path.read_text()

old_mix = '''  function mixColor(keys) {
    let red = 0, green = 0, blue = 0, count = 0; // Existing reagent-color average.
    (keys || []).forEach(key => { const color = REAGENT_DEFS[key]?.color; if (color == null) return; red += color >> 16 & 255; green += color >> 8 & 255; blue += color & 255; count++; });
    return count ? Math.round(red / count) << 16 | Math.round(green / count) << 8 | Math.round(blue / count) : 0x8a5fb0;
  }
'''
new_mix = '''  function mixColor(keys, fallback = 0x8a5fb0) {
    let red = 0, green = 0, blue = 0, count = 0; // Existing reagent-color average.
    (keys || []).forEach(key => { const color = REAGENT_DEFS[key]?.color; if (color == null) return; red += color >> 16 & 255; green += color >> 8 & 255; blue += color & 255; count++; });
    return count ? Math.round(red / count) << 16 | Math.round(green / count) << 8 | Math.round(blue / count) : fallback;
  }
  function throwingFlaskColors(reagentKeys) {
    const validKeys = [...(reagentKeys || [])].filter(key => REAGENT_DEFS[key]); // Used to keep stale/unknown reagent keys out of procedural flask colors.
    const afflictKeys = validKeys.filter(key => REAGENT_DEFS[key].traits?.drive === 'afflict'); // Used exclusively for the throwing flask's yellow Afflict-color target.
    const otherKeys = validKeys.filter(key => REAGENT_DEFS[key].traits?.drive !== 'afflict'); // Used exclusively for the original green bottle-color target.
    const allColor = mixColor(validKeys); // Used as the truthful fallback when one side of the Afflict/non-Afflict split is empty.
    const afflictColor = mixColor(afflictKeys, allColor); // Used to mix every ingredient whose native Drive is Afflict.
    const primaryColor = mixColor(otherKeys, allColor); // Used to mix every remaining ingredient, regardless of the trait category it supplied to the recipe.
    return { validKeys, afflictKeys, otherKeys, primaryColor, afflictColor };
  }
  function flaskColorHex(color) { return (Number(color) & 0xffffff).toString(16).padStart(6, '0'); } // Used by spriteMode metadata and mobile-readable diagnostics.
  function applyThrowingFlaskSprite(itemDef, colors, colorSource) {
    itemDef.spriteIcon = 'throwing_flask.png';
    itemDef.spriteColor = colors.primaryColor;
    itemDef.spriteSecondaryColor = colors.afflictColor; // Used by diagnostics/future renderers; current shared rendering carries the same value in spriteMode.
    itemDef.spriteMode = `dual-keyed:${flaskColorHex(colors.afflictColor)}`;
    itemDef.alchemyFlaskColorSource = colorSource; // Used to let a real brew replace a provenance-free shop/treasure fallback exactly once.
    itemDef.alchemyFlaskAfflictKeys = [...colors.afflictKeys]; // Used by mobile diagnostics to show which ingredients supplied the secondary color.
    itemDef.alchemyFlaskOtherKeys = [...colors.otherKeys]; // Used by mobile diagnostics to show which ingredients supplied the original color.
    return itemDef;
  }
'''
alchemy = replace_once(alchemy, old_mix, new_mix, 'mixColor block')

old_ensure = '''  function ensureRecipeItemDef(recipeId, tier = 0, reagentKeys = null) {
    const definition = RECIPE_DEFS[recipeId]; // Single item metadata source.
    if (!definition) return null;
    const safeTier = Math.max(0, Math.min(4, Math.floor(Number(tier) || 0))); // Stored tier.
    const key = itemKeyForRecipe(recipeId, safeTier); // Stack identity.
    POTION_ITEMS[key] = Object.freeze({ recipeId, potencyTier: safeTier });
    if (deps?.ITEM_DEFS && !deps.ITEM_DEFS[key]) {
      const modeTag = definition.useMode === 'throw' ? 'Flask' : definition.useMode === 'livestock' ? 'Livestock' : 'Potion'; // Inventory filter tag.
      const color = mixColor(reagentKeys); // Procedural bottle tint.
      deps.ITEM_DEFS[key] = { icon: definition.icon, label: `${definition.label}${safeTier ? ` · Potency ${safeTier + 1}` : ''}`, cat: 'processed', sellPrice: 0, tags: ['Alchemy', modeTag, definition.traits.drive, definition.traits.magnetism], desc: definition.desc, alchemyRecipeId: recipeId, alchemyPotencyTier: safeTier, useMode: definition.useMode, spriteIcon: 'bottle_potion.png', spriteColor: color, spriteMode: 'keyed' };
    }
    return key;
  }
'''
new_ensure = '''  function ensureRecipeItemDef(recipeId, tier = 0, reagentKeys = null) {
    const definition = RECIPE_DEFS[recipeId]; // Single item metadata source.
    if (!definition) return null;
    const safeTier = Math.max(0, Math.min(4, Math.floor(Number(tier) || 0))); // Stored tier.
    const key = itemKeyForRecipe(recipeId, safeTier); // Stack identity.
    const isThrowingFlask = definition.useMode === 'throw'; // Used to select the authored two-color flask without affecting Afflict narcotics or ordinary potions.
    const flaskColors = isThrowingFlask ? throwingFlaskColors(reagentKeys) : null; // Used to split Afflict vs. remaining ingredient colors for throwable recipes.
    const hasIngredientColors = !!flaskColors?.validKeys.length; // Used to distinguish a real brew from provenance-free shop/treasure/save registration.
    POTION_ITEMS[key] = Object.freeze({ recipeId, potencyTier: safeTier });
    if (deps?.ITEM_DEFS && !deps.ITEM_DEFS[key]) {
      const modeTag = isThrowingFlask ? 'Flask' : definition.useMode === 'livestock' ? 'Livestock' : 'Potion'; // Inventory filter tag.
      const color = mixColor(reagentKeys); // Procedural bottle tint for ordinary potions and the initial fallback before flask-specific splitting.
      deps.ITEM_DEFS[key] = { icon: definition.icon, label: `${definition.label}${safeTier ? ` · Potency ${safeTier + 1}` : ''}`, cat: 'processed', sellPrice: 0, tags: ['Alchemy', modeTag, definition.traits.drive, definition.traits.magnetism], desc: definition.desc, alchemyRecipeId: recipeId, alchemyPotencyTier: safeTier, useMode: definition.useMode, spriteIcon: 'bottle_potion.png', spriteColor: color, spriteMode: 'keyed' };
    }
    const itemDef = deps?.ITEM_DEFS?.[key]; // Used to upgrade throwables from the generic bottle/fallback once ingredient provenance is available.
    if (isThrowingFlask && itemDef && itemDef.alchemyFlaskColorSource !== 'ingredients') applyThrowingFlaskSprite(itemDef, flaskColors, hasIngredientColors ? 'ingredients' : 'fallback');
    return key;
  }
'''
alchemy = replace_once(alchemy, old_ensure, new_ensure, 'ensureRecipeItemDef block')

old_diag = "    lastBrewDiagnostics = { keys, outcomes, target, probability: target ? targetingProbability(targetLevel, outcomes, target) : null, chosenRecipeId: chosen.recipeId, potencyTier: tier, batch, everyIngredientContributes: outcomes.every(outcome => outcome.assignments.every(a => Object.values(a.contributes).every(list => list.length))) }; // Dev report.\n"
new_diag = "    const brewedItemDef = deps?.ITEM_DEFS?.[itemKey]; // Used to expose the actual stored flask colors in mobile-safe diagnostics.\n    const flaskSprite = RECIPE_DEFS[chosen.recipeId]?.useMode === 'throw' ? { spriteIcon: brewedItemDef?.spriteIcon || null, primaryColor: brewedItemDef?.spriteColor == null ? null : `#${flaskColorHex(brewedItemDef.spriteColor)}`, afflictColor: brewedItemDef?.spriteSecondaryColor == null ? null : `#${flaskColorHex(brewedItemDef.spriteSecondaryColor)}`, afflictKeys: [...(brewedItemDef?.alchemyFlaskAfflictKeys || [])], otherKeys: [...(brewedItemDef?.alchemyFlaskOtherKeys || [])], colorSource: brewedItemDef?.alchemyFlaskColorSource || null } : null; // Dev report for the special throwing-flask palette split.\n    lastBrewDiagnostics = { keys, outcomes, target, probability: target ? targetingProbability(targetLevel, outcomes, target) : null, chosenRecipeId: chosen.recipeId, potencyTier: tier, batch, flaskSprite, everyIngredientContributes: outcomes.every(outcome => outcome.assignments.every(a => Object.values(a.contributes).every(list => list.length))) }; // Dev report.\n"
alchemy = replace_once(alchemy, old_diag, new_diag, 'lastBrewDiagnostics')

old_export = '    itemKeyForRecipe,parseBrewedItemKey,ensureRecipeItemDef,recipeScrollKey,ensureRecipeScrollItemDef,readRecipeItem,ensurePotionItemDef,getPotionEffectsFromKey,migrateLegacyPotionInventory,consumeRawReagent,drinkPotion,consumeBrewedItem:drinkPotion,applyRecipeToEntity,\n'
new_export = '    itemKeyForRecipe,parseBrewedItemKey,throwingFlaskColors,ensureRecipeItemDef,recipeScrollKey,ensureRecipeScrollItemDef,readRecipeItem,ensurePotionItemDef,getPotionEffectsFromKey,migrateLegacyPotionInventory,consumeRawReagent,drinkPotion,consumeBrewedItem:drinkPotion,applyRecipeToEntity,\n'
alchemy = replace_once(alchemy, old_export, new_export, 'AlchemySystem export')
alchemy_path.write_text(alchemy)

recolor_path = Path('docs/js/sprite-recolor.js')
recolor = recolor_path.read_text()
loader = '''  function loadAlchemyFlaskSpriteForGame(){
    if(typeof document==='undefined'||!document.getElementById('alchemyReagentList'))return;
    parserOrderedScript('alchemy-flask-sprite.js','alchemy-flask-sprite','20261013afflict1',()=>!!window.AlchemyFlaskSprite);
  }
'''
recolor = replace_once(recolor, loader, '', 'temporary flask adapter loader')
recolor = replace_once(recolor, '  loadAlchemyFlaskSpriteForGame();\n', '', 'temporary flask adapter call')
recolor_path.write_text(recolor)

Path('docs/js/alchemy-flask-sprite.js').unlink(missing_ok=True)
