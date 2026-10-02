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
  let lastBarterReward = null; // Shown in the existing mobile gift diagnostic log.
  const BARTER_DEFAULTS = Object.freeze({ // Configurable favor thresholds and future unique gifts live beside the social rules.
    mediumFavor: 4, largeFavor: 10, uniqueFavor: 10,
    animalChance: 0.35, uniqueChance: 0.20,
    uniqueRewards: [{ trinketId: 'engravedWhistle', minFavor: 10 }],
  });

  function isPorakaneki(walker) {
    const rec = walker?.rec; // Named and procedural NPCs share this species/faction check.
    return rec?.id === 'porakaneki_chief' || walker?.isPorakanekiHunter === true
      || rec?.species === 'porakaneki' || rec?.appearance?.speciesId === 'porakaneki'
      || rec?.tags?.includes('porakaneki');
  }
  function relationshipId(walker) {
    return isPorakaneki(walker) ? 'porakaneki_chief' : walker?.rec?.id;
  }
  function preferenceRecord(walker) {
    return isPorakaneki(walker) ? deps?.getNpcRecordById?.('porakaneki_chief') || walker.rec : walker.rec;
  }
  function barterTuning() {
    return { ...BARTER_DEFAULTS, ...(window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.porakanekiBarter || {}) };
  }
  function giftRapportAmount() {
    const maximum = Number(window.NpcRapport?.config?.rapportMax); // Positive gifts always earn one quarter of the daily cap, independent of quality and favor magnitude.
    return (Number.isFinite(maximum) ? Math.max(0, maximum) : 100) * 0.25;
  }
  function randomPick(list) {
    return list[Math.min(list.length - 1, Math.floor((deps?.random?.() ?? Math.random()) * list.length))];
  }
  function rollBarterReward(favorGain, held) {
    const tuning = barterTuning(); // All reward probabilities/tiers are evaluated once per accepted daily gift.
    const pools = deps?.getPorakanekiRewardPools?.() || {}; // Uses the current region's existing reagent, fishing, wildlife, and loot definitions.
    const rank = favorGain >= tuning.largeFavor ? 3 : favorGain >= tuning.mediumFavor ? 2 : 1; // Controls bundle size and guaranteed rare animal traits.
    const quantity = rank * 5; // Small/medium/large bundles contain exactly 5/10/15 items.
    const capacity = (key, qty) => !!deps.getItemDefs()[key] && (Number(deps.inventory[key]) || 0) - (held?.kind !== 'clothing' && held?.key === key ? 1 : 0) + qty <= (deps.getInventoryMax?.(key) ?? 99); // Projects space after consuming the gift so returned bundles are never truncated.
    const unique = (Array.isArray(tuning.uniqueRewards) ? tuning.uniqueRewards : []).filter(entry =>
      favorGain >= Math.max(Number(tuning.uniqueFavor) || 10, Number(entry.minFavor) || 0)
      && (entry.trinketId ? !!window.TrinketSystem?.DEFINITIONS?.[entry.trinketId] : capacity(entry.itemKey, 1))); // New authored unique item/trinket entries automatically join the highest tier.
    if (unique.length && (deps?.random?.() ?? Math.random()) < tuning.uniqueChance) {
      return { ...randomPick(unique), quantity: 1, type: 'unique', rank };
    }
    const animals = (pools.animals || []).filter(entry => capacity(entry.itemKey, 1)); // Only regional egg/baby keys with room can be returned.
    const bundles = ['herbs', 'fish', 'meat'].map(type => ({ type, keys: [...new Set(pools[type] || [])].filter(key => capacity(key, quantity)) })).filter(pool => pool.keys.length); // Pick a category first so large herb catalogs do not drown out fish/meat rewards.
    if (animals.length && (!bundles.length || (deps?.random?.() ?? Math.random()) < tuning.animalChance)) {
      const animal = randomPick(animals); // Regional species are resolved to the existing livestock genotype kind.
      const genotype = window.CreatureGenetics?.makeRareGiftGenotype?.(animal.kind, rank); // Genetics owns palette constraints, expressed patterns, and rare coat traits.
      if (genotype) return { ...animal, genotype, quantity: 1, type: 'animal', rank };
    }
    if (!bundles.length) return null;
    const bundle = randomPick(bundles); // Every resource bundle contains one region-native item type.
    return { itemKey: randomPick(bundle.keys), quantity, type: bundle.type, rank };
  }
  function grantBarterReward(reward, favorGain) {
    if (reward.trinketId) window.TrinketSystem.grant(reward.trinketId, 'porakaneki_daily_gift');
    else {
      deps.inventory[reward.itemKey] = (Number(deps.inventory[reward.itemKey]) || 0) + reward.quantity;
      if (reward.genotype) window.FarmAnimals?.queueItemGenotype?.(reward.itemKey, reward.genotype);
    }
    lastBarterReward = { ...reward, favorGain }; // Included in gift diagnostics and logged without requiring a console.
    const label = reward.trinketId ? window.TrinketSystem.DEFINITIONS[reward.trinketId].displayName : deps.getItemDefs()[reward.itemKey]?.label || reward.itemKey; // Used by the visible return-gift toast.
    deps.showToast?.(`In return: ${reward.quantity}× ${label}${reward.type === 'animal' ? ' with rare inherited traits' : ''}.`, true);
    window.__farmLog?.(`[Porakaneki gift return] favor=${favorGain} tier=${reward.rank} reward=${reward.quantity}x ${label} genes=${JSON.stringify(reward.genotype || null)}`, 'info', 'social');
  }
  function init(injectedDeps) {
    deps = injectedDeps;
    window.NpcFoodGiftPreferences?.init?.({ getItemDefs: injectedDeps?.getItemDefs }); // Shares only item-definition lookup with the extracted food preference runtime.
  }

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
    if (!rec) return null;
    return window.NpcFoodGiftPreferences?.compiledGiftPreferencesForRecord?.(rec) || rec.gifts || null;
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


  function itemDefFor(held) {
    if (held.kind === 'clothing') return null; // Clothing isn't in ITEM_DEFS — see js/equipment-panel.js.
    return held.def || deps.getItemDefs()[held.key] || null;
  }

  function itemLabelFor(held) {
    if (held.kind === 'clothing') return held.instance.label || held.instance.baseLabel || 'this';
    return itemDefFor(held)?.label || held.key;
  }

  function isItemGiftable(held) {
    if (!held || !deps) return false;
    if (held.kind === 'clothing') return true;
    const def = itemDefFor(held);
    return !!def && !def.noGift && (Number(deps.inventory?.[held.key]) || 0) > 0;
  }

  function traitsForHeld(held) {
    if (held.kind === 'clothing') return window.ItemTraits?.computeItemTraits(held.instance.cosmeticId, held.instance) || [];
    return window.ItemTraits?.computeItemTraits(held.key, null) || [];
  }


  function getPreferenceLabel(id) {
    return window.NpcFoodGiftPreferences?.getPreferenceLabel?.(id) || window.ItemTraits?.getTraitLabel?.(id) || id;
  }

  function evaluateHeldGift(rec, held) {
    const traits = traitsForHeld(held); // Used to preserve the original item-trait reaction alongside food-specific scoring.
    if (held?.kind === 'clothing') return { ...evaluateGiftReaction(rec?.gifts || {}, traits), traits, foodContext: null, foodScore: 0 };
    const foodContext = window.NpcFoodGiftPreferences?.foodPreferenceContextForItem?.(held?.key, itemDefFor(held)) || null; // Extracted runtime owns ingredient lineage/artisan classification.
    const foodEvaluation = window.NpcFoodGiftPreferences?.evaluateFoodLikes?.(rec, foodContext) || null; // Extracted runtime returns only the additive food contribution.
    return { ...evaluateGiftReaction(rec?.gifts || {}, traits, foodEvaluation), traits, foodContext, foodScore: Number(foodEvaluation?.score) || 0 };
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
      favorDelta: evaluation.favorDelta,
      positiveGiftRapport: evaluation.favorDelta > 0 ? giftRapportAmount() : 0,
      lastBarterReward,
    } : { npcId: rec?.id || null, itemKey: null, error: 'No gift held' };
    window.__farmLog?.(`[NpcGifting] ${JSON.stringify(report)}`, 'info', 'social');
    return report;
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
      matches.liked = [...new Set([...matches.liked, ...foodEvaluation.matches])];
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
  // permanent Favor directly and positive gifts add a quality-independent
  // quarter of the daily Rapport cap.
  function applyGiftRelationshipDelta(npcId, evaluation) {
    const reason = 'gift_' + evaluation.tier;
    window.DialogueContent?.adjustNpcFavor?.(npcId, evaluation.favorDelta, reason);
    if (evaluation.favorDelta > 0) window.NpcRapport?.adjust?.(npcId, giftRapportAmount(), reason);
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
    const npcGifts = preferenceRecord(walker)?.gifts || {};
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
    const npcId = relationshipId(walker);
    const held = deps?.getHeldGiftItem?.();
    if (!npcId || !isItemGiftable(held)) return false;

    const evaluation = evaluateHeldGift(preferenceRecord(walker), held); // Uses the same combined trait + food preference evaluator exposed to diagnostics/tests.
    const tier = evaluation.tier;
    const name = walker.rec.name || walker.rec.displayName || 'They';
    const itemLabel = itemLabelFor(held);
    for (const preferenceTier of PREFERENCE_TIERS) {
      recordDiscoveredTraits(npcId, preferenceTier, evaluation.matches[preferenceTier]);
    }

    const favorGain = Math.round(evaluation.favorDelta * (evaluation.favorDelta > 0 ? window.AlchemySystem?.getPositiveFavorMultiplier?.() || 1 : 1) * 10) / 10; // Mirrors DialogueContent's actual favor gain, including existing positive-favor buffs.
    const barterReward = isPorakaneki(walker) ? rollBarterReward(favorGain, held) : null; // Preflight the promised return before consuming anything.
    if (isPorakaneki(walker) && !barterReward) { deps.showToast?.('Make room for a Porakaneki return gift.', false); return false; }

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
      deps.inventory[held.key] = Math.max(0, (Number(deps.inventory?.[held.key]) || 0) - 1);
      deps.clampInventoryStack?.(held.key);
    }

    window.NpcRapport?.markGiftedToday?.(npcId); // Persist the daily flag in the same save as consumption and the return item.

    const reactionMsg = kept
      ? `${name} ${TIER_VERBS[tier]} the ${itemLabel}.${keepNote}`
      : `${name} ${TIER_VERBS[tier]} the ${itemLabel}, but hands it back.${keepNote}`;
    deps.showToast?.(reactionMsg, tier !== 'hated');
    if (kept && barterReward) grantBarterReward(barterReward, favorGain);
    debugGiftEvaluation(preferenceRecord(walker), held); // Mirrors every completed reaction into the in-game/mobile debug log before the held stack changes.
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
    isPorakaneki,
    relationshipId,
    rollBarterReward,
    reactionTier,
    evaluateGiftReaction,
    getNpcGiftOfferAction,
    offerGift,
    getDiscoveredGiftTraits,
    serializeDiscoveredPrefs,
    restoreDiscoveredPrefs,
    reconcileAllDiscoveredPrefs,
    getPreferenceLabel,
    evaluateHeldGift,
    debugGiftEvaluation,
  };
})();
