// Mine ghoul variants: Shadowknights and the two Wyrm-witches get their own wardrobe, Harlyao-patterned with a random frame per spawn, and the
// knights carry an enchanted weapon (particles on the held weapon, lootable as a bound relic). BanditCombat calls style() while it builds the roster
// and tick() each frame; this module owns everything specific to these variants.
(() => {
  'use strict';

  const GLYPHS = Object.freeze(['harlyao_glyph_entropy', 'harlyao_glyph_servitude', 'harlyao_glyph_ignorance']); // Harlyao patterns until each variant gets its own.
  const KNIGHT_PATTERN_DYE = 'dye:CLOTH:shadow_blue';
  const WITCH_MAGIC_DYES = Object.freeze({ // The dyes closest to each magic; one is rolled per witch.
    'shadow-wind': Object.freeze(['dye:CLOTH:shadow_blue_indigo', 'dye:CLOTH:dark_muted_blue_indigo', 'dye:CLOTH:shadow_indigo']),
    'rend-water': Object.freeze(['dye:CLOTH:bright_blue', 'dye:CLOTH:pure_blue', 'dye:CLOTH:bright_green_blue', 'dye:CLOTH:deep_blue']),
  });
  const PATTERN_SCALE = Object.freeze({ pants: 4, overwear: 1.05, hood: 1.05 }); // Same per-piece sizes as the liches (the pants sprite is much larger).
  const FRAME_SHRINK = Object.freeze({ min: 0.4, max: 1 });
  const SLOTS = Object.freeze(['tap1', 'tap2', 'hold1', 'hold2']);
  const KNIGHT_SECOND_ENCHANTMENT_CHANCE = 0.85; // "Usually" a Base plus one other enchantment.
  const clone = value => JSON.parse(JSON.stringify(value));

  let tierMetalsPromise = null;
  function loadTierMetals() { // The mine's own tier-to-metal table (docs/config/town-mine.json) is the single authority.
    if (!tierMetalsPromise) {
      tierMetalsPromise = fetch('config/town-mine.json').then(response => response.ok ? response.json() : null)
        .then(config => Array.isArray(config?.ladderMetalKeys) ? config.ladderMetalKeys : []).catch(() => []);
    }
    return tierMetalsPromise;
  }
  const tierMetal = (keys, tier) => keys[Math.max(0, Math.min(keys.length - 1, (Number(tier) || 1) - 1))] || 'nativeCopper';

  const catalog = () => window.ScratchbonesAccount?.getDyeCatalog?.() || window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [];
  const dyeHex = id => { const hex = catalog().find(dye => dye.id === id)?.hex; return /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : null; };

  function glyphPattern(glyphId) {
    const cached = window.RepoPatternLibrary?.getCachedById?.(glyphId)?.pattern;
    return cached ? clone(cached) : { repoPatternId: glyphId, motifUrl: 'assets/patterns/motif_' + glyphId + '.png', motifScale: 1, tiling: true };
  }
  // One Harlyao glyph with a random frame. frameShape must be declared or the weaver's legacy path discards the frame fields.
  function framedPattern(glyphId, rnd) {
    const pattern = glyphPattern(glyphId);
    pattern.frameShape = pattern.frameShape || (pattern.repeatMode === 'grid' ? 'square' : 'triangle');
    pattern.frameScale = Number((Math.max(0.05, Number(pattern.frameScale) || 1) * (FRAME_SHRINK.min + (FRAME_SHRINK.max - FRAME_SHRINK.min) * rnd())).toFixed(4));
    pattern.frameRotationDeg = Math.round(rnd() * 3600) / 10;
    return pattern;
  }

  // Rolls an enchanted weapon: one Base, usually plus one enchantment of another type (a Flourish), with a random particle color and effect.
  function rollEnchantedWeapon(rnd) {
    const defs = Object.values(window.EnchantmentSystem?.DEFINITIONS || {});
    const bases = defs.filter(def => def.type === 'Base'), flourishes = defs.filter(def => def.type === 'Flourish');
    if (!bases.length) return null;
    const pick = list => list[Math.floor(rnd() * list.length)];
    const base = pick(bases);
    const enchantments = { base: [base.id], flourishes: {} };
    const chosen = [base];
    if (flourishes.length && rnd() < KNIGHT_SECOND_ENCHANTMENT_CHANCE) {
      const flourish = pick(flourishes);
      enchantments.flourishes[pick(SLOTS)] = flourish.id;
      chosen.push(flourish);
    }
    const vocabulary = window.WeaponEnchantmentVFX?.ALIGNMENTS || {};
    const counts = {};
    for (const def of chosen) counts[def.alignment] = (counts[def.alignment] || 0) + 1;
    const usable = Object.keys(counts).filter(plane => vocabulary[plane]);
    let visual = null;
    if (usable.length) {
      const alignment = pick(usable), colorAlignment = pick(usable);
      visual = { alignment, colorAlignment, dyeId: pick(vocabulary[colorAlignment].dyeIds), effectId: pick(vocabulary[alignment].effects).id };
    }
    return { enchantments, visual, counts };
  }

  function metalPiece(id, metalKey, gender, pattern, paintHex, mastery = 0) {
    const armor = window.MetalArmorSystem;
    const item = armor?.makeCraftedItem?.(id, metalKey);
    if (!item) return null;
    item.temperXp = window.BanditRankWardrobe?.temperXpForMastery?.(mastery) || 0; // Temper (verdigris) follows the weapon's mastery.
    item.sprite = armor.spriteForBlueprintAppearance?.(id, { speciesId: 'ghoul', gender });
    item.smithTreatment = { mode: 'painted', metalKey, pattern, paintHex }; // The metal itself, painted with the piece's own random-framed pattern.
    return item;
  }

  // Dresses a mine ghoul variant. options: { rnd, tier, shadowknight, witchType }. Main clothing colors stay the ordinary ghoul's (set by BanditCombat).
  async function style(roster, options = {}) {
    const { rnd = Math.random, tier = 1, shadowknight = false, witchType = null, mastery = 0 } = options;
    if (!roster || (!shadowknight && !witchType)) return roster;
    const gender = roster.appearance?.gender === 'female' ? 'female' : 'male';
    const slots = roster.cosmeticSlots || (roster.cosmeticSlots = {});
    const dropSlots = new Set(shadowknight ? ['hood', 'hat', 'overwear', 'pauldron'] : ['hood', 'hat', 'pants']);
    const kept = (roster.equippedCosmetics || []).filter(id => !dropSlots.has(slots[id]) && !/^appearance::hat::/.test(id));
    for (const id of roster.equippedCosmetics || []) if (!kept.includes(id)) delete slots[id];
    const wear = (id, slot) => { kept.push(id); slots[id] = slot; };
    const patternDyeId = shadowknight ? KNIGHT_PATTERN_DYE : WITCH_MAGIC_DYES[witchType]?.[Math.floor(rnd() * (WITCH_MAGIC_DYES[witchType]?.length || 1))];
    const patternHex = dyeHex(patternDyeId) || '#4a6fb5';
    const glyph = GLYPHS[Math.floor(rnd() * GLYPHS.length)];

    wear('fine_hood', 'hood');
    if (shadowknight) wear('rough_cloth_poncho', 'overwear');
    else wear('layered_skirt', 'pants');
    const forced = {
      hood: { pattern: framedPattern(glyph, rnd), fallbackColorC: { hex: patternHex }, scale: PATTERN_SCALE.hood },
      [shadowknight ? 'overwear' : 'pants']: { pattern: framedPattern(glyph, rnd), fallbackColorC: { hex: patternHex }, scale: shadowknight ? PATTERN_SCALE.overwear : PATTERN_SCALE.pants },
    };
    if (!shadowknight) forced.overwear = { pattern: framedPattern(glyph, rnd), fallbackColorC: { hex: patternHex }, scale: PATTERN_SCALE.overwear }; // Witches keep their rolled wrap/poncho, patterned too.
    else forced.pants = { pattern: framedPattern(glyph, rnd), fallbackColorC: { hex: patternHex }, scale: PATTERN_SCALE.pants }; // Knights keep their rolled pants, patterned too.
    roster.clothingPatterns = { forcedOverpassBySlot: Object.fromEntries(Object.entries(forced).filter(([, entry]) => entry)) };

    // Metal pieces: witches wear silver circlets, knights a circlet and pauldrons of their tier's metal; each painted with its own random frame.
    const metalKey = shadowknight ? tierMetal(await loadTierMetals(), tier) : 'silver';
    const pieces = shadowknight ? ['tangedcirclet', 'rounded_pauldron'] : ['tangedcirclet'];
    roster.metalArmorItems = (roster.metalArmorItems || []).filter(item => !dropSlots.has(item.slot));
    for (const id of pieces) {
      const item = metalPiece(id, metalKey, gender, framedPattern(glyph, rnd), patternHex, mastery);
      wear(id, id === 'tangedcirclet' ? 'hat' : 'pauldron');
      if (item) roster.metalArmorItems.push(item);
    }
    roster.equippedCosmetics = kept;
    roster.ghoulVariant = { kind: shadowknight ? 'shadowknight' : 'wyrm-witch:' + witchType, patternDyeId, glyph, metalKey };
    if (shadowknight) roster.enchantedWeapon = rollEnchantedWeapon(rnd) || undefined;
    return roster;
  }

  // Per-frame: attach and drive the enchantment particles on a knight's held weapon (the same emitter as the player's enchanted weapons).
  function tick(entity, toolDefs) {
    const enchanted = entity?.rosterRecord?.enchantedWeapon;
    if (!enchanted?.visual) return;
    if (!entity.avatarRef?.group?.parent) { entity._enchantFx?.dispose?.(); entity._enchantFx = null; return; }
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - (entity._enchantFxAt || now)) / 1000));
    entity._enchantFxAt = now;
    if (!entity._enchantFx && !entity._enchantFxFailed) {
      const holder = entity._banditToolHolder;
      const plane = holder?.userData?.toolPlane || holder?.children?.[0]?.userData?.toolPlane;
      const spritePath = toolDefs?.[entity.def?.weaponKey]?.sprite || toolDefs?.[entity.def?.weaponKey]?.baseSprite;
      if (!plane || !spritePath || !window.WeaponEnchantmentVFX?.createFixedEmitter) return; // The weapon plane is built a moment after the entity.
      entity._enchantFx = window.WeaponEnchantmentVFX.createFixedEmitter(plane, { visual: enchanted.visual, counts: enchanted.counts, spritePath });
      if (!entity._enchantFx) entity._enchantFxFailed = true;
    }
    entity._enchantFx?.update(dt);
  }

  // Corpse loot: the enchanted weapon comes off the body as a bound Harlyao relic with its exact enchantments and particle choice.
  function lootEnchantedWeapon(entity) {
    const enchanted = entity?.rosterRecord?.enchantedWeapon;
    const relics = window.HarlyaoRelics;
    if (!enchanted?.enchantments || !relics?.grantBoundRelic || !relics.makeRelic) return null;
    const shapes = Object.keys(relics.SHAPES || {});
    const relic = { ...relics.makeRelic(shapes[Math.floor(Math.random() * shapes.length)]), enchantments: clone(enchanted.enchantments), ...(enchanted.visual ? { visual: clone(enchanted.visual) } : {}) };
    const key = relics.grantBoundRelic(relic);
    return key ? { key, label: relics.SHAPES[relic.shape].label } : null;
  }

  window.GhoulSpecialVariants = Object.freeze({ GLYPHS, WITCH_MAGIC_DYES, KNIGHT_PATTERN_DYE, PATTERN_SCALE, style, tick, rollEnchantedWeapon, lootEnchantedWeapon, framedPattern, tierMetal });
})();
