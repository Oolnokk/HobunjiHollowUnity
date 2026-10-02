// NPC Food Gift Preferences — ingredient lineage, artisan classification, and
// data-driven food-like scoring kept separate from ordinary item-trait gifting.
(() => {
  'use strict';
  if (window.NpcFoodGiftPreferences) return;

  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const PREFERENCE_TIERS = ['loved', 'liked', 'disliked', 'hated'];
  const DEFAULT_WEIGHTS = Object.freeze({
    ingredientType: 4,
    artisanType: 4,
    specificIngredient: 8,
    specificIngredientArtisan: 12,
  }); // Used when config omits a weight so reactions remain deterministic.

  function config() {
    return window.HobunjiNpcFoodGiftPreferences || {};
  }

  function normalizeToken(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeSpeciesId(value) {
    const compact = normalizeToken(value).replace(/-/g, ''); // Used to collapse display spellings and legacy ids onto one species preference key.
    if (compact === 'enghsho') return 'engh-sho';
    if (compact === 'maoao' || compact === 'ghoul') return 'mao-ao';
    if (compact === 'kenkari' || compact === 'rakakoan') return 'kenkari';
    return normalizeToken(value);
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
  }

  function mergeFoodLikes(...sources) {
    const merged = { ingredientTypes: [], artisanTypes: [], specificIngredients: [] }; // Used to layer species, per-NPC, and record-authored likes.
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      merged.ingredientTypes.push(...uniqueStrings(source.ingredientTypes));
      merged.artisanTypes.push(...uniqueStrings(source.artisanTypes));
      merged.specificIngredients.push(...uniqueStrings(source.specificIngredients));
    }
    merged.ingredientTypes = uniqueStrings(merged.ingredientTypes.map(normalizeToken));
    merged.artisanTypes = uniqueStrings(merged.artisanTypes.map(normalizeToken));
    merged.specificIngredients = uniqueStrings(merged.specificIngredients);
    return merged;
  }

  function foodLikesForRecord(rec) {
    const cfg = config(); // Used live so database/config overrides do not require rebuilding NPC records.
    const speciesId = normalizeSpeciesId(rec?.appearance?.speciesId || rec?.speciesId || rec?.species); // Used to apply species-wide food defaults.
    const authored = rec?.gifts?.foodLikes || rec?.foodLikes || null; // Future Character Studio data can override/extend the central defaults.
    return mergeFoodLikes(cfg.speciesLikes?.[speciesId], cfg.npcLikes?.[rec?.id], authored);
  }

  function preferenceId(kind, value) {
    return `food:${kind}:${String(value || '')}`;
  }

  function compiledGiftPreferencesForRecord(rec) {
    const base = rec?.gifts || {}; // Used to preserve every ordinary item-trait preference.
    const compiled = {};
    for (const tier of PREFERENCE_TIERS) compiled[tier] = uniqueStrings(base[tier]);
    const likes = foodLikesForRecord(rec); // Used to make discovered food preferences reconcile through gifting's existing save path.
    compiled.liked.push(...likes.ingredientTypes.map(value => preferenceId('type', value)));
    compiled.liked.push(...likes.artisanTypes.map(value => preferenceId('artisan', value)));
    compiled.liked.push(...likes.specificIngredients.map(value => preferenceId('ingredient', value)));
    compiled.liked = uniqueStrings(compiled.liked);
    return compiled;
  }

  function definitionForKey(key) {
    return deps?.getItemDefs?.()?.[key] || null;
  }

  function categoriesForDefinition(def) {
    if (!def) return [];
    const categories = []; // Used to derive broad ingredient identities from cooking metadata with tags as a legacy fallback.
    for (const value of def.cookingCategories || []) categories.push(normalizeToken(value));
    for (const value of def.tags || []) categories.push(normalizeToken(value));
    return uniqueStrings(categories).filter(Boolean);
  }

  function collectIngredientLineage(key, defOverride = null, depth = 4) {
    const lineage = new Set(); // Used to retain both direct ingredients and their raw ancestors for specific-ingredient likes.
    const visited = new Set(); // Used to stop malformed/self-referential item metadata from recursing forever.
    function visit(sourceKey, sourceDef, remainingDepth) {
      if (!sourceKey || visited.has(sourceKey)) return;
      visited.add(sourceKey);
      const children = Array.isArray(sourceDef?.ingredientKeys) ? sourceDef.ingredientKeys.filter(Boolean) : [];
      if (!children.length || remainingDepth <= 0) {
        lineage.add(sourceKey);
        return;
      }
      for (const childKey of children) {
        lineage.add(childKey);
        visit(childKey, definitionForKey(childKey), remainingDepth - 1);
      }
    }
    visit(key, defOverride || definitionForKey(key), depth);
    return [...lineage];
  }

  function artisanTypesForItem(key, def, ingredientTypes) {
    const types = new Set(); // Used to combine explicit future artisan metadata with compatibility inference for existing items.
    const explicit = [
      ...(Array.isArray(def?.artisanGoodTypes) ? def.artisanGoodTypes : []),
      ...(def?.artisanGoodType ? [def.artisanGoodType] : []),
    ];
    explicit.forEach(value => types.add(normalizeToken(value)));

    const tags = (def?.tags || []).map(value => normalizeToken(value)); // Used by compatibility classifiers below.
    const hay = `${key || ''} ${def?.label || ''} ${tags.join(' ')}`.toLowerCase(); // Used for old defs that predate artisanGoodType.
    const alcohol = window.ItemProcessing?.isAlcoholItemDef?.(def)
      || /\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirits?|beer|ale|mead|cider)\b/.test(hay);
    if (alcohol) types.add('alcohol');

    const categorySet = new Set(ingredientTypes || []); // Used to avoid classifying every dried crop as jerky.
    if (/\bjerky\b/.test(hay) || (categorySet.has('meat') && /\b(smoked|dried)\b/.test(hay))) types.add('jerky');
    return [...types].filter(Boolean);
  }

  function foodPreferenceContextForItem(key, defOverride = null) {
    const def = defOverride || definitionForKey(key);
    if (!key || !def) return { isFood: false, isArtisan: false, ingredientTypes: [], artisanTypes: [], ingredientKeys: [] };

    const ingredientKeys = collectIngredientLineage(key, def); // Used by specific likes, including nested cooked/processed ingredients.
    const categorySet = new Set(categoriesForDefinition(def)); // Used to aggregate broad ingredient types across the complete lineage.
    for (const ingredientKey of ingredientKeys) categoriesForDefinition(definitionForKey(ingredientKey)).forEach(category => categorySet.add(category));
    const ingredientTypes = [...categorySet];
    const artisanTypes = artisanTypesForItem(key, def, ingredientTypes);
    const cat = normalizeToken(def.cat); // Used to keep non-food materials with incidental lineage metadata out of scoring.
    const isFood = !!def.isCookedFood
      || ['food', 'ingredient', 'processed', 'crop'].includes(cat)
      || (Array.isArray(def.cookingCategories) && def.cookingCategories.length > 0)
      || artisanTypes.length > 0;
    return { isFood, isArtisan: artisanTypes.length > 0, ingredientTypes, artisanTypes, ingredientKeys };
  }

  function matchingIngredientKey(preferredKey, ingredientKeys) {
    const exact = (ingredientKeys || []).find(key => key === preferredKey); // Used to preserve canonical item-key labels when an exact key is present.
    if (exact) return exact;
    const wanted = normalizeToken(preferredKey); // Used only as a compatibility fallback for case/spelling normalization.
    return (ingredientKeys || []).find(key => normalizeToken(key) === wanted) || null;
  }

  function evaluateFoodLikes(rec, context) {
    const matches = []; // Synthetic ids are persisted/discovered beside ordinary trait ids.
    if (!context?.isFood) return { score: 0, matches };
    const likes = foodLikesForRecord(rec); // Used to merge species and individual likes for this reaction.
    const weights = { ...DEFAULT_WEIGHTS, ...(config().weights || {}) }; // Used to centralize balancing in data rather than runtime branches.

    let score = 0; // Food-only score is added to ordinary trait score by npc-gifting.js.
    const typeSet = new Set(context.ingredientTypes || []); // Used for O(1) broad-category matching.
    for (const type of likes.ingredientTypes) {
      if (!typeSet.has(type)) continue;
      matches.push(preferenceId('type', type));
      score += Number(weights.ingredientType) || DEFAULT_WEIGHTS.ingredientType;
    }

    const artisanSet = new Set(context.artisanTypes || []); // Used for O(1) artisan-type matching.
    for (const type of likes.artisanTypes) {
      if (!artisanSet.has(type)) continue;
      matches.push(preferenceId('artisan', type));
      score += Number(weights.artisanType) || DEFAULT_WEIGHTS.artisanType;
    }

    for (const preferredKey of likes.specificIngredients) {
      const matchedKey = matchingIngredientKey(preferredKey, context.ingredientKeys); // Used to verify the favorite ingredient actually survives into this food.
      if (!matchedKey) continue;
      matches.push(preferenceId('ingredient', preferredKey));
      const weightKey = context.isArtisan ? 'specificIngredientArtisan' : 'specificIngredient'; // Used to boost favorite ingredients specifically after artisan processing.
      score += Number(weights[weightKey]) || DEFAULT_WEIGHTS[weightKey];
    }
    return { score, matches: uniqueStrings(matches) };
  }

  function getPreferenceLabel(id) {
    const value = String(id || '');
    const cfg = config(); // Used to render synthetic food preference ids in human-readable relationship UI.
    if (value.startsWith('food:type:')) {
      const key = value.slice('food:type:'.length);
      return cfg.ingredientTypeLabels?.[key] || key.replace(/(^|-)([a-z])/g, (_, gap, letter) => (gap ? ' ' : '') + letter.toUpperCase());
    }
    if (value.startsWith('food:artisan:')) {
      const key = value.slice('food:artisan:'.length);
      return cfg.artisanTypeLabels?.[key] || key.replace(/(^|-)([a-z])/g, (_, gap, letter) => (gap ? ' ' : '') + letter.toUpperCase());
    }
    if (value.startsWith('food:ingredient:')) {
      const key = value.slice('food:ingredient:'.length);
      return definitionForKey(key)?.label || key;
    }
    return value;
  }

  window.NpcFoodGiftPreferences = {
    version: 1,
    init,
    normalizeSpeciesId,
    foodLikesForRecord,
    compiledGiftPreferencesForRecord,
    foodPreferenceContextForItem,
    evaluateFoodLikes,
    getPreferenceLabel,
  };
})();
