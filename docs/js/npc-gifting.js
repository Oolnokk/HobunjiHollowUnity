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
  let lastTrophyTrade = null; // Last successful tribal currency exchange, exposed to mobile diagnostics.
  const BARTER_DEFAULTS = Object.freeze({ // Configurable favor thresholds and future unique gifts live beside the social rules.
    mediumFavor: 4, largeFavor: 10, uniqueFavor: 10,
    animalChance: 0.35, uniqueChance: 0.20,
    uniqueRewards: [{ trinketId: 'engravedWhistle', minFavor: 10 }],
  });

  const TRIBE_CHIEFS = Object.freeze({ porakaneki: 'porakaneki_chief', omgurku: 'omgurku_chief' }); // Tribe members gift and barter on their chief's shared Favor.
  const TRIBE_LABELS = Object.freeze({ porakaneki: 'Porakaneki', omgurku: 'Omgurku' });
  const TROPHY_TIERS = Object.freeze([{ rank: 1, cost: 1, label: 'Small', quantity: 5 }, { rank: 2, cost: 2, label: 'Medium', quantity: 10 }, { rank: 3, cost: 3, label: 'Large', quantity: 15 }]); // Existing barter bundle ranks determine the exact three currency prices.
  const BARTER_CATEGORIES = Object.freeze([ // Existing return pools, not a new vendor stock list.
    Object.freeze({ id: 'herbs', label: 'Herbs' }),
    Object.freeze({ id: 'fish', label: 'Fish' }),
    Object.freeze({ id: 'meat', label: 'Meat' }),
    Object.freeze({ id: 'animals', label: 'Animals' }),
    Object.freeze({ id: 'unique', label: 'Unique gifts' }),
  ]);
  let trophyDialog = null; // One lazily built controller/touch dialog is reused for every great-camp trade.
  let trophyActionLock = null; // Existing CharacterActionLocks blocks movement, tools and attacks while the controller/touch menu is open.
  let trophyWalker = null; // Revalidated against live camp and reach when a tier is selected.
  let trophyHeldKey = null; // The currently held trophy must match the one that opened the dialog.
  let trophyFocus = null; // Restores focus on dialog dismissal.
  const TRIBAL_TROPHIES = Object.freeze({ // One persistent inventory currency per defeated tribe; never ordinary gifts or shop stock.
    omgurkuHorn: Object.freeze({ tribe: 'omgurku', label: 'Omgurku Horn', icon: '📯', cat: 'material', noGift: true, sellPrice: 0, tags: ['Currency', 'Tribal Trophy'], desc: 'Present it to the Porakaneki great camp for a return gift, or the Omgurku for Favor alone.' }),
    porakanekiQuill: Object.freeze({ tribe: 'porakaneki', label: 'Porakaneki Quill', icon: '🪶', cat: 'material', noGift: true, sellPrice: 0, tags: ['Currency', 'Tribal Trophy'], desc: 'Present it to the Omgurku great camp for a return gift, or the Porakaneki for Favor alone.' }),
  });
  function registerTribalTrophyItems(itemDefs = deps?.getItemDefs?.(), inventoryItems = deps?.inventoryItems) {
    if (!itemDefs) return false;
    for (const [key, spec] of Object.entries(TRIBAL_TROPHIES)) {
      itemDefs[key] = { ...spec, ...(itemDefs[key] || {}), noGift: true, sellPrice: 0 };
      if (Array.isArray(inventoryItems) && !inventoryItems.some(item => item?.key === key)) {
        inventoryItems.push({ key, icon: spec.icon, label: spec.label.toUpperCase(), max: 99 });
      }
    }
    return true;
  }
  function tribeOf(walker) {
    const rec = walker?.rec; // Named and procedural NPCs share this species/faction check.
    const species = String(rec?.species || '').toLowerCase();
    for (const [tribe, chiefId] of Object.entries(TRIBE_CHIEFS)) {
      if (rec?.id === chiefId || walker?.tribeId === tribe || species === tribe
        || rec?.appearance?.speciesId === tribe || rec?.tags?.includes(tribe)) return tribe;
    }
    return walker?.isPorakanekiHunter === true ? 'porakaneki' : null;
  }
  function isPorakaneki(walker) { return tribeOf(walker) === 'porakaneki'; }
  function withinPorakanekiGiftReach(walker) {
    if (!tribeOf(walker)) return true;
    const distance = window.FurnitureTableSystem?.npcDistance?.(walker); // The same two-tile reach applies to named chiefs and generated hunters, including stale button presses.
    return Number.isFinite(distance) && distance <= 2; // A missing/uninitialized distance authority must never allow a stale remote gift press.
  }
  function isTribalTrophyHeld(held = deps?.getHeldGiftItem?.()) {
    return (held?.kind === 'item' || held?.kind === 'bagItem') && !!TRIBAL_TROPHIES[held?.key]
      && (Number(deps?.inventory?.[held.key]) || 0) > 0; // Only a genuinely held bag item qualifies; stowed tools, weapons and burdens cannot trade.
  }
  function isTribalTrophyExchange(walker, held = deps?.getHeldGiftItem?.()) {
    const receivingTribe = tribeOf(walker); // A trophy's enemy is the only tribe that pays a return gift.
    if (!receivingTribe || !isTribalTrophyHeld(held) || !withinPorakanekiGiftReach(walker)) return false;
    const trophy = TRIBAL_TROPHIES[held.key]; // Own-tribe trophies buy Favor alone at any friendly camp.
    return trophy.tribe === receivingTribe
      || window.TribeCamps?.get?.(receivingTribe)?.isAtChiefCamp?.(walker) === true;
  }
  function relationshipId(walker) {
    const tribe = tribeOf(walker);
    return tribe ? TRIBE_CHIEFS[tribe] : walker?.rec?.id;
  }
  function preferenceRecord(walker) {
    const tribe = tribeOf(walker);
    return tribe ? deps?.getNpcRecordById?.(TRIBE_CHIEFS[tribe]) || walker.rec : walker.rec;
  }
  function barterTuning() {
    return { ...BARTER_DEFAULTS, ...(window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.porakanekiBarter || {}) };
  }
  function barterFavorForTier(rank) {
    const tuning = barterTuning(); // Preserve configured thresholds and the existing high-tier unique reward gate.
    return rank === 3 ? Math.max(Number(tuning.largeFavor) || 10, Number(tuning.uniqueFavor) || 10, Number(tuning.mediumFavor) || 4) : rank === 2 ? Number(tuning.mediumFavor) || 4 : 0;
  }
  function trophyTradingRank(receivingTribe) {
    const pointsRank = Number(window.NpcFavorBalance?.factionRank?.('faction:' + receivingTribe)); // Existing saved faction reputation is the only unlock authority.
    return Number.isFinite(pointsRank) ? Math.max(0, Math.floor(pointsRank)) : 0;
  }
  function trophyPurchaseCost(tier, category = null) {
    return tier.cost + (category == null ? 0 : tier.rank + 1); // Specific pool adds 2/3/4 tokens for small/medium/large.
  }
  function giftRapportAmount() {
    const maximum = Number(window.NpcRapport?.config?.rapportMax); // Positive gifts always earn one quarter of the daily cap, independent of quality and favor magnitude.
    return (Number.isFinite(maximum) ? Math.max(0, maximum) : 100) * 0.25;
  }
  function randomPick(list) {
    return list[Math.min(list.length - 1, Math.floor((deps?.random?.() ?? Math.random()) * list.length))];
  }
  function eligibleBarterRewardPools(favorGain, held, spent = 1) {
    const tuning = barterTuning(); // One eligibility calculation serves both ordinary random gifts and paid targeted pool selection.
    const pools = deps?.getPorakanekiRewardPools?.() || {};
    const rank = favorGain >= tuning.largeFavor ? 3 : favorGain >= tuning.mediumFavor ? 2 : 1;
    const quantity = rank * 5;
    const capacity = (key, qty) => !!deps.getItemDefs()[key]
      && (Number(deps.inventory[key]) || 0) - (held?.kind !== 'clothing' && held?.key === key ? spent : 0) + qty <= (deps.getInventoryMax?.(key) ?? 99); // Predict space only after all trophies are deducted.
    const unique = (Array.isArray(tuning.uniqueRewards) ? tuning.uniqueRewards : []).filter(entry =>
      favorGain >= Math.max(Number(tuning.uniqueFavor) || 10, Number(entry.minFavor) || 0)
      && (entry.trinketId ? !!window.TrinketSystem?.DEFINITIONS?.[entry.trinketId] : capacity(entry.itemKey, 1)));
    const animals = (pools.animals || []).filter(entry => capacity(entry.itemKey, 1));
    const bundles = ['herbs', 'fish', 'meat'].map(type => ({
      type, keys: [...new Set(pools[type] || [])].filter(key => capacity(key, quantity)),
    })).filter(pool => pool.keys.length);
    return { tuning, rank, quantity, unique, animals, bundles };
  }

  function availableBarterCategories(favorGain, held, spent = 1) {
    const options = eligibleBarterRewardPools(favorGain, held, spent); // Menu shows only real regional pools that can currently pay out.
    return BARTER_CATEGORIES.filter(category => {
      if (category.id === 'unique') return options.unique.length > 0;
      if (category.id === 'animals') return options.animals.length > 0 && typeof window.CreatureGenetics?.makeRareGiftGenotype === 'function';
      return options.bundles.some(bundle => bundle.type === category.id);
    });
  }

  function rollBarterReward(favorGain, held, spent = 1, category = null) {
    const { tuning, rank, quantity, unique, animals, bundles } = eligibleBarterRewardPools(favorGain, held, spent);
    if (category != null && !BARTER_CATEGORIES.some(entry => entry.id === category)) return null; // Never silently substitute a random pool for an invalid paid request.
    if (category === 'unique' || (category == null && unique.length && (deps?.random?.() ?? Math.random()) < tuning.uniqueChance)) {
      return unique.length ? { ...randomPick(unique), quantity: 1, type: 'unique', rank } : null;
    }
    if (category === 'animals' || (category == null && animals.length
      && (!bundles.length || (deps?.random?.() ?? Math.random()) < tuning.animalChance))) {
      if (!animals.length) return null;
      const animal = randomPick(animals);
      const genotype = window.CreatureGenetics?.makeRareGiftGenotype?.(animal.kind, rank); // Rank still controls inherited patterns when the animal pool is chosen.
      if (genotype) return { ...animal, genotype, quantity: 1, type: 'animal', rank };
      if (category === 'animals') return null; // Paid pool guarantees its category, or charges nothing.
    }
    const bundle = category != null ? bundles.find(entry => entry.type === category) : bundles.length ? randomPick(bundles) : null;
    if (!bundle) return null;
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
    registerTribalTrophyItems(); // Canonical bag definitions are shared by corpse loot, the wheel and save restore.
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
    const base = window.NpcFoodGiftPreferences?.compiledGiftPreferencesForRecord?.(rec) || rec.gifts || null; // Metal armor's authored override is merged only for discovery reconciliation/UI.
    return withMetalArmorPreference(npcId, base);
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
  const METAL_ARMOR_TRAIT = 'metalArmor'; // Used only by gift evaluation/discovery so other item-trait consumers keep their normal clothing traits.
  const METAL_ARMOR_VALUE_KEYS = Object.freeze(['nativeCopper', 'lowTinBronze', 'tinBronze', 'highTinBronze', 'arsenicalBronze', 'leadedBronze']); // Used to multiply metal-armor Favor by the canonical smith alloy tier.
  const METAL_ARMOR_LOVED_NPCS = new Set([ // Used by metalArmorPreferenceTier to make these characters love any canonical metal armor piece.
    'oddclaw_unumanuk',
    'spearhead_unumanuk',
    'jubmir',
    'gantami_ginju',
    'porakaneki_chief',
  ]);
  const METAL_ARMOR_LIKED_NPCS = new Set([ // Used by metalArmorPreferenceTier to make these characters like any canonical metal armor piece.
    'leaf',
    'pahu',
    'garanki_gabu',
  ]);

  function metalArmorPreferenceTier(npcId) {
    if (METAL_ARMOR_LOVED_NPCS.has(npcId)) return 'loved';
    if (METAL_ARMOR_LIKED_NPCS.has(npcId)) return 'liked';
    return 'neutral';
  }

  function isHeldMetalArmor(held) {
    return held?.kind === 'clothing' && window.MetalArmorSystem?.isMetalArmor?.(held.instance) === true;
  }

  function metalArmorValueTier(held) {
    const metalKey = String(held?.instance?.metalKey || 'nativeCopper'); // Base alloy, not cosmetic plating, controls the gift's material-value multiplier.
    const index = METAL_ARMOR_VALUE_KEYS.indexOf(metalKey); // Canonical smith ordering maps Native Copper→1 through Leaded Bronze→6.
    return index >= 0 ? index + 1 : 1;
  }

  function withMetalArmorPreference(npcId, preferences) {
    if (!preferences) return preferences;
    const tier = metalArmorPreferenceTier(npcId);
    if (tier === 'neutral') return preferences;
    const merged = { // Used only for learned-preference reconciliation and warning/UI lookups; authored NPC data remains untouched.
      loved: [...(preferences.loved || [])],
      liked: [...(preferences.liked || [])],
      disliked: [...(preferences.disliked || [])],
      hated: [...(preferences.hated || [])],
    };
    merged[tier] = [...new Set([...merged[tier], METAL_ARMOR_TRAIT])];
    return merged;
  }

  function metalArmorGiftEvaluation(rec, held) {
    if (!isHeldMetalArmor(held)) return null;
    const tier = metalArmorPreferenceTier(rec?.id);
    const metalTier = metalArmorValueTier(held); // Higher-tier alloys multiply the relationship value of the otherwise identical armor preference.
    const matches = { loved: [], liked: [], disliked: [], hated: [] }; // Metal armor intentionally ignores every unrelated color/clothing trait for this reaction.
    if (tier !== 'neutral') matches[tier].push(METAL_ARMOR_TRAIT);
    const baseFavor = tier === 'neutral' ? TIER_FAVOR.neutral : TIER_FAVOR[tier];
    const favorDelta = baseFavor * metalTier;
    const score = tier === 'neutral' ? 0 : favorDelta;
    return {
      tier,
      score,
      matchedCount: tier === 'neutral' ? 0 : 1,
      matches,
      favorDelta,
      metalTier,
      traits: [METAL_ARMOR_TRAIT],
      foodContext: null,
      foodScore: 0,
    };
  }

  function itemDefFor(held) {
    if (held.kind === 'clothing') return null; // Clothing isn't in ITEM_DEFS — see js/equipment-panel.js.
    return held.def || deps.getItemDefs()[held.key] || TRIBAL_TROPHIES[held.key] || null;
  }

  function itemLabelFor(held) {
    if (held.kind === 'clothing') return held.instance.label || held.instance.baseLabel || 'this';
    return itemDefFor(held)?.label || held.key;
  }

  function isItemGiftable(held) {
    if (!held || !deps) return false;
    if (held.kind === 'clothing') {
      const uid = held.instance?.uid; // Ownership is checked live so stale holds cannot remove permanent gear.
      if (!uid) return false;
      const gear = deps.getGearInventory?.(); // Includes equipped records from older saves, even if the collection is missing.
      if (gear?.clothingItems?.some(item => item?.uid === uid) || Object.values(gear?.clothing || {}).some(item => item?.uid === uid)) return false;
      return !!deps.getPackClothing?.()?.some(item => item?.uid === uid && !item.cursed); // A cursed garment (looted lich circlet, Maskbound mask) is never handed to an NPC to wear or stash; the curse has to be lifted first.
    }
    const def = itemDefFor(held);
    if (!['item', 'bagItem'].includes(held.kind) || !def || def.noGift) return false;
    if (def.isTool || def.isWeapon || def.isBurden || def.isInstrument || ['tool', 'weapon', 'burden', 'instrument'].includes(String(def.cat || '').toLowerCase())) return false; // Reuse main's held-gift policy: a visible tool/burden is not an ordinary gift.
    return (Number(deps.inventory?.[held.key]) || 0) > 0;
  }

  function traitsForHeld(held) {
    if (held.kind === 'clothing') return window.ItemTraits?.computeItemTraits(held.instance.cosmeticId, held.instance) || [];
    return window.ItemTraits?.computeItemTraits(held.key, null) || [];
  }

  function getPreferenceLabel(id) {
    if (id === METAL_ARMOR_TRAIT) return 'Metal Armor';
    return window.NpcFoodGiftPreferences?.getPreferenceLabel?.(id) || window.ItemTraits?.getTraitLabel?.(id) || id;
  }

  function evaluateHeldGift(rec, held) {
    const metalArmorEvaluation = metalArmorGiftEvaluation(rec, held); // Category-specific rule takes precedence so every unlisted NPC is truly indifferent to metal armor.
    if (metalArmorEvaluation) return metalArmorEvaluation;
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
      giftable: isItemGiftable(held),
      latestChange: 'NPC gifts require the actual item in hand; tools, weapons, burdens, performances, vessels and stowed modes are excluded.',
      tier: evaluation.tier,
      score: evaluation.score,
      metalTier: evaluation.metalTier || null,
      foodScore: evaluation.foodScore,
      foodContext: evaluation.foodContext,
      traits: evaluation.traits,
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
    if (evaluation.favorDelta > 0) window.NpcRapport?.adjust?.(npcId, giftRapportAmount() * (window.FestivalSystem?.giftMultiplier?.() || 1), reason);
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
    if (!npcId || window.NpcInteractionPolicy?.isPassiveGreatFey?.(walker.rec) || !withinPorakanekiGiftReach(walker)) return null; // Great Fey never advertise the ordinary gift action; Porakaneki require two-tile proximity.
    const held = deps.getHeldGiftItem();
    if (npcId === 'boney_shinjimi') {
      if (!isItemGiftable(held) || !window.BoneyShinjimiWilderness?.canAcceptMilkGift?.(held, deps)) return null;
      return { icon: itemDefFor(held)?.icon || '🥛',
        label: `Give ${esc(itemLabelFor(held))} to Boney Shinjimi`,
        action: 'npc_offer_gift', style: 'secondary', allowed: true, contextualHeldItem: true };
    } // His secret in-house exchange bypasses ordinary preferences, Favor and daily gifts.
    if (isTribalTrophyExchange(walker, held)) {
      const receivingTribe = tribeOf(walker);
      const trophy = TRIBAL_TROPHIES[held.key];
      const paysReward = trophy.tribe !== receivingTribe;
      return { icon: trophy.icon,
        label: paysReward
          ? `Trade ${esc(trophy.label)} ×1–3 for a ${TRIBE_LABELS[receivingTribe]} gift (choose tier)`
          : `Turn in ${esc(trophy.label)} for ${TRIBE_LABELS[receivingTribe]} Favor (−rival Favor)`,
        action: 'npc_offer_gift', style: 'secondary', allowed: true, contextualHeldItem: true };
    }
    if (TRIBAL_TROPHIES[held?.key] || !isItemGiftable(held)) return null; // Trophies cannot bypass the camp restriction as normal gifts.
    const prefRec = preferenceRecord(walker); // Reused by both armor-specific and ordinary warning calculations.
    const metalArmor = isHeldMetalArmor(held); // Prevents unrelated clothing/color dislikes from leaking into the metal-armor prompt.
    const traits = metalArmor ? [METAL_ARMOR_TRAIT] : traitsForHeld(held);
    const npcGifts = metalArmor ? withMetalArmorPreference(prefRec?.id, {}) : prefRec?.gifts || {};
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

  function exchangeTribalTrophy(walker, rank = 1, expectedKey = null, category = null) {
    const tier = TROPHY_TIERS.find(t => t.rank === rank); // Reject unsupported tiers even from stale/controller inputs.
    const held = deps?.getHeldGiftItem?.(); // Never trust a held item captured when the choice dialog opened.
    if (!tier || (expectedKey && held?.key !== expectedKey) || !isTribalTrophyExchange(walker, held)
      || typeof window.DialogueContent?.adjustNpcFavor !== 'function') return false;
    const receivingTribe = tribeOf(walker);
    const trophy = TRIBAL_TROPHIES[held.key];
    const paysReward = trophy.tribe !== receivingTribe;
    const rankAtPurchase = trophyTradingRank(receivingTribe); // Capture the unlock rank before awarding Favor: this transaction can cross a threshold.
    if (!paysReward && (rank !== 1 || category != null)) return false; // Own-tribe trophies earn Favor only.
    if (category != null && (!BARTER_CATEGORIES.some(entry => entry.id === category)
      || rankAtPurchase < rank)) return false; // Server-side reward authority: reputation must still unlock the selected tier's category.
    const cost = paysReward ? trophyPurchaseCost(tier, category) : 1;
    if ((Number(deps.inventory[held.key]) || 0) < cost) {
      deps.showToast?.(`Need ${cost}× ${trophy.label} for the ${tier.label.toLowerCase()} return gift.`, false);
      return false;
    }
    const favorId = TRIBE_CHIEFS[receivingTribe];
    const rivalId = TRIBE_CHIEFS[Object.keys(TRIBE_CHIEFS).find(id => id !== receivingTribe)];
    const favorEquivalent = barterFavorForTier(rank); // The same existing regional/animal/unique reward rolls as ordinary gifts.
    const reward = paysReward ? rollBarterReward(favorEquivalent, held, cost, category) : null;
    if (paysReward && !reward) {
      deps.showToast?.(category ? 'The selected gift category has no available return. Check inventory space or choose another pool.' : 'Make room for the return gift before spending trophies.', false);
      return false;
    }
    deps.inventory[held.key] = (Number(deps.inventory[held.key]) || 0) - cost;
    deps.clampInventoryStack?.(held.key);
    window.DialogueContent.adjustNpcFavor(favorId, cost, 'tribal_trophy_turn_in', false, true);
    window.DialogueContent.adjustNpcFavor(rivalId, -cost, 'tribal_trophy_rival_penalty', false, true);
    if (reward) grantBarterReward(reward, favorEquivalent);
    else deps.showToast?.(`${TRIBE_LABELS[receivingTribe]} accepts the ${trophy.label}: +1 Favor, −1 rival Favor.`, true);
    lastTrophyTrade = { trophyKey: held.key, receivingTribe, rank: paysReward ? rank : 0,
      category, recipientRank: rankAtPurchase, spent: cost,
      favorDelta: cost, rivalFavorDelta: -cost, reward: reward && { ...reward } }; // Mobile diagnostics include selected pool and total trophy price.
    window.__farmLog?.(`[tribal trophy] ${JSON.stringify(lastTrophyTrade)}`, 'info', 'social'); // In-game mobile diagnostics show the selected tier and cost.
    deps.refreshItemScroll?.();
    deps.buildInventoryGrid?.();
    deps.refreshActionBar?.();
    deps.saveMemberWorldData?.();
    return true;
  }

  function closeTrophyTradeMenu() {
    if (!trophyDialog) return;
    trophyDialog.style.display = 'none';
    trophyActionLock?.release?.(); trophyActionLock = null; // Same modal lifecycle as FestivalUI; never strand gameplay input.
    trophyWalker = null;
    trophyHeldKey = null;
    trophyFocus?.focus?.();
    trophyFocus = null;
  }

  function openTrophyTradeMenu(walker, held) {
    if (!isTribalTrophyExchange(walker, held) || TRIBAL_TROPHIES[held.key].tribe === tribeOf(walker)
      || typeof document === 'undefined' || !document.body) return false;
    if (!trophyDialog) { // Build once; normal action-bar polling never creates or updates DOM.
      const root = document.createElement('section');
      root.id = 'tribalTrophyTradeDialog';
      for (const [key, value] of Object.entries({ role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tribal trophy trade tiers', 'data-ctrl-panel': '', 'data-ctrl-modal': '' })) root.setAttribute(key, value);
      root.style.cssText = 'display:none;position:fixed;inset:0;z-index:1200;background:#071318cc;align-items:center;justify-content:center;padding:14px;box-sizing:border-box';
      root.innerHTML = '<div data-ctrl-scroll style="width:min(480px,100%);max-height:88dvh;overflow:auto;padding:18px;box-sizing:border-box;border:2px solid #bcae83;border-radius:12px;background:#192a25;color:#f5edda;box-shadow:0 15px 55px #0009"><h2 style="margin:0 0 8px">Tribal return gifts</h2><p data-trophy-summary></p><div data-trophy-tiers style="display:grid;gap:8px"></div><p style="font-size:13px;line-height:1.4;color:#ced5cb">Each trophy spent earns +1 Favor with this tribe and −1 with its rival. All reward pools match ordinary gifts.</p><button type="button" data-trophy-close data-ctrl-cancel style="min-height:44px;width:100%;padding:10px;border:1px solid #aab6a6;border-radius:7px;background:#30483d;color:white;font:inherit">Cancel</button></div>';
      root.addEventListener('pointerdown', event => event.stopPropagation());
      root.addEventListener('pointerup', event => event.stopPropagation());
      root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); closeTrophyTradeMenu(); } });
      root.addEventListener('click', event => {
        event.stopPropagation(); // A modal click must not also trigger the gameplay scene's pointer handlers.
        const button = event.target.closest?.('button');
        if (!button || button.disabled) { if (event.target === root) closeTrophyTradeMenu(); return; }
        if (button.hasAttribute('data-trophy-close')) { closeTrophyTradeMenu(); return; }
        const rank = Number(button.getAttribute('data-trophy-tier'));
        const category = button.getAttribute('data-trophy-category') || null; // Missing attribute means the unchanged random-pool purchase.
        if (Number.isInteger(rank) && exchangeTribalTrophy(trophyWalker, rank, trophyHeldKey, category)) closeTrophyTradeMenu();
      });
      document.body.append(root);
      trophyDialog = root;
    }
    const trophy = TRIBAL_TROPHIES[held.key];
    const count = Math.max(0, Number(deps.inventory[held.key]) || 0);
    const tradingRank = trophyTradingRank(tribeOf(walker)); // Rep rank I/II/III unlocks paid targeting of the corresponding return tier.
    trophyDialog.querySelector('[data-trophy-summary]').textContent = `${TRIBE_LABELS[tribeOf(walker)]} great camp · Rank ${tradingRank} · ${count}× ${trophy.label} available. Choose a reward tier or unlockable category:`;
    trophyDialog.querySelector('[data-trophy-tiers]').innerHTML = TROPHY_TIERS.map(tier => {
      const randomAvailable = count >= tier.cost; // Normal random-gift purchases never have a reputation requirement.
      const random = `<button type="button" data-trophy-tier="${tier.rank}" ${tier.rank === 1 ? 'data-ctrl-default' : ''} ${randomAvailable ? '' : 'disabled'} style="min-height:52px;padding:9px 12px;border:1px solid #bcae83;border-radius:8px;background:#30483d;color:white;font:inherit;text-align:left;opacity:${randomAvailable ? '1' : '.45'}"><strong>${tier.label} · random pool · ${tier.cost}× ${esc(trophy.label)}</strong><span style="display:block;font-size:13px;margin-top:3px">${tier.quantity} resource items or a chance at an animal${tier.rank === 3 ? ' / unique gift' : ''}</span></button>`;
      const bonusCost = trophyPurchaseCost(tier, 'herbs'); // Every pool in a reward tier has the same 2/3/4 trophy targeting surcharge.
      const categories = tradingRank >= tier.rank
        ? availableBarterCategories(barterFavorForTier(tier.rank), held, bonusCost) : [];
      const targeted = tradingRank < tier.rank
        ? `<p style="margin:5px 0 0;font-size:12px;color:#b8c8b9">Targeted ${tier.label.toLowerCase()} pool unlocks at tribal rank ${tier.rank}.</p>`
        : categories.length ? `<div data-ctrl-group style="display:flex;flex-wrap:wrap;gap:6px;padding-top:8px"><div style="width:100%;font-size:13px">Choose a category · ${bonusCost} trophies total (+${tier.rank + 1}):</div>${categories.map(category => `<button type="button" data-trophy-tier="${tier.rank}" data-trophy-category="${category.id}" ${count >= bonusCost ? '' : 'disabled'} style="min-height:44px;padding:8px 10px;border:1px solid #91a892;border-radius:7px;background:#24443a;color:white;font:inherit;opacity:${count >= bonusCost ? '1' : '.45'}">${esc(category.label)}</button>`).join('')}</div>`
          : '<p style="margin:5px 0;font-size:12px;color:#eac9a7">No available categories at this tier; check reward inventory capacity.</p>';
      return `<section style="padding:10px;border:1px solid #657765;border-radius:10px"><div style="font-weight:600;margin-bottom:7px">${tier.label} tier</div>${random}${targeted}</section>`;
    }).join('');
    trophyWalker = walker;
    trophyHeldKey = held.key;
    trophyFocus = document.activeElement;
    trophyDialog.style.display = 'flex';
    document.exitPointerLock?.(); // Follow the established full-screen festival menu input handoff.
    trophyActionLock?.release?.();
    trophyActionLock = window.CharacterActionLocks?.acquire?.({ owner: 'tribal-trophy-menu', reason: 'Selecting a tribal return gift', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] });
    trophyDialog.querySelector('button:not([disabled])')?.focus?.();
    window.__farmLog?.(`[tribal trophy] tier menu opened: ${count}× ${trophy.label}`, 'info', 'social');
    return true;
  }

  function offerGift(walker) {
    const npcId = relationshipId(walker);
    const held = deps?.getHeldGiftItem?.();
    if (TRIBAL_TROPHIES[held?.key]) return TRIBAL_TROPHIES[held.key].tribe === tribeOf(walker)
      ? exchangeTribalTrophy(walker, 1, held.key) : openTrophyTradeMenu(walker, held); // Choose enemy return tier; own-tribe turn-in has no reward.
    if (walker?.rec?.id === 'boney_shinjimi') {
      return isItemGiftable(held) && window.BoneyShinjimiWilderness?.offerMilk?.(held, deps) === true;
    } // Boney only consumes milk when his post-confrontation cutscene grants a Fey weapon.
    if (!npcId || window.NpcInteractionPolicy?.isPassiveGreatFey?.(walker?.rec) || !isItemGiftable(held) || !withinPorakanekiGiftReach(walker)) return false; // Guard direct presses too: distant tribe gifts cannot consume items or alter Favor.

    const evaluation = evaluateHeldGift(preferenceRecord(walker), held); // Uses the same combined trait + food preference evaluator exposed to diagnostics/tests.
    const tier = evaluation.tier;
    const name = walker.rec.name || walker.rec.displayName || 'They';
    const itemLabel = itemLabelFor(held);
    for (const preferenceTier of PREFERENCE_TIERS) {
      recordDiscoveredTraits(npcId, preferenceTier, evaluation.matches[preferenceTier]);
    }

    const favorGain = Math.round(evaluation.favorDelta * (window.NpcFavorBalance?.activeGiftQualityMultiplier?.() ?? 1) * (window.FestivalSystem?.giftMultiplier?.() || 1) * (evaluation.favorDelta > 0 ? (window.AlchemySystem?.getPositiveFavorMultiplier?.() || 1) * (window.FestivalSystem?.blessingMultiplier?.('goodwill') || 1) * (window.NpcFavorBalance?.gainMultiplierForNpc?.(npcId) || 1) : 1) * 10000) / 10000; // Mirrors DialogueContent's actual favor gain, including existing positive-favor buffs.
    const tribe = tribeOf(walker); // Both tribes barter a return gift for presents.
    const barterReward = tribe ? rollBarterReward(favorGain, held) : null; // Preflight the promised return before consuming anything.
    if (tribe && !barterReward) { deps.showToast?.(`Make room for a ${TRIBE_LABELS[tribe]} return gift.`, false); return false; }

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
        // Gift eligibility guarantees this article is still in the pack.
        deps.setPackClothing?.(deps.getPackClothing().filter(item => item.uid !== held.instance.uid));
        deps.buildPackClothingSection?.();
      }
      deps.clearManualHeldItem?.();
    } else {
      deps.inventory[held.key] = Math.max(0, (Number(deps.inventory?.[held.key]) || 0) - 1);
      deps.clampInventoryStack?.(held.key);
    }

    if (kept && held.kind !== 'clothing') {
      window.RomanceSystem?.acceptSpousePerfumeGift?.(walker.rec.id, held.key); // Only a successful, consumed gift to the actual spouse changes their worn perfume.
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
    tribeOf,
    relationshipId,
    registerTribalTrophyItems,
    isTribalTrophyHeld,
    isTribalTrophyExchange,
    lastTrophyTrade: () => lastTrophyTrade && { ...lastTrophyTrade },
    exchangeTribalTrophy, // Explicit-tier transaction also serves focused tests without a browser.
    closeTrophyTradeMenu,
    availableBarterCategories, // Direct test/debug lookup returns currently available source pools, never synthetic vendor products.
    trophyTradingRank,
    trophyPurchaseCost,
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
    isHeldMetalArmor,
    metalArmorPreferenceTier,
    metalArmorValueTier,
  };
})();