// NPC Gifting — lets the player hand whatever they're holding (a bag item
// via the wheel, or clothing via the new inventory "Hold" button, see
// game.js's getHeldGiftItem) to a nearby NPC. Reactions are driven entirely
// by item TRAITS (js/item-traits.js) matched against each NPC's
// gifts.{loved,liked,disliked,hated} trait-id lists (config/npcs/
// hobunji-starter-npc-database.json) — never by specific item keys, per
// design: an NPC likes "Hot" colors or "Ore", not "the bronze pickaxe".
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

  function getDiscoveredGiftTraits(npcId) {
    const bucket = discoveredPrefs[npcId];
    if (!bucket) return { loved: [], liked: [], disliked: [], hated: [] };
    return { loved: [...bucket.loved], liked: [...bucket.liked], disliked: [...bucket.disliked], hated: [...bucket.hated] };
  }

  function serializeDiscoveredPrefs() {
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
  function evaluateGiftReaction(npcGifts, traits) {
    const matches = { loved: [], liked: [], disliked: [], hated: [] };
    let score = 0;
    let matchedCount = 0;
    for (const tier of PREFERENCE_TIERS) {
      matches[tier] = matchedTraits(npcGifts?.[tier], traits);
      matchedCount += matches[tier].length;
      score += matches[tier].length * TIER_FAVOR[tier];
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
  // make a mixed gift order-dependent near a minimum/maximum. The current
  // social system routes ordinary gifts through temporary Rapport, so use
  // that public API directly when present; older/non-Rapport runtimes keep
  // using permanent favor as their fallback.
  function applyGiftRelationshipDelta(npcId, evaluation) {
    const reason = 'gift_' + evaluation.tier;
    if (window.NpcRapport?.adjust) {
      window.NpcRapport.adjust(npcId, evaluation.favorDelta, reason);
      return;
    }
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

    const traits = traitsForHeld(held);
    const npcGifts = walker.rec.gifts || {};
    const evaluation = evaluateGiftReaction(npcGifts, traits);
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
      keepNote = kept ? ' It goes into their wardrobe.' : ` ${name} hands it right back — not ${window.NpcWardrobe ? 'their style' : 'able to store it'}.`;
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
  };
})();
