// Shared authored-object inventory art. Runtime ITEM_DEFS remain the authority for item identity.
// This catalogue changes presentation only; renderer and held-object code share the same metadata.
(() => {
  'use strict';
  if (window.ObjectSpriteCatalog) return;

  const reticleColors = window.MeleeHudReticle?.slotColors; // Reticle is loaded earlier than this catalogue in docs/index.html.
  const parseSlotColor = (slot, fallback) => {
    const source = reticleColors?.[slot]; // Reuses one combat-UI palette rather than maintaining an independent tint.
    return /^#[0-9a-f]{6}$/i.test(source || '') ? parseInt(source.slice(1), 16) : fallback;
  };
  const SLOT_COLORS = Object.freeze({
    combo: parseSlotColor(0, 0x00D9FF), quickAttack: parseSlotColor(1, 0xFFD23F),
    offensiveHold: parseSlotColor(2, 0xFF4FD8), defensiveHold: parseSlotColor(3, 0x7CFF4F),
  }); // Standalone test/editor fallback mirrors the same canonical quartet.
  const PAPER_COLOR = 0xE7D5AF; // Warm paper fill for scroll.png, independent of binding color.
  const METAL_COLORS = Object.freeze({
    copper: 0xBD754B, tin: 0xC1C5C6, bronze: 0xAA8050,
    iron: 0x81848A, steel: 0xACBEC3, silver: 0xC7CFDF,
    gold: 0xD8AE49, lead: 0x80818A, zinc: 0xB7BABF,
    nickel: 0xB9C1B3, mithril: 0x91B6D6, stone: 0x79766C,
  }); // Fallbacks only; an item's explicitly authored material color takes precedence.
  const NO_OVERRIDE = new Set(['gold', 'ganang']); // Currency is not a physical gold-ore/ingot stack.
  const seen = new WeakMap(); // Avoid reassigning sprite metadata on every HUD repaint.
  let patched = 0; // Number of item definitions receiving newly authored sprite metadata.
  let last = null; // Most recent item/art choice for in-game/mobile diagnostics.

  function parseColor(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value & 0xFFFFFF;
    if (typeof value !== 'string') return null;
    const clean = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(clean)) return parseInt(clean.slice(1), 16);
    if (/^0x[0-9a-f]{6}$/i.test(clean)) return parseInt(clean.slice(2), 16);
    return null;
  }

  function materialColor(key, def, fallback) {
    for (const value of [def?.ingredientColor, def?.rockMetalHex, def?.metalHex, def?.hex, def?.color, def?.tint, def?.spriteColor]) {
      const parsed = parseColor(value); // Keeps the already-authored mineral/ingredient tint if one exists.
      if (parsed != null) return parsed;
    }
    const name = (String(key) + ' ' + String(def?.label || '')).toLowerCase();
    for (const [metal, color] of Object.entries(METAL_COLORS)) {
      if (name.includes(metal)) return color;
    }
    return fallback;
  }

  function combatCategoryForAbility(id) {
    const category = window.Combat?.abilities?.get?.(id)?.category; // Technique manuals use the actual combat registry, not their titles.
    return Object.prototype.hasOwnProperty.call(SLOT_COLORS, category) ? category : null;
  }

  function bindingCategory(key, def) {
    if (def?.combatManualAbilityId) return combatCategoryForAbility(def.combatManualAbilityId) || 'combo';
    if (def?.attackCategory && SLOT_COLORS[def.attackCategory]) return def.attackCategory;
    if (def?.techniqueScrollTier) {
      // Tiered scrolls are randomized, not one guaranteed move; tint by their most likely learnable family.
      return { 1: 'defensiveHold', 2: 'quickAttack', 3: 'offensiveHold' }[def.techniqueScrollTier] || 'combo';
    }
    if (def?.masteryUnlock) {
      // Mastery lessons apply across several attacks: without one exclusive action category,
      // use the common combo color instead of falsely indicating a single held slot.
      return 'combo';
    }
    const description = String(key) + ' ' + String(def?.label || '') + ' ' + String(def?.desc || '');
    if (/defensive\s*hold|block|parry|dodge/i.test(description)) return 'defensiveHold';
    if (/offensive\s*hold|charged\s*attack|flurry/i.test(description)) return 'offensiveHold';
    if (/quick\s*attack/i.test(description)) return 'quickAttack';
    return 'combo';
  }

  function classify(key, def = {}) {
    if (!key || NO_OVERRIDE.has(key)) return null;
    const label = String(def.label || key);
    const joined = String(key) + ' ' + label;
    const tags = Array.isArray(def.tags) ? def.tags.join(' ') : '';
    const context = joined + ' ' + tags;
    // Lessons are always a priority, even when a legacy definition has another spriteIcon.
    if (def.masteryUnlock && /tablet/i.test(key)) {
      return { spriteIcon: 'stone_tablet.png', spriteColor: 0xA79D87, spriteMode: 'direct' };
    }
    if (def.masteryUnlock || def.combatManualAbilityId || def.techniqueScrollTier
        || /scroll|manual|blueprint|recipe\s*(sheet|book|page)|schematic/i.test(context)) {
      const category = bindingCategory(key, def); // Bind only the outer ribbon; paper stays beige.
      return { spriteIcon: 'scroll.png', spriteColor: PAPER_COLOR,
        spriteMode: 'layered-scroll:' + SLOT_COLORS[category].toString(16).padStart(6, '0') };
    }
    if (/tablet|rune\s*slab|inscribed\s*stone/i.test(joined)) {
      return { spriteIcon: 'stone_tablet.png', spriteColor: materialColor(key, def, 0x9C998B), spriteMode: 'direct' };
    }
    if (/\b(ore|ores)\b|(^|[_:-])ore([_:-]|$)/i.test(joined)) {
      return { spriteIcon: 'ore.png', spriteColor: materialColor(key, def, 0x967967), spriteMode: 'direct' };
    }
    if (/\b(ingots?|bars?)\b|(^|[_:-])(bar|ingot)([_:-]|$)/i.test(joined)) {
      return { spriteIcon: 'ingot.png', spriteColor: materialColor(key, def, 0xB6A18B), spriteMode: 'direct' };
    }
    if (/berries|berry/i.test(joined) || /\bberries\b/i.test(tags)) {
      return { spriteIcon: 'berries.png', spriteColor: materialColor(key, def, 0xBC4568), spriteMode: 'direct' };
    }
    if (/\b(powder|flour|dust|ground\s+spice|spice\s+mix|ash|ashes|meal\s+powder|grist)\b/i.test(joined) || /narcotic/i.test(tags)) {
      const koma = /koma|iridescen/i.test(context);
      return { spriteIcon: 'powder.png', spriteColor: koma ? 0xF8F6F5 : materialColor(key, def, 0xD0B99C),
        spriteMode: koma ? 'direct-sheen' : 'direct' };
    }
    if (/\b(leaves|leaf|petals?|herbs?)\b|(^|[_:-])(leaf|herb)([_:-]|$)/i.test(joined)) {
      // Respect a bespoke crop/reagent rendering where one has already been authored.
      if (def.spriteIcon && !/^(?:leaf|herb|item|plant)[_.-]/i.test(def.spriteIcon)) return null;
      return { spriteIcon: '../leaves/speartip_leaf.png', spriteColor: materialColor(key, def, 0x6BA153), spriteMode: 'direct' };
    }
    return null;
  }

  function assignArt(key, def, art) {
    if (!def || !art) return null;
    const signature = art.spriteIcon + '|' + art.spriteMode + '|' + art.spriteColor;
    if (seen.get(def) === signature) return art;
    try {
      def.spriteIcon = art.spriteIcon;
      def.spriteColor = art.spriteColor;
      def.spriteMode = art.spriteMode;
      seen.set(def, signature);
      patched++;
      last = { key, ...art };
    } catch (error) {
      window.__farmLog?.('[object-art] Could not apply ' + key + ': ' + error.message, 'warn');
    }
    return art;
  }

  function ensure(key, def) {
    if (!def || typeof def !== 'object') return null;
    const alreadyAssigned = def.spriteIcon === 'scroll.png' && /^layered-scroll:[0-9a-f]{6}$/i.test(def.spriteMode || '')
      && !def.combatManualAbilityId && !def.techniqueScrollTier && !def.masteryUnlock && !def.attackCategory;
    // Selectable item-wheel entries lack the canonical item's attack metadata.
    // Preserve the previously copied slot tint instead of guessing "combo" from the entry's short title.
    const art = alreadyAssigned
      ? { spriteIcon: def.spriteIcon, spriteColor: def.spriteColor, spriteMode: def.spriteMode }
      : classify(key, def);
    return assignArt(key, def, art);
  }

  function applyAll(deps) {
    const definitions = deps?.ITEM_DEFS; // Canonical metadata; the catalogue never creates or changes owned quantities.
    if (!definitions) return 0;
    let count = 0;
    for (const [key, def] of Object.entries(definitions)) if (ensure(key, def)) count++;
    for (const entry of deps.inventoryItems || []) if (entry?.key && definitions[entry.key]) {
      const art = classify(entry.key, definitions[entry.key]);
      if (art) assignArt(entry.key, entry, art); // Copy exact canonical category/color, even if this selectable entry has only a key/label.
    }
    return count;
  }

  window.ObjectSpriteCatalog = Object.freeze({
    SLOT_COLORS, PAPER_COLOR, classify, bindingCategory, ensure, applyAll,
    getDebug: () => ({ patched, last, slotColors: SLOT_COLORS }),
  });
})();
