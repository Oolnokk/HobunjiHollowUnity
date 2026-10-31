// Bandit rank is worn, not labelled: lieutenants always wear a pauldron (never a circlet); captains always wear a pauldron, a circlet and a patterned
// piece of overwear. Every bandit's pants are patterned. Patterns are random-framed Harlyao glyphs for now, in a dye rolled from the same pool as the
// bandit's ordinary clothing. Metal armor is the bandit's weapon metal at the temper (verdigris) its weapon's mastery would have.
(() => {
  'use strict';

  const PATTERN_SCALE = Object.freeze({ pants: 4, overwear: 1.05 }); // Same per-piece sizes as the liches and ghouls (the pants sprite is much larger).
  const PANTS_PATTERN_RANKS = Object.freeze(['grunt', 'flasker', 'lieutenant', 'captain']); // Which ranks get patterned pants.
  const RANK_METAL_PIECES = Object.freeze({ lieutenant: ['rounded_pauldron'], captain: ['rounded_pauldron', 'tangedcirclet'] });

  const catalog = () => window.ScratchbonesAccount?.getDyeCatalog?.() || window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [];
  const dyeHex = id => { const hex = catalog().find(dye => dye.id === id)?.hex; return /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : null; };

  // Temper (what drives armor verdigris) for a bandit's mastery level 0-5: the same fraction of the maximum its weapon's mastery would give.
  function temperXpForMastery(mastery) {
    const thresholds = window.MetalArmorSystem?.TEMPER_XP_THRESHOLDS || [];
    const level = Math.max(0, Math.min(thresholds.length, Math.round(Number(mastery) || 0)));
    return level > 0 ? thresholds[level - 1] : 0;
  }

  function patternFor(rnd, rollDyeId) {
    const kit = window.GhoulSpecialVariants; // Shared Harlyao glyph + random-frame helpers (one owner for the temporary patterns).
    const glyphs = kit?.GLYPHS || [];
    if (!glyphs.length || !kit?.framedPattern) return null;
    const hex = dyeHex(rollDyeId?.()) || dyeHex('dye:CLOTH:dusty_blue') || '#7a8fb5';
    return { pattern: kit.framedPattern(glyphs[Math.floor(rnd() * glyphs.length)], rnd), fallbackColorC: { hex } };
  }

  // options: { rank, rnd, rollDyeId, metalKey, mastery }. Mutates and returns the roster.
  function style(roster, options = {}) {
    const { rank, rnd = Math.random, rollDyeId = null, metalKey = null, mastery = 0 } = options;
    if (!roster || !PANTS_PATTERN_RANKS.includes(rank)) return roster;
    const gender = roster.appearance?.gender === 'female' ? 'female' : 'male';
    const speciesId = roster.appearance?.speciesId;
    const slots = roster.cosmeticSlots || (roster.cosmeticSlots = {});
    let worn = [...(roster.equippedCosmetics || [])];
    const forced = {};

    const pants = patternFor(rnd, rollDyeId);
    if (pants) forced.pants = { ...pants, scale: PATTERN_SCALE.pants }; // The pants garment is attached later; the policy is keyed by slot, not by item.
    if (rank === 'captain') {
      const hasOverwear = worn.some(id => slots[id] === 'overwear');
      const overwear = hasOverwear ? patternFor(rnd, rollDyeId) : null;
      if (overwear) forced.overwear = { ...overwear, scale: PATTERN_SCALE.overwear };
    }
    if (Object.keys(forced).length) roster.clothingPatterns = { forcedOverpassBySlot: { ...(roster.clothingPatterns?.forcedOverpassBySlot || {}), ...forced } };

    const pieces = RANK_METAL_PIECES[rank] || [];
    const armor = window.MetalArmorSystem;
    if (pieces.length && armor?.makeCraftedItem && metalKey) {
      roster.metalArmorItems = (roster.metalArmorItems || []).filter(item => !pieces.includes(item.baseCosmeticId));
      if (pieces.includes('tangedcirclet')) { // The circlet is the head covering: it replaces any rolled hat.
        for (const id of worn) if (slots[id] === 'hat' || /^appearance::hat::/.test(id)) delete slots[id];
        worn = worn.filter(id => slots[id] !== 'hat' && !/^appearance::hat::/.test(id));
      }
      for (const id of pieces) {
        const item = armor.makeCraftedItem(id, metalKey);
        if (!item) continue;
        item.temperXp = temperXpForMastery(mastery); // Verdigris follows the weapon's mastery: a veteran's armor is as oxidized as its weapon.
        item.sprite = armor.spriteForBlueprintAppearance?.(id, { speciesId, gender }) || item.sprite;
        roster.metalArmorItems.push(item);
        worn.push(id);
        slots[id] = id === 'tangedcirclet' ? 'hat' : 'pauldron';
      }
    }
    if (rank === 'lieutenant') { // Never a circlet, whatever the clothing pool rolled.
      worn = worn.filter(id => !/circlet/i.test(id));
      roster.metalArmorItems = (roster.metalArmorItems || []).filter(item => !/circlet/i.test(item.baseCosmeticId || item.cosmeticId || ''));
    }
    roster.equippedCosmetics = worn;
    roster.bandit = { ...(roster.bandit || {}), rankWardrobe: { rank, metalKey: pieces.length ? metalKey : null, mastery } };
    return roster;
  }

  window.BanditRankWardrobe = Object.freeze({ PATTERN_SCALE, PANTS_PATTERN_RANKS, RANK_METAL_PIECES, style, temperXpForMastery });
})();
