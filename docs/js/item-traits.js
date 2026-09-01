// Item Traits — the shared vocabulary of descriptive tags every item in the
// game can carry (what it fundamentally IS, what it's FOR, and — for dyed
// clothing — what it LOOKS like), read by the gifting system (npc-gifting.js)
// to compare a held item against an NPC's likes/loves/dislikes/hates, and
// editable through tools/item-database-editor.
//
// Traits come from four layers, merged in this order (earliest = shown
// first, matching "basic type traits go first"):
//   1. Type       — one trait naming what kind of thing the item is (fish,
//                    wood, ore/mineral, crop, meal, tool, ...). Derived
//                    automatically from the same category system that
//                    colors/sorts the item wheel (item-arch-category-colors.js),
//                    unless config/items/item-traits.json overrides it.
//   2. Purpose     — what the item is used for (food, alcohol, medicine,
//                    fuel, wearable, instrument, valuable, ...). A handful
//                    are inferred from existing ITEM_DEFS flags/tags; the
//                    rest live in config/items/item-traits.json.
//   3. Color       — clothing only: hue (in-between hues get both bands),
//                    saturation (hot/muted), value (dark/bright), derived
//                    from the actual dyed color of the specific worn/held
//                    instance (colorA/colorB), not a fixed per-garment value.
//   4. Inherited   — food/processed goods take on every trait (except type)
//                    of the ingredients that made them (def.ingredientKeys).
//
// config/items/item-traits.json is the one hand-curated layer (trait
// vocabulary + manual per-item additions/overrides); everything else here is
// computed. Extracted following the same window.<Namespace> + init(deps)
// pattern as its sibling systems (see js/npc-scheduling.js).
(() => {
  'use strict';
  if (window.ItemTraits) return;

  let deps = null;
  let traitsData = { traitDefs: {}, items: {} };
  let dataLoadPromise = null;

  function init(injectedDeps) {
    deps = injectedDeps;
    return loadData();
  }

  function loadData() {
    if (dataLoadPromise) return dataLoadPromise;
    const path = 'config/items/item-traits.json';
    dataLoadPromise = (window.LocalDBOverrides
      ? window.LocalDBOverrides.loadDatabase('itemTraits')
      : fetch(path).then(r => r.ok ? r.json() : null))
      .catch(() => null)
      .then(json => {
        if (json && typeof json === 'object') {
          traitsData = {
            traitDefs: json.traitDefs || {},
            items: json.items || {},
          };
        }
        return traitsData;
      });
    return dataLoadPromise;
  }

  // ── Trait vocabulary lookups ────────────────────────────────────────
  function getTraitDefs() { return traitsData.traitDefs; }
  function getTraitDef(traitId) { return traitsData.traitDefs[traitId] || null; }
  function getTraitLabel(traitId) {
    return traitsData.traitDefs[traitId]?.label || traitId;
  }
  function getTraitGroup(traitId) {
    return traitsData.traitDefs[traitId]?.group || 'other';
  }

  // ── Type trait (always first) ───────────────────────────────────────
  function deriveTypeTrait(key, def) {
    const cat = window.ItemArchCategoryColors?.categoryFor?.(key)
      || def?.cat
      || 'other';
    return cat;
  }

  // ── Purpose traits inferred straight from existing item flags ───────
  function derivePurposeTraits(def) {
    if (!def) return [];
    const out = [];
    const tags = (def.tags || []).map(t => String(t).toLowerCase());
    const hay = `${def.label || ''} ${tags.join(' ')}`.toLowerCase();
    if (def.isCookedFood || tags.includes('food') || /\bfood\b/.test(hay)) out.push('food');
    if (def.isInstrument) out.push('instrument');
    if (/\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirits?|beer|ale|mead|cider)\b/.test(hay)) out.push('alcohol', 'beverage');
    if (tags.includes('seed') || tags.includes('plantable')) out.push('seed');
    if (tags.includes('weapon')) out.push('weapon');
    if (tags.includes('tool')) out.push('tool');
    if (def.foodEffects?.health > 0 || /\btonic|restorative|medicine|remedy\b/.test(hay)) out.push('medicine');
    if ((Number(def.sellPrice) || 0) >= 40) out.push('valuable');
    return out;
  }

  // ── Color traits (clothing only, per dyed instance) ─────────────────
  // Centers match the game's own dye hue-family wheel exactly (see
  // config/scratchbones-config.js's hueFamilies — the same table that names
  // "Red-Orange"/"Yellow-Green"/etc. mystery-dye pools), keeping only the
  // seven non-compound family names as traits. The compound families
  // (Red-Orange, Yellow-Green, ...) aren't traits of their own — a dye at
  // exactly one of those hues is, by construction, equidistant between two
  // pure centers, so the blend rule below naturally awards both of that
  // pure pair's traits instead (e.g. true red-orange -> Red + Orange).
  const HUE_BANDS = [
    { id: 'hueRed', center: 0 },
    { id: 'hueOrange', center: 30 },
    { id: 'hueYellow', center: 60 },
    { id: 'hueGreen', center: 120 },
    { id: 'hueBlue', center: 240 },
    { id: 'hueIndigo', center: 270 },
    { id: 'hueViolet', center: 300 },
  ];
  const HUE_BLEND_MARGIN = 8; // Degrees: how much closer the nearest center must be before the second-nearest is dropped.

  function angularDelta(a, b) {
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  function hueTraitsFor(hue) {
    if (!Number.isFinite(hue)) return [];
    const distances = HUE_BANDS.map(band => ({ band, dist: angularDelta(hue, band.center) }))
      .sort((a, b) => a.dist - b.dist);
    const nearest = distances[0];
    const secondNearest = distances[1];
    const out = [nearest.band.id];
    // A hue sitting close to equidistant between its two nearest named
    // centers is "in-between" them (e.g. a true red-orange sits exactly
    // equidistant from Red and Orange) and earns both traits, regardless of
    // how far apart those two centers happen to be on this non-uniform wheel.
    if (secondNearest && (secondNearest.dist - nearest.dist) <= HUE_BLEND_MARGIN) {
      out.push(secondNearest.band.id);
    }
    return out;
  }

  function hexToHsv(hex) {
    if (typeof hex !== 'string') return null;
    const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const rf = r / 255, gf = g / 255, bf = b / 255;
    const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
      if (max === rf) h = ((gf - bf) / delta) % 6;
      else if (max === gf) h = (bf - rf) / delta + 2;
      else h = (rf - gf) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : delta / max, v: max };
  }

  function colorTraitsForHsv(hsv) {
    if (!hsv) return [];
    const out = [...hueTraitsFor(hsv.h)];
    out.push((Number(hsv.s) || 0) >= 0.5 ? 'hot' : 'muted');
    out.push((Number(hsv.v) || 0) >= 0.5 ? 'bright' : 'dark');
    return out;
  }

  // Accepts a dye-shaped object ({h,s,v,hex,dyeId}), a raw hex string, or an
  // NPC-style "dye:CLOTH:<id>" appliedDyes reference string.
  //
  // Deliberately prefers the dye's real displayed color (its catalog
  // hueAngle/saturationPercent/brightnessPercent, or failing that its hex)
  // over any .h/.s/.v already sitting on the color object — on a clothing
  // instance's colorA/colorB those fields are the *fitted CSS filter*
  // params (hue-rotate/saturate/brightness offsets baked for the portrait
  // shader, see config/scratchbones-config.js's fittedColors table), not a
  // true HSV triple, so bucketing hue/saturation/value traits from them
  // directly would be nonsense (e.g. filter hue-rotate degrees run negative
  // and don't correspond 1:1 to hueFamilies' 0-300 wheel).
  function catalogHsv(dye) {
    if (!dye) return null;
    if (Number.isFinite(dye.hueAngle) && Number.isFinite(dye.saturationPercent) && Number.isFinite(dye.brightnessPercent)) {
      return { h: dye.hueAngle, s: dye.saturationPercent / 100, v: dye.brightnessPercent / 100 };
    }
    return dye.hex ? hexToHsv(dye.hex) : null;
  }

  function resolveHsv(colorLike) {
    if (!colorLike) return null;
    if (typeof colorLike === 'string') {
      const dyeId = colorLike.includes(':') ? colorLike.split(':').pop() : colorLike;
      const dye = window.DyeSystem?.getById?.(colorLike) || window.DyeSystem?.getById?.(dyeId);
      return catalogHsv(dye) || hexToHsv(colorLike);
    }
    const byDyeId = colorLike.dyeId && window.DyeSystem?.getById?.(colorLike.dyeId);
    if (byDyeId) { const hsv = catalogHsv(byDyeId); if (hsv) return hsv; }
    if (colorLike.hex) return hexToHsv(colorLike.hex);
    if (Number.isFinite(colorLike.h) || Number.isFinite(colorLike.s) || Number.isFinite(colorLike.v)) {
      return { h: colorLike.h || 0, s: colorLike.s || 0, v: colorLike.v ?? 1 };
    }
    return null;
  }

  function isClothingInstance(instance) {
    return !!(instance && (instance.colorA || instance.colorB || instance.cosmeticId
      || ['hat', 'hood', 'torso', 'overwear'].includes(instance.slot)));
  }

  function colorTraitsForInstance(instance) {
    if (!instance) return [];
    const out = [];
    for (const colorLike of [instance.colorA, instance.colorB]) {
      const hsv = resolveHsv(colorLike);
      if (hsv) out.push(...colorTraitsForHsv(hsv));
    }
    return out;
  }

  // ── Inherited traits (food/processed goods take on their ingredients') ──
  function inheritedTraits(def, depth) {
    const keys = Array.isArray(def?.ingredientKeys) ? def.ingredientKeys : [];
    if (!keys.length || depth <= 0) return [];
    const out = [];
    for (const ingredientKey of keys) {
      // Only the purpose/color layers are inherited — an ingredient's own
      // base "type" trait (e.g. a wine's fruit being "berry") would be a
      // misleading first trait on the food that used it, so it's dropped.
      const ingredientTraits = computeItemTraits(ingredientKey, null, depth - 1);
      const ingredientType = deps?.getItemDefs?.()[ingredientKey]
        ? deriveTypeTrait(ingredientKey, deps.getItemDefs()[ingredientKey]) : null;
      for (const t of ingredientTraits) { if (t !== ingredientType) out.push(t); }
    }
    return out;
  }

  const MAX_INHERITANCE_DEPTH = 3;

  function lookupManualEntry(key, instance) {
    return traitsData.items[instance?.cosmeticId] || traitsData.items[key] || null;
  }

  // The one function everything else in this module exists to support:
  // resolves the full, ordered, deduped trait list for an item.
  //   key      — the ITEM_DEFS key (bag items) or cosmeticId (clothing).
  //   instance — optional: the specific owned instance (clothing gear entry
  //              with colorA/colorB, or an NPC's equipped-cosmetic + applied
  //              dye pairing) so color traits reflect what's actually dyed.
  function computeItemTraits(key, instance, depth = MAX_INHERITANCE_DEPTH) {
    if (!key) return [];
    const itemDefs = deps?.getItemDefs?.() || {};
    const def = itemDefs[key] || null;
    const manual = lookupManualEntry(key, instance);
    const ordered = [];
    const seen = new Set();
    const push = (t) => { if (t && !seen.has(t)) { seen.add(t); ordered.push(t); } };

    const clothing = isClothingInstance(instance);
    push(manual?.typeOverride || (clothing ? 'clothing' : deriveTypeTrait(key, def)));
    derivePurposeTraits(def).forEach(push);
    (manual?.traits || []).forEach(push);
    if (clothing) colorTraitsForInstance(instance).forEach(push);
    if (def) inheritedTraits(def, depth).forEach(push);
    return ordered;
  }

  // ── Discovery ─────────────────────────────────────────────────────
  // A trait counts as "discovered" once the player has owned (currently
  // owns, in bag/gear/wardrobe-taken clothing) at least one item carrying
  // it — the gifting UI only calls out an NPC's dislikes/hates for traits
  // the player could plausibly already recognize on sight.
  function getDiscoveredTraitSet() {
    const discovered = new Set();
    const itemDefs = deps?.getItemDefs?.() || {};
    const inventory = deps?.getInventory?.() || {};
    for (const key of Object.keys(inventory)) {
      if (!(Number(inventory[key]) > 0) || !itemDefs[key]) continue;
      computeItemTraits(key, null).forEach(t => discovered.add(t));
    }
    const clothingItems = deps?.getGearInventory?.()?.clothingItems || [];
    for (const item of clothingItems) {
      computeItemTraits(item.cosmeticId || item.uid, item).forEach(t => discovered.add(t));
    }
    return discovered;
  }

  function isTraitDiscovered(traitId) {
    return getDiscoveredTraitSet().has(traitId);
  }

  window.ItemTraits = {
    init,
    getTraitDefs,
    getTraitDef,
    getTraitLabel,
    getTraitGroup,
    computeItemTraits,
    getDiscoveredTraitSet,
    isTraitDiscovered,
    hueTraitsFor,
    colorTraitsForHsv,
    resolveHsv,
  };
})();
