// NPC Gifting — lets the player hand whatever they're holding (a bag item
// via the wheel, or clothing via the new inventory "Hold" button, see
// game.js's getHeldGiftItem) to a nearby NPC. Ordinary reactions are driven
// by item TRAITS (js/item-traits.js) matched against each NPC's
// gifts.{loved,liked,disliked,hated} trait-id lists. Food adds a second,
// data-driven layer: broad ingredient-type likes, artisan-good likes, and
// specific ingredient likes can contribute alongside those ordinary traits.
//
// Wired into the existing interaction-popup/action-bar system the same way
// alcohol-gameplay-bridge.js's npc_offer_alcohol_swig already is (see
// game.js's computeActionButtons NPC-nearby branch and its dispatch site) —
// this module owns only the gift-specific decision/reaction logic.
//
// Clothing is special-cased for acceptance only, not reaction: whether an
// NPC decides to keep a gifted garment (vs. hand it back) is owned by
// js/npc-wardrobe.js (their default-clothing-trait whitelist), while the
// like/love/dislike/hate reaction below still applies uniformly to every
// item, clothing included.
(() => {
  'use strict';
  if (window.NpcGifting) return;

  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Per-NPC gift-preference traits the player has actually learned about by
  // gifting them something and seeing the reaction — separate from
  // js/item-traits.js's discovered-ITEM-traits (which is about the player
  // recognizing a trait on their own belongings). Shown in the
  // Relationships tab (js/relationships-panel.js) so "this NPC likes Hot
  // colors" becomes visible knowledge once actually discovered, not
  // spoiled from gifts.json up front. Persisted (see serialize/restore).
  const discoveredPrefs = {}; // npcId -> { loved: Set, liked: Set, disliked: Set, hated: Set }

  function ensureDiscoveredBucket(npcId) {
    return discoveredPrefs[npcId] || (discoveredPrefs[npcId] = { loved: new Set(), liked: new Set(), disliked: new Set(), hated: new Set() });
  }

  function recordDiscoveredTraits(npcId, tier, traitIds) {
    if (!npcId || tier === 'neutral' || !traitIds.length) return;
    const bucket = ensureDiscoveredBucket(npcId);
    traitIds.forEach(t => bucket[tier].add(t));
  }

  function canonicalGiftPreferences(npcId) {
    const rec = deps?.getNpcRecordById?.(npcId); // Used to rebuild both ordinary trait preferences and current food-like defaults for discovery reconciliation.
    return rec ? compiledGiftPreferencesForRecord(rec) : null;
  }

  function reconcileDiscoveredBucket(npcId, bucket) {
    const canonical = canonicalGiftPreferences(npcId);
    if (!bucket || !canonical) return bucket;

    const discovered = new Set(); // Preserves which traits the player actually learned while allowing their current authored tier to change.
    for (const tier of PREFERENCE_TIERS) for (const trait of bucket[tier] || []) discovered.add(trait);
    const next = { loved: new Set(), liked: new Set(), disliked: new Set(), hated: new Set() };
    for (const trait of discovered) {
      const currentTier = PREFERENCE_TIERS.find(tier => (canonical[tier] || []).includes(trait));
      if (currentTier) next[currentTier].add(trait); // Traits removed from current preferences are forgotten; changed traits move to their current tier.
    }
    discoveredPrefs[npcId] = next;
    return next;
  }

  function reconcileAllDiscoveredPrefs() {
    for (const [npcId, bucket] of Object.entries(discoveredPrefs)) reconcileDiscoveredBucket(npcId, bucket);
  }

  function getDiscoveredGiftTraits(npcId) {
    const bucket = reconcileDiscoveredBucket(npcId, discoveredPrefs[npcId]);
    if (!bucket) return { loved: [], liked: [], disliked: [], hated: [] };
    return { loved: [...bucket.loved], liked: [...bucket.liked], disliked: [...bucket.disliked], hated: [...bucket.hated] };
  }

  function serializeDiscoveredPrefs() {
    reconcileAllDiscoveredPrefs(); // Save only current truth so one successful load permanently cleans obsolete learned tiers from older worlds.
    const out = {};
    for (const [npcId, bucket] of Object.entries(discoveredPrefs)) {
      out[npcId] = { loved: [...bucket.loved], liked: [...bucket.liked], disliked: [...bucket.disliked], hated: [...bucket.hated] };
    }
    return out;
  }

  function restoreDiscoveredPrefs(data) {
    Object.keys(discoveredPrefs).forEach(k => delete discoveredPrefs[k]);
    for (const [npcId, bucket] of Object.entries(data || {})) {
      discoveredPrefs[npcId] = {
        loved: new Set(bucket?.loved || []), liked: new Set(bucket?.liked || []),
        disliked: new Set(bucket?.disliked || []), hated: new Set(bucket?.hated || []),
      };
    }
    reconcileAllDiscoveredPrefs(); // Existing saves self-heal immediately when authored NPC preferences change between versions.
  }

  const PREFERENCE_TIERS = ['loved', 'liked', 'disliked', 'hated'];
  const TIER_FAVOR = { loved: 10, liked: 4, neutral: 1, disliked: -4, hated: -10 };
  const TIER_VERBS = {
    loved: 'lights up over',
    liked: 'is happy with',
    neutral: 'accepts',
    disliked: 'isn\'t thrilled with',
    hated: 'is upset by',
  };


  const DEFAULT_FOOD_MATCH_WEIGHTS = Object.freeze({
    ingredientType: 4,
    artisanType: 4,
    specificIngredient: 8,
    specificIngredientArtisan: 12,
  }); // Used when the optional food-gift config omits a weight so gifting remains deterministic.

  function foodGiftConfig() {
    return window.HobunjiNpcFoodGiftPreferences || {};
  }

  function normalizeFoodToken(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeSpeciesId(value) {
    const compact = normalizeFoodToken(value).replace(/-/g, ''); // Used to collapse authored display spellings and runtime ids onto one species preference key.
    if (compact === 'enghsho') return 'engh-sho';
    if (compact === 'maoao' || compact === 'ghoul') return 'mao-ao';
    if (compact === 'kenkari' || compact === 'rakakoan') return 'kenkari';
    return normalizeFoodToken(value);
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
  }

  function mergeFoodLikes(...sources) {
    const merged = { ingredientTypes: [], artisanTypes: [], specificIngredients: [] }; // Used to layer species defaults, NPC overrides, and record-authored likes without duplicates.
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      merged.ingredientTypes.push(...uniqueStrings(source.ingredientTypes));
      merged.artisanTypes.push(...uniqueStrings(source.artisanTypes));
      merged.specificIngredients.push(...uniqueStrings(source.specificIngredients));
    }
    merged.ingredientTypes = uniqueStrings(merged.ingredientTypes).map(normalizeFoodToken);
    merged.artisanTypes = uniqueStrings(merged.artisanTypes).map(normalizeFoodToken);
    merged.specificIngredients = uniqueStrings(merged.specificIngredients);
    return merged;
  }

  function foodLikesForRecord(rec) {
    const cfg = foodGiftConfig(); // Used to read live config so local overrides/reloads do not require rebuilding NPC records.
    const speciesId = normalizeSpeciesId(rec?.appearance?.speciesId || rec?.speciesId || rec?.species);
    const authored = rec?.gifts?.foodLikes || rec?.foodLikes || null; // Allows future Character Studio authoring directly on an NPC without removing central defaults.
    return mergeFoodLikes(cfg.speciesLikes?.[speciesId], cfg.npcLikes?.[rec?.id], authored);
  }

  function preferenceId(kind, value) {
    return `food:${kind}:${String(value || '')}`;
  }

  function compiledGiftPreferencesForRecord(rec) {
    const base = rec?.gifts || {}; // Used to preserve every pre-existing trait preference tier.
    const compiled = {};
    for (const tier of PREFERENCE_TIERS) compiled[tier] = uniqueStrings(base[tier]);
    const foodLikes = foodLikesForRecord(rec); // Used to make food discoveries reconcile through the same persistence path as ordinary trait discoveries.
    compiled.liked.push(...foodLikes.ingredientTypes.map(value => preferenceId('type', value)));
    compiled.liked.push(...foodLikes.artisanTypes.map(value => preferenceId('artisan', value)));
    compiled.liked.push(...foodLikes.specificIngredients.map(value => preferenceId('ingredient', value)));
    compiled.liked = uniqueStrings(compiled.liked);
    return compiled;
  }

  function definitionForKey(key) {
    return deps?.getItemDefs?.()?.[key] || null;
  }

  function categoriesForDefinition(def) {
    if (!def) return [];
    const categories = []; // Used to derive broad food identities from the canonical cooking metadata, with tags as a legacy fallback.
    for (const value of def.cookingCategories || []) categories.push(normalizeFoodToken(value));
    for (const value of def.tags || []) categories.push(normalizeFoodToken(value));
    return uniqueStrings(categories).filter(Boolean);
  }

  function collectIngredientLineage(key, defOverride = null, depth = 4) {
    const lineage = new Set(); // Used to keep both direct ingredients and their raw ancestors available for specific-ingredient preferences.
    const visited = new Set(); // Used to stop malformed/self-referential processed-item metadata from recursing forever.
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

  function artisanTypesForItem(key, def, ingredientCategories) {
    const types = new Set(); // Used to combine explicit future artisan metadata with compatibility inference for today's alcohol/smoked-meat items.
    const explicit = [
      ...(Array.isArray(def?.artisanGoodTypes) ? def.artisanGoodTypes : []),
      ...(def?.artisanGoodType ? [def.artisanGoodType] : []),
    ];
    explicit.forEach(value => types.add(normalizeFoodToken(value)));

    const tags = (def?.tags || []).map(value => normalizeFoodToken(value)); // Used by compatibility classifiers below.
    const hay = `${key || ''} ${def?.label || ''} ${tags.join(' ')}`.toLowerCase(); // Used when old item defs predate explicit artisanGoodType metadata.
    const isAlcohol = window.ItemProcessing?.isAlcoholItemDef?.(def)
      || /\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirits?|beer|ale|mead|cider)\b/.test(hay);
    if (isAlcohol) types.add('alcohol');

    const categorySet = new Set(ingredientCategories || []); // Used to avoid calling every dried crop "jerky".
    if (/\bjerky\b/.test(hay) || (categorySet.has('meat') && /\b(smoked|dried)\b/.test(hay))) types.add('jerky');
    return [...types].filter(Boolean);
  }

  function foodPreferenceContextForItem(key, defOverride = null) {
    const def = defOverride || definitionForKey(key);
    if (!key || !def) return { isFood: false, isArtisan: false, ingredientTypes: [], artisanTypes: [], ingredientKeys: [] };

    const ingredientKeys = collectIngredientLineage(key, def); // Used by specific ingredient likes, including ingredients nested inside cooked/processed foods.
    const categorySet = new Set(categoriesForDefinition(def)); // Used to aggregate broad ingredient types across the complete lineage.
    for (const ingredientKey of ingredientKeys) categoriesForDefinition(definitionForKey(ingredientKey)).forEach(category => categorySet.add(category));
    const ingredientTypes = [...categorySet];
    const artisanTypes = artisanTypesForItem(key, def, ingredientTypes);
    const cat = normalizeFoodToken(def.cat); // Used to keep non-food materials with incidental ingredientKeys out of food preference scoring.
    const isFood = !!def.isCookedFood
      || ['food', 'ingredient', 'processed', 'crop'].includes(cat)
      || (Array.isArray(def.cookingCategories) && def.cookingCategories.length > 0)
      || artisanTypes.length > 0;
    return { isFood, isArtisan: artisanTypes.length > 0, ingredientTypes, artisanTypes, ingredientKeys };
  }

  function matchingIngredientKey(preferredKey, ingredientKeys) {
    const exact = (ingredientKeys || []).find(key => key === preferredKey); // Used to preserve canonical item-key labels when an exact authored key is present.
    if (exact) return exact;
    const wanted = normalizeFoodToken(preferredKey);
    return (ingredientKeys || []).find(key => normalizeFoodToken(key) === wanted) || null;
  }

  function evaluateFoodLikes(rec, context) {
    const matches = []; // Synthetic preference ids are persisted/discovered beside ordinary trait ids.
    if (!context?.isFood) return { score: 0, matches };
    const likes = foodLikesForRecord(rec); // Used to merge species-wide and individual likes for this one reaction.
    const configuredWeights = foodGiftConfig().weights || {}; // Used to allow balance tuning without editing runtime code.
    const weights = { ...DEFAULT_FOOD_MATCH_WEIGHTS, ...configuredWeights };

    let score = 0; // Additive food-only score joins the ordinary trait score in evaluateGiftReaction.
    const typeSet = new Set(context.ingredientTypes || []);
    for (const type of likes.ingredientTypes) {
      if (!typeSet.has(type)) continue;
      matches.push(preferenceId('type', type));
      score += Number(weights.ingredientType) || DEFAULT_FOOD_MATCH_WEIGHTS.ingredientType;
    }

    const artisanSet = new Set(context.artisanTypes || []);
    for (const type of likes.artisanTypes) {
      if (!artisanSet.has(type)) continue;
      matches.push(preferenceId('artisan', type));
      score += Number(weights.artisanType) || DEFAULT_FOOD_MATCH_WEIGHTS.artisanType;
    }

    for (const preferredKey of likes.specificIngredients) {
      const matchedKey = matchingIngredientKey(preferredKey, context.ingredientKeys);
      if (!matchedKey) continue;
      matches.push(preferenceId('ingredient', preferredKey));
      const weightKey = context.isArtisan ? 'specificIngredientArtisan' : 'specificIngredient'; // Used to make favorite ingredients matter even more after artisan processing.
      score += Number(weights[weightKey]) || DEFAULT_FOOD_MATCH_WEIGHTS[weightKey];
    }
    return { score, matches: uniqueStrings(matches) };
  }

  function getPreferenceLabel(id) {
    const value = String(id || '');
    const cfg = foodGiftConfig(); // Used to label synthetic food discoveries in the Relationships panel.
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
    return window.ItemTraits?.getTraitLabel?.(value) || value;
  }

  function evaluateHeldGift(rec, held) {
    const traits = traitsForHeld(held); // Used to preserve the original item-trait reaction alongside food-specific scoring.
    if (held?.kind === 'clothing') return { ...evaluateGiftReaction(rec?.gifts || {}, traits), traits, foodContext: null, foodScore: 0 };
    const foodContext = foodPreferenceContextForItem(held?.key, itemDefFor(held)); // Used to inspect actual ingredient lineage/artisan identity without creating duplicate item traits.
    const foodEvaluation = evaluateFoodLikes(rec, foodContext); // Used as the additive food contribution to this gift's final reaction.
    return { ...evaluateGiftReaction(rec?.gifts || {}, traits, foodEvaluation), traits, foodContext, foodScore: foodEvaluation.score };
  }

  function debugGiftEvaluation(rec, held = deps?.getHeldGiftItem?.()) {
    const evaluation = held ? evaluateHeldGift(rec, held) : null; // Used by the mobile-visible farm log and direct diagnostics calls.
    const report = evaluation ? {
      npcId: rec?.id || null,
      itemKey: held?.key || held?.instance?.cosmeticId || null,
      tier: evaluation.tier,
      score: evaluation.score,
      foodScore: evaluation.foodScore,
      foodContext: evaluation.foodContext,
      matches: evaluation.matches,
    } : { npcId: rec?.id || null, itemKey: null, error: 'No gift held' };
    window.__farmLog?.(`[NpcGifting] ${JSON.stringify(report)}`, 'info', 'social');
    return report;
  }

  function itemDefFor(held) {
    if (held.kind === 'clothing') return null; // Clothing isn't in ITEM_DEFS — see js/equipment-panel.js.
    return held.def || deps.getItemDefs()[held.key] || null;
  }

  function itemLabelFor(held) {
    if (held.kind === 'clothing') return held.instance.label || held.instance.baseLabel || 'this';
    return itemDefFor(held)?.label || held.key;
  }

  function isItemGiftable(held) {
    if (!held) return false;
    if (held.kind === 'clothing') return true;
    const def = itemDefFor(held);
    return !!def && !def.noGift;
  }

  function traitsForHeld(held) {
    if (held.kind === 'clothing') return window.ItemTraits?.computeItemTraits(held.instance.cosmeticId, held.instance) || [];
    return window.ItemTraits?.computeItemTraits(held.key, null) || [];
  }

  function matchedTrait(list, traits) {
    return (list || []).find(t => traits.includes(t));
  }

  function matchedTraits(list, traits) {
    const heldTraits = new Set(traits || []);
    return [...new Set((list || []).filter(t => heldTraits.has(t)))];
  }

  // Every matching preference contributes independently. Liked/disliked are
  // deliberately symmetric (+4/-4 per trait), while the existing stronger
  // loved/hated authoring remains ±10 per trait. The final dialogue verdict
  // is based on the NET score, so mixed gifts can cancel or outweigh one
  // another instead of one disliked/hated trait automatically winning.
  function evaluateGiftReaction(npcGifts, traits, foodEvaluation = null) {
    const matches = { loved: [], liked: [], disliked: [], hated: [] };
    let score = 0;
    let matchedCount = 0;
    for (const tier of PREFERENCE_TIERS) {
      matches[tier] = matchedTraits(npcGifts?.[tier], traits);
      matchedCount += matches[tier].length;
      score += matches[tier].length * TIER_FAVOR[tier];
    }
    if (foodEvaluation?.matches?.length) {
      matches.liked = uniqueStrings([...matches.liked, ...foodEvaluation.matches]);
      matchedCount += foodEvaluation.matches.length;
      score += Number(foodEvaluation.score) || 0;
    }

    let tier = 'neutral';
    if (matchedCount) {
      if (score >= TIER_FAVOR.loved) tier = 'loved';
      else if (score > 0) tier = 'liked';
      else if (score <= TIER_FAVOR.hated) tier = 'hated';
      else if (score < 0) tier = 'disliked';
    }

    return {
      tier,
      score,
      matchedCount,
      matches,
      favorDelta: matchedCount ? score : TIER_FAVOR.neutral,
    };
  }

  function reactionTier(npcGifts, traits) {
    return evaluateGiftReaction(npcGifts, traits).tier;
  }

  // Apply the already-balanced result once so relationship clamping cannot
  // make a mixed gift order-dependent near a minimum/maximum. Gifts change
  // permanent Favor directly; temporary Rapport is reserved for short-lived
  // social affinity such as drinks, dancing, music, and authored dialogue.
  function applyGiftRelationshipDelta(npcId, evaluation) {
    const reason = 'gift_' + evaluation.tier;
    window.DialogueContent?.adjustNpcFavor?.(npcId, evaluation.favorDelta, reason);
  }

  // Only calls out a dislike/hate in the prompt when the player has
  // actually discovered that trait somewhere in their own belongings — see
  // js/item-traits.js's getDiscoveredTraitSet for what "discovered" means.
  function warningSuffix(npcGifts, traits) {
    const badTrait = matchedTrait(npcGifts?.hated, traits) || matchedTrait(npcGifts?.disliked, traits);
    if (!badTrait || !window.ItemTraits?.isTraitDiscovered(badTrait)) return '';
    const verb = (npcGifts?.hated || []).includes(badTrait) ? 'hates' : 'dislikes';
    const label = window.ItemTraits.getTraitLabel(badTrait);
    return ` <span style="color:#ff5a5f">(${verb} ${esc(label)})</span>`;
  }

  function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function getNpcGiftOfferAction(walker) {
    const npcId = walker?.rec?.id;
    if (!npcId) return null;
    const held = deps.getHeldGiftItem();
    if (!isItemGiftable(held)) return null;
    const traits = traitsForHeld(held);
    const npcGifts = walker.rec.gifts || {};
    const warning = warningSuffix(npcGifts, traits);
    const name = walker.rec.name || walker.rec.displayName || 'them';
    return {
      icon: held.kind === 'clothing' ? '👕' : (itemDefFor(held)?.icon || '🎁'),
      label: `Give ${esc(itemLabelFor(held))} to ${esc(name)}${warning}`,
      action: 'npc_offer_gift',
      style: 'secondary',
      allowed: true,
      contextualHeldItem: true,
    };
  }

  function offerGift(walker) {
    const npcId = walker?.rec?.id;
    const held = deps.getHeldGiftItem();
    if (!npcId || !isItemGiftable(held)) return false;

    const evaluation = evaluateHeldGift(walker.rec, held); // Uses the same combined trait + food preference evaluator exposed to diagnostics/tests.
    const tier = evaluation.tier;
    const name = walker.rec.name || walker.rec.displayName || 'They';
    const itemLabel = itemLabelFor(held);
    for (const preferenceTier of PREFERENCE_TIERS) {
      recordDiscoveredTraits(npcId, preferenceTier, evaluation.matches[preferenceTier]);
    }

    let kept = true;
    let keepNote = '';
    if (held.kind === 'clothing') {
      const verdict = window.NpcWardrobe?.offerClothing?.(npcId, held.instance);
      kept = verdict ? verdict.accepted !== false : true;
      keepNote = kept ? (verdict?.worn ? ' They put it on.' : ' It goes into their wardrobe.') : ` ${name} hands it right back — not ${window.NpcWardrobe ? 'their style' : 'able to store it'}.`;
    }

    if (kept) applyGiftRelationshipDelta(npcId, evaluation);

    if (held.kind === 'clothing') {
      if (kept) {
        // The held instance came from one of two places (see
        // game.js's getHeldGiftItem) — gear (collected/possibly worn) or
        // the pack (found/bought, not yet collected) — remove it from
        // whichever one actually has it.
        const gearInventory = deps.getGearInventory();
        let removedFromGear = false;
        if (gearInventory?.clothingItems?.some(c => c.uid === held.instance.uid)) {
          for (const slot of Object.keys(gearInventory.clothing || {})) {
            if (gearInventory.clothing[slot]?.uid === held.instance.uid) gearInventory.clothing[slot] = null;
          }
          gearInventory.clothingItems = gearInventory.clothingItems.filter(c => c.uid !== held.instance.uid);
          deps.saveGearInventory?.();
          deps.refreshPlayerAvatar?.();
          removedFromGear = true;
        }
        if (!removedFromGear) {
          const packClothing = deps.getPackClothing?.() || [];
          if (packClothing.some(c => c.uid === held.instance.uid)) {
            deps.setPackClothing?.(packClothing.filter(c => c.uid !== held.instance.uid));
            deps.buildPackClothingSection?.();
          }
        }
      }
      deps.clearManualHeldItem?.();
    } else {
      deps.inventory[held.key] = Math.max(0, (Number(deps.inventory[held.key]) || 0) - 1);
      deps.clampInventoryStack?.(held.key);
    }

    const reactionMsg = kept
      ? `${name} ${TIER_VERBS[tier]} the ${itemLabel}.${keepNote}`
      : `${name} ${TIER_VERBS[tier]} the ${itemLabel}, but hands it back.${keepNote}`;
    deps.showToast?.(reactionMsg, tier !== 'hated');
    debugGiftEvaluation(walker.rec, held); // Mirrors every completed reaction into the in-game/mobile debug log before the held stack changes.
    deps.refreshItemScroll?.();
    deps.buildInventoryGrid?.();
    deps.buildEquipmentSlots?.();
    deps.refreshActionBar?.();
    deps.saveMemberWorldData?.();
    return true;
  }

  window.NpcGifting = {
    init,
    isItemGiftable,
    reactionTier,
    evaluateGiftReaction,
    getNpcGiftOfferAction,
    offerGift,
    getDiscoveredGiftTraits,
    serializeDiscoveredPrefs,
    restoreDiscoveredPrefs,
    reconcileAllDiscoveredPrefs,
    foodPreferenceContextForItem,
    foodLikesForRecord,
    compiledGiftPreferencesForRecord,
    getPreferenceLabel,
    evaluateHeldGift,
    debugGiftEvaluation,
  };
})();
