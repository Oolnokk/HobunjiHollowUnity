(() => {
  'use strict';

  // Trait alchemy owns authored reactions, exact mixed-source enumeration,
  // recipe discovery, stored potency, active buffs, and contextual scoring.
  let deps = null; // Used by inventory/UI/save side effects after init().
  const TRAIT_CATEGORIES = Object.freeze(['humour', 'drive', 'magnetism']); // Used by the one legal-source enumerator.
  const HUMOURS = Object.freeze(['breath', 'bones', 'flesh', 'blood', 'bile', 'senses']); // Used to validate authored data.
  const DRIVES = Object.freeze(['restore', 'afflict', 'greaten', 'lighten']); // Used to validate authored data.
  const MAGNETISMS = Object.freeze(['water', 'fire', 'earth', 'wind']); // Used to validate authored data.
  const ELEMENT_DURATION_S = Object.freeze({ water: 90, earth: 90, wind: 52, fire: 15 }); // Shared timed-effect tuning.
  const RAW_POTENCY_FACTOR = 0.25; // Used by raw reagent consumption without skill scaling.
  const POTENCY_TIER_MULTIPLIERS = Object.freeze([1, 1.15, 1.3, 1.45, 1.6]); // Stored brewed potency tiers.
  const TARGET_CHANCE_MIN = 0.5; // Intentional-brew chance at Alchemy 0.
  const TARGET_CHANCE_MAX = 0.93; // Intentional-brew chance at Alchemy 20.
  const MAX_REAGENTS = 3; // Existing Alchemy Table capacity.
  const DEFAULT_SPLASH_RADIUS_TILES = 1.35; // Flask fallback radius.
  const FAMILY_ORDER = Object.freeze(['damage', 'control', 'offensiveDebuff', 'defensiveDebuff']); // Four Cures-button families.
  const traitKey = traits => `${traits.humour}.${traits.drive}.${traits.magnetism}`; // Canonical reaction lookup.
  const recipe = (id, humour, drive, magnetism, data) => Object.freeze({ // Central recipe metadata constructor.
    id, traits: Object.freeze({ humour, drive, magnetism }),
    traitKey: `${humour}.${drive}.${magnetism}`,
    basePotency: 1, elementalTuning: magnetism, baseBatch: 1, ...data,
  });

  const RECIPE_DEFS = Object.freeze({
    healingPotion: recipe('healingPotion', 'flesh', 'restore', 'water', { baseBatch: 2, label: 'Healing Potion', icon: '🧪', useMode: 'drink', application: 'restoreHealth', amount: 32, desc: 'Instantly restores Health.' }),
    greaterHealingPotion: recipe('greaterHealingPotion', 'flesh', 'restore', 'fire', { baseBatch: 2, label: 'Greater Healing Potion', icon: '🧪', useMode: 'drink', application: 'restoreHealth', amount: 68, desc: 'Instantly restores substantially more Health.' }),
    staminaPotion: recipe('staminaPotion', 'breath', 'restore', 'water', { baseBatch: 2, label: 'Stamina Potion', icon: '⚗️', useMode: 'drink', application: 'restoreStamina', amount: 34, exhaustionAmount: 28, desc: 'Restores Stamina and black-Stamina debt.' }),
    greaterStaminaPotion: recipe('greaterStaminaPotion', 'breath', 'restore', 'fire', { baseBatch: 2, label: 'Greater Stamina Potion', icon: '⚗️', useMode: 'drink', application: 'restoreStamina', amount: 72, exhaustionAmount: 62, desc: 'Restores substantially more Stamina and Exhaustion.' }),
    potionOfBalance: recipe('potionOfBalance', 'bones', 'restore', 'water', { baseBatch: 2, label: 'Potion of Balance', icon: '⚖️', useMode: 'drink', application: 'restoreFooting', amount: 45, desc: 'Restores Footing.' }),
    controlRemedy: recipe('controlRemedy', 'bones', 'restore', 'earth', { baseBatch: 2, label: 'Control Remedy', icon: '🪨', useMode: 'drink', application: 'cleanseFamily', family: 'control', amount: 42, desc: 'Removes Control-family afflictions.' }),
    woundRemedy: recipe('woundRemedy', 'blood', 'restore', 'water', { baseBatch: 2, label: 'Wound Remedy', icon: '🩹', useMode: 'drink', application: 'cleanseFamily', family: 'damage', amount: 48, desc: 'Removes Damage-family afflictions.' }),
    mendingDraught: recipe('mendingDraught', 'flesh', 'restore', 'earth', { baseBatch: 2, label: 'Mending Draught', icon: '🫗', useMode: 'drink', application: 'cleanseFamily', family: 'offensiveDebuff', amount: 42, desc: 'Removes Offensive-Debuff-family afflictions.' }),
    potionOfClarity: recipe('potionOfClarity', 'senses', 'restore', 'water', { baseBatch: 2, label: 'Potion of Clarity', icon: '👁️', useMode: 'drink', application: 'cleanseFamily', family: 'defensiveDebuff', amount: 42, desc: 'Removes Defensive-Debuff-family afflictions.' }),
    antidote: recipe('antidote', 'bile', 'restore', 'water', { baseBatch: 2, label: 'Antidote', icon: '🌿', useMode: 'drink', application: 'cleanseTag', tag: 'toxin', amount: 50, desc: 'Removes toxin-tagged afflictions across families.' }),
    soberingDraught: recipe('soberingDraught', 'bile', 'restore', 'fire', { baseBatch: 2, label: 'Sobering Draught', icon: '☕', useMode: 'drink', application: 'cleanseTag', tag: 'alcohol', amount: 65, desc: 'Rapidly reduces drunkenness.' }),

    breedingGigantism: recipe('breedingGigantism', 'bones', 'greaten', 'water', { label: 'Breeding Potion of Gigantism', icon: '🐘', useMode: 'livestock', application: 'nextOffspringSize', sizeShift: 1, desc: "Raises the affected animal's next offspring by one Size class." }),
    potionOfPoise: recipe('potionOfPoise', 'bones', 'greaten', 'earth', { label: 'Potion of Poise', icon: '🗿', useMode: 'drink', application: 'buff', stat: 'maxFooting', magnitude: 0.35, durationS: 90, desc: 'Temporarily increases maximum Footing.' }),
    potionOfImpact: recipe('potionOfImpact', 'bones', 'greaten', 'fire', { label: 'Potion of Impact', icon: '💥', useMode: 'drink', application: 'buff', stat: 'footingDamage', magnitude: 1.5, durationS: 15, desc: 'Enormously increases knockback and Footing damage briefly.' }),
    potionOfRegeneration: recipe('potionOfRegeneration', 'flesh', 'greaten', 'water', { label: 'Potion of Regeneration', icon: '💚', useMode: 'drink', application: 'buff', stat: 'healthRegen', magnitude: 1, durationS: 90, desc: 'Increases existing Health regeneration.' }),
    potionOfStrength: recipe('potionOfStrength', 'flesh', 'greaten', 'earth', { label: 'Potion of Strength', icon: '💪', useMode: 'drink', application: 'buff', stat: 'outgoingDamage', magnitude: 0.35, durationS: 90, desc: 'Increases outgoing damage.' }),
    potionOfFury: recipe('potionOfFury', 'flesh', 'greaten', 'fire', { label: 'Potion of Fury', icon: '🔥', useMode: 'drink', application: 'buff', stat: 'outgoingDamage', magnitude: 1, durationS: 15, desc: 'Greatly increases outgoing damage very briefly.' }),
    potionOfQuickness: recipe('potionOfQuickness', 'flesh', 'greaten', 'wind', { label: 'Potion of Quickness', icon: '⚡', useMode: 'drink', application: 'buff', stat: 'attackSpeed', magnitude: 0.42, durationS: 52, desc: 'Increases attack and action speed.' }),
    potionOfEndurance: recipe('potionOfEndurance', 'breath', 'greaten', 'water', { label: 'Potion of Endurance', icon: '🫁', useMode: 'drink', application: 'buff', stat: 'maxStamina', secondaryStat: 'staminaRegen', magnitude: 0.35, durationS: 90, desc: 'Increases Stamina capacity and regeneration.' }),
    potionOfVigor: recipe('potionOfVigor', 'breath', 'greaten', 'fire', { label: 'Potion of Vigor', icon: '⚡', useMode: 'drink', application: 'buff', stat: 'staminaRegen', magnitude: 2.4, durationS: 15, desc: 'Provides extremely strong Stamina recovery briefly.' }),
    thickbloodPotion: recipe('thickbloodPotion', 'blood', 'greaten', 'earth', { label: 'Thickblood Potion', icon: '🩸', useMode: 'drink', application: 'buff', stat: 'incomingDamageAffliction', magnitude: 0.55, durationS: 90, desc: 'Reduces incoming Damage-family affliction buildup.' }),
    lovePotion: recipe('lovePotion', 'blood', 'greaten', 'fire', { label: 'Love Potion', icon: '💗', useMode: 'drink', application: 'buff', stat: 'positiveFavor', magnitude: 1, durationS: 15, desc: 'Temporarily doubles positive NPC favor gains.' }),
    potionOfPerception: recipe('potionOfPerception', 'senses', 'greaten', 'wind', { label: 'Potion of Perception', icon: '👁️', useMode: 'drink', application: 'buff', stat: 'perception', magnitude: 0.6, durationS: 52, desc: 'Boosts existing Perception-weighted mechanics.' }),

    breedingPygmation: recipe('breedingPygmation', 'bones', 'lighten', 'water', { label: 'Breeding Potion of Pygmation', icon: '🐁', useMode: 'livestock', application: 'nextOffspringSize', sizeShift: -1, desc: "Lowers the affected animal's next offspring by one Size class." }),
    potionOfSpeed: recipe('potionOfSpeed', 'bones', 'lighten', 'wind', { label: 'Potion of Speed', icon: '🏃', useMode: 'drink', application: 'buff', stat: 'movementSpeed', magnitude: 0.45, durationS: 52, desc: 'Increases movement speed.' }),
    potionOfEfficiency: recipe('potionOfEfficiency', 'breath', 'lighten', 'wind', { label: 'Potion of Efficiency', icon: '🪶', useMode: 'drink', application: 'buff', stat: 'staminaSpend', magnitude: 0.38, durationS: 52, desc: 'Reduces Stamina costs.' }),

    hemorrhageFlask: recipe('hemorrhageFlask', 'blood', 'afflict', 'fire', { baseBatch: 2, label: 'Hemorrhage Flask', icon: '🧨', useMode: 'throw', application: 'affliction', afflictionId: 'bleedingHealth', amount: 48, splashRadius: 1.45, particleColors: ['#b3132b', '#ff5668'], particleIntensity: 1.35, desc: 'Applies a large amount of Bleeding Health in a splash.' }),
    woundingFlask: recipe('woundingFlask', 'blood', 'afflict', 'water', { baseBatch: 2, label: 'Wounding Flask', icon: '🫙', useMode: 'throw', application: 'affliction', afflictionId: 'woundedStamina', amount: 28, splashRadius: 1.35, particleColors: ['#6aa8d9', '#bb263f'], desc: 'Applies Wounded Stamina in a splash.' }),
    congealingFlask: recipe('congealingFlask', 'blood', 'afflict', 'earth', { baseBatch: 2, label: 'Congealing Flask', icon: '🫙', useMode: 'throw', application: 'affliction', afflictionId: 'congealedHealth', amount: 30, splashRadius: 1.3, particleColors: ['#6d2c31', '#9b7452'], desc: 'Applies Congealed Health in a splash.' }),
    bruisingFlask: recipe('bruisingFlask', 'flesh', 'afflict', 'earth', { baseBatch: 2, label: 'Bruising Flask', icon: '🫙', useMode: 'throw', application: 'affliction', afflictionId: 'bruisedHealth', amount: 34, splashRadius: 1.3, particleColors: ['#5c427f', '#bf8c72'], desc: 'Applies Bruised Health in a splash.' }),
    venomFlask: recipe('venomFlask', 'bile', 'afflict', 'fire', { baseBatch: 2, label: 'Venom Flask', icon: '☠️', useMode: 'throw', application: 'affliction', afflictionId: 'poisonedHealth', amount: 46, splashRadius: 1.4, particleColors: ['#8cff37', '#8433ad'], particleIntensity: 1.35, desc: 'Applies a high amount of Poisoned Health in a splash.' }),
    sickeningFlask: recipe('sickeningFlask', 'bile', 'afflict', 'water', { baseBatch: 2, label: 'Sickening Flask', icon: '🤢', useMode: 'throw', application: 'affliction', afflictionId: 'infectedStamina', amount: 28, splashRadius: 1.35, particleColors: ['#7aae70', '#89d7c5'], desc: 'Applies Infected Stamina in a splash.' }),
    windingFlask: recipe('windingFlask', 'breath', 'afflict', 'earth', { baseBatch: 2, label: 'Winding Flask', icon: '💨', useMode: 'throw', application: 'affliction', afflictionId: 'windedStamina', amount: 32, splashRadius: 1.3, particleColors: ['#f1d66e', '#7b9f9c'], desc: 'Applies Winded Stamina in a splash.' }),
    rushNarcotic: recipe('rushNarcotic', 'bones', 'afflict', 'wind', { label: 'Rush Narcotic', icon: '🌀', useMode: 'drink', application: 'narcotic', stat: 'movementSpeed', magnitude: 0.75, durationS: 52, drawback: { type: 'footing', amount: 35 }, desc: 'Greatly increases speed while sacrificing Footing.' }),
    frenzyNarcotic: recipe('frenzyNarcotic', 'flesh', 'afflict', 'wind', { label: 'Frenzy Narcotic', icon: '😈', useMode: 'drink', application: 'narcotic', stat: 'attackSpeed', magnitude: 0.72, durationS: 52, drawback: { type: 'affliction', id: 'bruisedHealth', amount: 24 }, desc: 'Greatly increases attack speed while applying Bruised Health.' }),
  });
  const RECIPE_BY_TRAITS = Object.freeze(Object.fromEntries(Object.values(RECIPE_DEFS).map(definition => [definition.traitKey, definition]))); // Enumerator lookup.

  const REAGENT_DEFS = Object.freeze({
    frostcapMoss:{label:'Frostcap Moss',icon:'🥶',zone:'map_northern_cliffs',color:0x9fd8e6,sellPrice:3,traits:{humour:'bones',drive:'restore',magnetism:'water'}},
    graniteThistle:{label:'Granite Thistle',icon:'🌵',zone:'map_northern_cliffs',color:0x8a8a78,sellPrice:3,traits:{humour:'bones',drive:'greaten',magnetism:'earth'}},
    palehartLichen:{label:'Palehart Lichen',icon:'🍂',zone:'map_northern_cliffs',color:0xc9c2a0,sellPrice:3,traits:{humour:'blood',drive:'restore',magnetism:'water'}},
    cinderveinBramble:{label:'Cindervein Bramble',icon:'🌿',zone:'map_northern_cliffs',color:0xb5493a,sellPrice:3,traits:{humour:'flesh',drive:'greaten',magnetism:'fire'}},
    shalefrondFern:{label:'Shalefrond Fern',icon:'🌾',zone:'map_northern_cliffs',color:0x6f8f7a,sellPrice:3,traits:{humour:'bones',drive:'restore',magnetism:'earth'}},
    mistpetalBloom:{label:'Mistpetal Bloom',icon:'🌸',zone:'map_southern_cloud_forest',color:0xd7b7e8,sellPrice:3,traits:{humour:'senses',drive:'restore',magnetism:'water'}},
    duskcapMushroom:{label:'Duskcap Mushroom',icon:'🍄',zone:'map_southern_cloud_forest',color:0x5a4a78,sellPrice:3,traits:{humour:'flesh',drive:'afflict',magnetism:'wind'}},
    silverfernFrond:{label:'Silverfern Frond',icon:'🌿',zone:'map_southern_cloud_forest',color:0xc8d8c0,sellPrice:3,traits:{humour:'flesh',drive:'greaten',magnetism:'wind'}},
    cloudberryVine:{label:'Cloudberry Vine',icon:'🫐',zone:'map_southern_cloud_forest',color:0x8ec6e0,sellPrice:3,traits:{humour:'bones',drive:'lighten',magnetism:'wind'}},
    hazewortSprig:{label:'Hazewort Sprig',icon:'🌱',zone:'map_southern_cloud_forest',color:0xa0b090,sellPrice:3,traits:{humour:'blood',drive:'greaten',magnetism:'earth'}},
    windrootBulb:{label:'Windroot Bulb',icon:'🧅',zone:'map_western_slope',color:0xe8d27a,sellPrice:3,traits:{humour:'breath',drive:'lighten',magnetism:'wind'}},
    goldbrushWeed:{label:'Goldbrush Weed',icon:'🌾',zone:'map_western_slope',color:0xdba936,sellPrice:3,traits:{humour:'flesh',drive:'greaten',magnetism:'earth'}},
    larkspurTuft:{label:'Larkspur Tuft',icon:'💐',zone:'map_western_slope',color:0x7fb0e0,sellPrice:3,traits:{humour:'senses',drive:'greaten',magnetism:'wind'}},
    sunbarleyHead:{label:'Sunbarley Head',icon:'🌾',zone:'map_western_slope',color:0xe0c95f,sellPrice:3,traits:{humour:'breath',drive:'greaten',magnetism:'fire'}},
    thistledownCap:{label:'Thistledown Cap',icon:'🌼',zone:'map_western_slope',color:0xeee4c0,sellPrice:3,traits:{humour:'flesh',drive:'restore',magnetism:'water'}},
    bogwortLeaf:{label:'Bogwort Leaf',icon:'🍃',zone:'map_eastern_mire',color:0x4a6b3a,sellPrice:3,traits:{humour:'flesh',drive:'afflict',magnetism:'earth'}},
    mireLotusBud:{label:'Mire Lotus Bud',icon:'🪷',zone:'map_eastern_mire',color:0xc06090,sellPrice:3,traits:{humour:'bile',drive:'restore',magnetism:'water'}},
    sporeclusterCap:{label:'Sporecluster Cap',icon:'🍄',zone:'map_eastern_mire',color:0x6a5a3a,sellPrice:3,traits:{humour:'bile',drive:'afflict',magnetism:'water'}},
    weepingReed:{label:'Weeping Reed',icon:'🌾',zone:'map_eastern_mire',color:0x3a5a4a,sellPrice:3,traits:{humour:'breath',drive:'afflict',magnetism:'earth'}},
    muckmelonRind:{label:'Muckmelon Rind',icon:'🍈',zone:'map_eastern_mire',color:0x8a9a3a,sellPrice:3,traits:{humour:'bile',drive:'afflict',magnetism:'fire'}},
  });

  const POTION_ITEMS = {}; // Item key -> stored recipe/potency payload.
  const discoveredRecipes = new Set(); // Recipe-level discovery state.
  let activeEffects = []; // Timed alchemy effects exposed through EffectBuffBar.
  let selectedReagents = []; // Existing table selection state.
  let targetedRecipeId = null; // Current intentional known recipe.
  let lastBrewDiagnostics = null; // Last exact source-assignment report.
  let lastContextSignature = ''; // Thresholded selector refresh state.

  function init(injectedDeps = {}) {
    deps = injectedDeps; // All runtime adapters remain injected by game.js.
    window.EffectBuffBar?.registerProvider('alchemy', () => {
      const now = performance.now() / 1000; // Convert expiries to HUD seconds.
      return activeEffects.map(effect => ({ ...effect, sourceLabel: 'Alchemy', remainingS: effect.expiresAt - now }));
    });
    registerReagentItemDefs();
  }
  function reagentsForZone(mapId) { return Object.keys(REAGENT_DEFS).filter(key => REAGENT_DEFS[key].zone === mapId); }
  function validateTraits(traits) { return !!traits && HUMOURS.includes(traits.humour) && DRIVES.includes(traits.drive) && MAGNETISMS.includes(traits.magnetism); }
  function nativeRecipeForReagent(key) { const definition = REAGENT_DEFS[key]; return definition ? RECIPE_BY_TRAITS[traitKey(definition.traits)] || null : null; } // Native trio resolver.

  // The Set-size check is the mandatory contribution rule. With two inputs,
  // both sources must appear; with three, each source appears exactly once.
  function enumerateRecipes(reagentKeys) {
    const keys = [...(reagentKeys || [])]; // Keep caller selection immutable.
    if (keys.length < 2 || keys.length > 3 || new Set(keys).size !== keys.length || keys.some(key => !REAGENT_DEFS[key])) return [];
    const outcomes = new Map(); // Deduplicate recipe IDs while retaining assignments.
    const sources = keys.map((_key, index) => index); // Category source candidates.
    for (const h of sources) for (const d of sources) for (const m of sources) {
      if (new Set([h, d, m]).size !== keys.length) continue;
      const traits = { humour: REAGENT_DEFS[keys[h]].traits.humour, drive: REAGENT_DEFS[keys[d]].traits.drive, magnetism: REAGENT_DEFS[keys[m]].traits.magnetism }; // Mixed trio.
      const definition = RECIPE_BY_TRAITS[traitKey(traits)]; // Undefined permutations intentionally vanish.
      if (!definition) continue;
      const sourceByCategory = { humour: keys[h], drive: keys[d], magnetism: keys[m] }; // Diagnostics source map.
      const assignment = { ...sourceByCategory, contributes: Object.fromEntries(keys.map(key => [key, TRAIT_CATEGORIES.filter(category => sourceByCategory[category] === key)])) }; // Per-input contribution proof.
      const outcome = outcomes.get(definition.id) || { recipeId: definition.id, recipe: definition, traits, assignments: [] }; // Dedup target.
      outcome.assignments.push(assignment); outcomes.set(definition.id, outcome);
    }
    return [...outcomes.values()];
  }
  function canAddReagent(selected, candidate) { const keys = [...selected, candidate]; return keys.length <= MAX_REAGENTS && new Set(keys).size === keys.length && enumerateRecipes(keys).length > 0; } // Exact graying rule.
  function alchemyLevel() { return Math.max(0, Math.min(20, Number(window.SkillSystem?.level?.('alchemy')) || 0)); }
  function potencyTierForLevel(level = alchemyLevel()) { return Math.min(4, Math.floor(Math.max(0, Math.min(20, Number(level) || 0)) / 5)); }
  function potencyMultiplier(tier) { return POTENCY_TIER_MULTIPLIERS[Math.max(0, Math.min(4, Math.floor(Number(tier) || 0)))]; }
  function targetingProbability(level = alchemyLevel(), possibleCount = 2) {
    if (possibleCount <= 1) return 1;
    const ratio = Math.max(0, Math.min(1, Number(level) / 20)); // One centralized reliability curve.
    const perkBonus = (window.PerkSystem?.rank('alchemy', 'increasePrecision') || 0) * 0.03; // Increase Precision perk.
    return Math.min(0.99, TARGET_CHANCE_MIN + (TARGET_CHANCE_MAX - TARGET_CHANCE_MIN) * ratio + perkBonus);
  }
  function setTargetRecipe(recipeId) { targetedRecipeId = recipeId && discoveredRecipes.has(recipeId) && RECIPE_DEFS[recipeId] ? recipeId : null; renderPanel(); return targetedRecipeId; }
  function chooseOutcome(outcomes, targetId = targetedRecipeId, random = deps?.random || window.GameRandom?.random || Math.random, levelOverride = null) {
    if (!outcomes.length) return null;
    const target = outcomes.find(outcome => outcome.recipeId === targetId); // Produce target only when ingredients allow it.
    if (!target) return outcomes[Math.floor(random() * outcomes.length)];
    if (outcomes.length === 1 || random() < targetingProbability(levelOverride ?? alchemyLevel(), outcomes.length)) return target;
    const alternatives = outcomes.filter(outcome => outcome.recipeId !== target.recipeId); // Failed targeting still brews.
    return alternatives[Math.floor(random() * alternatives.length)];
  }
  // Empower Flasks / Empower Healing Potions and Cures / Empower Buff Potions —
  // each scales both the applied magnitude (here) and, for Flasks/Healing &
  // Cures, the batch size a single brew yields (see batchCountFor below).
  function empowerRankFor(definition) {
    const isFlask = definition.useMode === 'throw';
    const isHealingCure = definition.application === 'restoreHealth' || definition.application === 'cleanseFamily' || definition.application === 'cleanseTag';
    const isBuff = definition.application === 'buff' || definition.application === 'narcotic';
    const perkId = isFlask ? 'empowerFlasks' : isHealingCure ? 'empowerHealingCures' : isBuff ? 'empowerBuffPotions' : null;
    return perkId ? (window.PerkSystem?.rank('alchemy', perkId) || 0) : 0;
  }
  function empowerFactor(definition) { return 1 + empowerRankFor(definition) * 0.15; }
  // Every potion/flask recipe now brews a base batch (recipe.baseBatch, most
  // commonly 2 for medicine potions and flasks) instead of a single item.
  // Empower Flasks/Empower Healing Potions and Cures each further multiply
  // that batch: rank 1 doubles it, rank 2 triples it.
  function batchCountFor(recipeId) {
    const definition = RECIPE_DEFS[recipeId];
    if (!definition) return 1;
    const isFlask = definition.useMode === 'throw';
    const isHealingCure = definition.application === 'restoreHealth' || definition.application === 'cleanseFamily' || definition.application === 'cleanseTag';
    const rank = isFlask ? (window.PerkSystem?.rank('alchemy', 'empowerFlasks') || 0) : isHealingCure ? (window.PerkSystem?.rank('alchemy', 'empowerHealingCures') || 0) : 0;
    const batchMultiplier = 1 + Math.min(2, rank); // rank0 = base, rank1 = double, rank2 = triple.
    return Math.max(1, Math.round((definition.baseBatch || 1) * batchMultiplier));
  }
  function discoverRecipe(recipeId, reason = 'discovered recipe') {
    if (!RECIPE_DEFS[recipeId] || discoveredRecipes.has(recipeId)) return false;
    discoveredRecipes.add(recipeId);
    window.SkillSystem?.award?.('alchemy', window.SkillSystem?.XP_GAINS?.alchemyDiscovery || 18, reason);
    deps?.showToast?.(`📖 Discovered: ${RECIPE_DEFS[recipeId].label}`, true);
    document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail: { type: 'discovery', recipeId } }));
    return true;
  }
  function serializeKnownRecipes() { return [...discoveredRecipes].filter(id => RECIPE_DEFS[id]); }
  function restoreKnownRecipes(saved, legacy = null) {
    discoveredRecipes.clear();
    const ids = Array.isArray(saved) ? saved : Array.isArray(saved?.recipes) ? saved.recipes : []; // Accept compact/versioned new saves.
    ids.forEach(id => { if (RECIPE_DEFS[id]) discoveredRecipes.add(id); });
    const old = legacy || (!Array.isArray(saved) && saved && !saved.recipes ? saved : null); // Safe old knownReagentEffects migration.
    Object.entries(old || {}).forEach(([key, indices]) => { const native = Array.isArray(indices) && indices.length && nativeRecipeForReagent(key); if (native) discoveredRecipes.add(native.id); });
  }
  const serializeKnownEffects = serializeKnownRecipes; // Old save-caller compatibility.
  const restoreKnownEffects = saved => restoreKnownRecipes(saved, saved); // Old save-caller compatibility.
  const discoveryCount = () => discoveredRecipes.size;
  const isRecipeKnown = id => discoveredRecipes.has(id);

  function itemKeyForRecipe(recipeId, tier = 0) { return `alchemy_${recipeId}_p${Math.max(0, Math.min(4, Math.floor(Number(tier) || 0)))}`; }
  function parseBrewedItemKey(key) { const match = /^alchemy_([A-Za-z0-9]+)_p([0-4])$/.exec(String(key || '')); return match && RECIPE_DEFS[match[1]] ? { recipeId: match[1], potencyTier: Number(match[2]) } : null; } // Immutable potency parser.
  function mixColor(keys) {
    let red = 0, green = 0, blue = 0, count = 0; // Existing reagent-color average.
    (keys || []).forEach(key => { const color = REAGENT_DEFS[key]?.color; if (color == null) return; red += color >> 16 & 255; green += color >> 8 & 255; blue += color & 255; count++; });
    return count ? Math.round(red / count) << 16 | Math.round(green / count) << 8 | Math.round(blue / count) : 0x8a5fb0;
  }
  function ensureRecipeItemDef(recipeId, tier = 0, reagentKeys = null) {
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
  function recipeScrollKey(recipeId) { return RECIPE_DEFS[recipeId] ? `alchemy_recipe_${recipeId}` : null; } // Common shops/quests/treasure recipe-item key.
  function ensureRecipeScrollItemDef(recipeId) {
    const definition = RECIPE_DEFS[recipeId]; // Authored recipe taught by the physical item.
    const key = recipeScrollKey(recipeId); // Stable recipe-item identity.
    if (!definition || !key) return null;
    if (deps?.ITEM_DEFS && !deps.ITEM_DEFS[key]) deps.ITEM_DEFS[key] = { icon: '📜', label: `Recipe: ${definition.label}`, cat: 'processed', sellPrice: 8, tags: ['Alchemy', 'Recipe'], desc: `Read to learn the ${definition.traits.humour} + ${definition.traits.drive} + ${definition.traits.magnetism} reaction.`, alchemyRecipeScrollId: recipeId };
    return key;
  }
  function readRecipeItem(itemKey) {
    const recipeId = String(itemKey || '').replace(/^alchemy_recipe_/, ''); // Recipe taught by this physical item.
    const definition = RECIPE_DEFS[recipeId]; // Validation and feedback source.
    if (!definition || (deps?.inventory?.[itemKey] || 0) < 1) return { ok: false, message: 'No readable alchemy recipe.' };
    deps.inventory[itemKey]--; deps.clampInventoryStack?.(itemKey);
    const learned = discoverRecipe(recipeId, 'read physical recipe'); // Idempotent recipe discovery.
    return { ok: true, learned, recipeId, message: learned ? `📜 Learned ${definition.label}.` : `📜 You already knew ${definition.label}.` };
  }
  function ensurePotionItemDef(value, reagentKeys) {
    if (typeof value === 'string' && RECIPE_DEFS[value]) return ensureRecipeItemDef(value, 0, reagentKeys);
    if (value?.recipeId) return ensureRecipeItemDef(value.recipeId, value.potencyTier, reagentKeys);
    const effects = Array.isArray(value) ? value : null; // Legacy-only payload.
    if (!effects?.length) return null;
    const key = `potion_${effects.slice().sort().join('_')}`; // Preserve old stacks without creating new ones.
    POTION_ITEMS[key] = Object.freeze({ legacyEffects: effects.slice() });
    if (deps?.ITEM_DEFS && !deps.ITEM_DEFS[key]) deps.ITEM_DEFS[key] = { icon: '🧪', label: `Legacy Potion of ${effects.join(' & ')}`, cat: 'processed', sellPrice: 0, tags: ['Potion', 'Alchemy', 'Legacy'], desc: 'A preserved pre-refactor potion.', spriteIcon: 'bottle_potion.png', spriteColor: mixColor(reagentKeys), spriteMode: 'keyed' };
    return key;
  }
  function getPotionEffectsFromKey(key) { const modern = parseBrewedItemKey(key); if (modern) return modern; if (!String(key || '').startsWith('potion_')) return null; const legacyEffects = String(key).slice(7).split('_').filter(Boolean); return legacyEffects.length ? { legacyEffects } : null; } // Old loader compatibility.
  function migrateLegacyPotionInventory(inventory = deps?.inventory) {
    const obvious = { strength:'potionOfStrength', fortitude:'potionOfPoise', vigor:'potionOfVigor', speed:'potionOfSpeed', perception:'potionOfPerception' }; // Honest one-effect equivalents only.
    Object.keys(inventory || {}).forEach(key => {
      const payload = getPotionEffectsFromKey(key);
      if (!payload?.legacyEffects || payload.legacyEffects.length !== 1 || !obvious[payload.legacyEffects[0]]) return;
      const count = Math.max(0, Number(inventory[key]) || 0);
      const modernKey = ensureRecipeItemDef(obvious[payload.legacyEffects[0]], 0);
      inventory[modernKey] = Math.min(99, (inventory[modernKey] || 0) + count);
      delete inventory[key];
    });
    return inventory;
  }
  function registerReagentItemDefs() {
    Object.entries(REAGENT_DEFS).forEach(([key, definition]) => {
      const item = deps?.ITEM_DEFS?.[key]; // Existing reagent item definition.
      if (!item) return;
      item.desc = `${String(item.desc || definition.label).split(' Traits:')[0]} Traits: ${definition.traits.humour}, ${definition.traits.drive}, ${definition.traits.magnetism}. Eat raw for a weak native reaction.`;
      item.tags = [...new Set([...(item.tags || []), 'Reagent', 'Consumable'])];
    });
  }

  function brewFrom(reagentKeys, options = {}) {
    const keys = [...(reagentKeys || [])]; // Exact selection submitted.
    if (keys.length < 2 || keys.length > 3) return { ok: false, message: 'Select 2–3 reagents.', consumed: [] };
    if (keys.some(key => (deps?.inventory?.[key] || 0) < 1)) return { ok: false, message: 'A selected reagent is no longer in your bag.', consumed: [] };
    const outcomes = enumerateRecipes(keys); // Shared runtime/UI/compatibility enumerator.
    if (!outcomes.length) return { ok: false, message: 'These ingredients have no valid mixed-source reaction.', consumed: [], outcomes };
    const target = options.targetRecipeId ?? targetedRecipeId; // Optional intentional recipe.
    const targetLevel = options.targetAlchemyLevel ?? alchemyLevel(); // Herbalist caps this away from a real Alchemy Table; potency below stays at the real level.
    const chosen = chooseOutcome(outcomes, target, options.random, targetLevel); // Always a valid defined recipe.
    const tier = potencyTierForLevel(options.alchemyLevel ?? alchemyLevel()); // Potency fixed at creation.
    keys.forEach(key => { deps.inventory[key]--; deps.clampInventoryStack?.(key); });
    const itemKey = ensureRecipeItemDef(chosen.recipeId, tier, keys); // One recipe per result.
    const batch = batchCountFor(chosen.recipeId); // Base batch (see recipe.baseBatch), scaled by Empower Flasks/Healing & Cures.
    deps.inventory[itemKey] = Math.min(99, (deps.inventory[itemKey] || 0) + batch);
    const discovered = discoverRecipe(chosen.recipeId, 'brewed new recipe'); // One-time discovery XP.
    window.SkillSystem?.award?.('alchemy', window.SkillSystem?.XP_GAINS?.alchemyBrew || 8, 'brewed potion');
    if (target && chosen.recipeId === target) window.SkillSystem?.award?.('alchemy', window.SkillSystem?.XP_GAINS?.alchemyTarget || 5, 'targeted recipe');
    lastBrewDiagnostics = { keys, outcomes, target, probability: target ? targetingProbability(targetLevel, outcomes.length) : null, chosenRecipeId: chosen.recipeId, potencyTier: tier, batch, everyIngredientContributes: outcomes.every(outcome => outcome.assignments.every(a => Object.values(a.contributes).every(list => list.length))) }; // Dev report.
    document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail: { type: 'brew', recipeId: chosen.recipeId, itemKey } }));
    return { ok: true, message: `⚗️ Brewed ${batch > 1 ? `${batch}× ` : ''}${RECIPE_DEFS[chosen.recipeId].label}${discovered ? ' — new reaction discovered!' : ''}`, consumed: keys, recipeId: chosen.recipeId, itemKey, potencyTier: tier, batch, outcomes };
  }
  let campfireBrewing = false; // Set while the Alchemy panel was opened via the Herbalist campfire flow.
  function setCampfireBrewing(active) { campfireBrewing = !!active; }
  function herbalistPrecisionFraction() {
    const rank = window.PerkSystem?.rank('alchemy', 'herbalist') || 0;
    return Math.max(0, Math.min(1, rank * 0.2)); // Rank 1-5 = 20%-100% of normal precision.
  }
  function brew() {
    const brewOptions = campfireBrewing ? { targetAlchemyLevel: alchemyLevel() * herbalistPrecisionFraction() } : {};
    const result = brewFrom(selectedReagents, brewOptions);
    if (result.ok) selectedReagents = [];
    deps?.refreshItemScroll?.();
    return result;
  } // Existing table adapter; also used by the campfire Herbalist flow via setCampfireBrewing.
  function playerEntity() { return deps?.getPlayer?.() || window.Combat?.deps?.player || null; }
  function addTimedEffect(definition, factor, tier = 0) {
    const now = performance.now() / 1000; // Absolute runtime expiry basis.
    const durationPerkRank = window.PerkSystem?.rank('alchemy', 'increasePotionDuration') || 0; // Increase Potion Duration perk.
    const durationS = (definition.durationS || ELEMENT_DURATION_S[definition.traits?.magnetism] || 60) * (1 + durationPerkRank * 0.15); // Shared elemental duration.
    const effect = { recipeId: definition.id, key: definition.id, label: definition.label, icon: definition.icon, kind: 'boon', stat: definition.stat, secondaryStat: definition.secondaryStat, magnitude: (Number(definition.magnitude) || 0) * factor, durationS, expiresAt: now + durationS, potencyTier: tier }; // HUD/query payload.
    const existing = activeEffects.find(entry => entry.recipeId === definition.id); // Refresh same buff.
    if (existing) Object.assign(existing, effect); else activeEffects.push(effect);
    window.EffectBuffBar?.refresh(true);
  }
  function applyRecipeToEntity(recipeId, factor = 1, entity = playerEntity(), options = {}) {
    const definition = RECIPE_DEFS[recipeId]; // Authoritative effect record.
    if (!definition || !entity || !(factor > 0)) return { ok: false, message: 'That alchemical reaction cannot be applied.' };
    factor *= empowerFactor(definition); // Empower Flasks/Healing & Cures/Buff Potions.
    const amount = (Number(definition.amount) || 0) * factor; // Instant magnitude.
    if (definition.application === 'restoreHealth') entity.health = Math.min(window.ResourceSystem?.getEffectiveMax?.(entity, 'health') ?? entity.maxHealth, (Number(entity.health) || 0) + amount);
    else if (definition.application === 'restoreStamina') {
      if (entity.exhaustion?.active) { entity.exhaustion.blackStamina = Math.min(100, (Number(entity.exhaustion.blackStamina) || 0) + definition.exhaustionAmount * factor); if (entity.exhaustion.blackStamina >= 100) { entity.exhaustion.active = false; entity.stamina = window.ResourceSystem?.getEffectiveMax?.(entity, 'stamina') ?? entity.maxStamina; } }
      else entity.stamina = Math.min(window.ResourceSystem?.getEffectiveMax?.(entity, 'stamina') ?? entity.maxStamina, (Number(entity.stamina) || 0) + amount);
    } else if (definition.application === 'restoreFooting') entity.footing = Math.min(window.ResourceSystem?.getEffectiveMax?.(entity, 'footing') ?? entity.maxFooting, (Number(entity.footing) || 0) + amount);
    else if (definition.application === 'cleanseFamily') window.ResourceSystem?.removeAfflictionsByFamily?.(entity, definition.family, amount);
    else if (definition.application === 'cleanseTag') window.ResourceSystem?.removeAfflictionsByTag?.(entity, definition.tag, amount);
    else if (definition.application === 'affliction') window.ResourceSystem?.addAffliction?.(entity, definition.afflictionId, amount);
    else if (definition.application === 'buff') addTimedEffect(definition, factor, options.potencyTier || 0);
    else if (definition.application === 'narcotic') {
      addTimedEffect(definition, factor, options.potencyTier || 0);
      if (definition.drawback.type === 'footing') window.ResourceSystem?.spendFooting?.(entity, definition.drawback.amount * factor, definition.label);
      else window.ResourceSystem?.addAffliction?.(entity, definition.drawback.id, definition.drawback.amount * factor);
    } else return { ok: false, message: 'This recipe must be administered to livestock.' };
    window.ResourceSystem?.enforceCaps?.(entity);
    return { ok: true, message: `${definition.icon} ${definition.label} applied.`, recipeId, amount };
  }
  function consumeRawReagent(key, entity = playerEntity()) {
    const definition = REAGENT_DEFS[key]; // Raw stack identity.
    const native = nativeRecipeForReagent(key); // Native visible trio.
    if (!definition || !native || (deps?.inventory?.[key] || 0) < 1) return { ok: false, message: 'No reagent to eat.' };
    deps.inventory[key]--; deps.clampInventoryStack?.(key);
    const result = applyRecipeToEntity(native.id, RAW_POTENCY_FACTOR, entity, { raw: true, potencyTier: 0 }); // Harmful Afflict stays harmful.
    discoverRecipe(native.id, 'ate native reagent'); deps?.refreshItemScroll?.(); deps?.saveMemberWorldData?.();
    return { ...result, raw: true, potencyFactor: RAW_POTENCY_FACTOR, message: `${definition.icon} Ate ${definition.label}: a weak ${native.label} reaction.` };
  }
  function drinkPotion(itemKey, entity = playerEntity()) {
    const payload = POTION_ITEMS[itemKey] || parseBrewedItemKey(itemKey) || getPotionEffectsFromKey(itemKey); // Modern/legacy stack payload.
    if (!payload || (deps?.inventory?.[itemKey] || 0) < 1) return { ok: false, message: 'No potion to drink.' };
    if (payload.recipeId) {
      const definition = RECIPE_DEFS[payload.recipeId]; // Explicit use mode.
      if (definition.useMode !== 'drink') return { ok: false, message: definition.useMode === 'throw' ? 'That is a throwing flask.' : 'That must be administered to livestock.' };
      const result = applyRecipeToEntity(payload.recipeId, potencyMultiplier(payload.potencyTier), entity, { potencyTier: payload.potencyTier });
      if (!result.ok) return result;
      deps.inventory[itemKey]--; deps.clampInventoryStack?.(itemKey);
      return { ok: true, message: `${definition.icon} Drank ${definition.label}.`, recipeId: payload.recipeId };
    }
    deps.inventory[itemKey]--; deps.clampInventoryStack?.(itemKey); // Preserve legacy item rather than delete on migration.
    if (payload.legacyEffects?.includes('speed')) addTimedEffect({ id: `legacy-${itemKey}`, label: 'Legacy Speed', icon: '🏃', stat: 'movementSpeed', magnitude: 0.25, durationS: 60 }, 1, 0);
    return { ok: true, message: `🧪 Drank preserved legacy potion (${payload.legacyEffects?.join(', ') || 'unknown effect'}).` };
  }

  function statMagnitude(stat) { const now = performance.now() / 1000; return activeEffects.filter(effect => effect.expiresAt > now && (effect.stat === stat || effect.secondaryStat === stat)).reduce((sum, effect) => sum + effect.magnitude, 0); } // Central buff query.
  const getMovementSpeedMultiplier = () => 1 + statMagnitude('movementSpeed');
  const getSpeedMul = getMovementSpeedMultiplier;
  const getAttackSpeedMultiplier = () => 1 + statMagnitude('attackSpeed');
  const getOutgoingDamageMultiplier = () => 1 + statMagnitude('outgoingDamage');
  const getStaminaSpendMultiplier = () => Math.max(0.2, 1 - statMagnitude('staminaSpend'));
  const getHealthRegenMultiplier = () => 1 + statMagnitude('healthRegen');
  const getStaminaRegenMultiplier = () => 1 + statMagnitude('staminaRegen');
  const getMaxFootingMultiplier = () => 1 + statMagnitude('maxFooting');
  const getMaxStaminaMultiplier = () => 1 + statMagnitude('maxStamina');
  const getIncomingDamageAfflictionMultiplier = () => Math.max(0.15, 1 - statMagnitude('incomingDamageAffliction'));
  const getPositiveFavorMultiplier = () => 1 + statMagnitude('positiveFavor');
  const getPerceptionMultiplier = () => 1 + statMagnitude('perception');
  const getFootingDamageMultiplier = () => 1 + statMagnitude('footingDamage');
  function serializeActiveEffects() { const now = performance.now() / 1000; return activeEffects.map(effect => ({ recipeId: effect.recipeId, remainingS: effect.expiresAt - now, magnitude: effect.magnitude, potencyTier: effect.potencyTier || 0 })).filter(effect => effect.remainingS > 0); } // Save remaining time.
  function restoreActiveEffects(saved) {
    activeEffects = [];
    const now = performance.now() / 1000; // New page clock.
    const legacyMap = { strength:'potionOfStrength', speed:'potionOfSpeed', perception:'potionOfPerception', vigor:'potionOfVigor', fortitude:'potionOfPoise' }; // Honest legacy mappings.
    (saved || []).forEach(record => { const definition = RECIPE_DEFS[record.recipeId || record.key] || RECIPE_DEFS[legacyMap[record.key]]; if (!definition || !(record.remainingS > 0) || !['buff','narcotic'].includes(definition.application)) return; const tier = Math.max(0, Math.min(4, Number(record.potencyTier) || 0)); activeEffects.push({ recipeId: definition.id, key: definition.id, label: definition.label, icon: definition.icon, kind: 'boon', stat: definition.stat, secondaryStat: definition.secondaryStat, magnitude: Number(record.magnitude) || definition.magnitude * potencyMultiplier(tier), durationS: definition.durationS, expiresAt: now + record.remainingS, potencyTier: tier }); });
    window.EffectBuffBar?.refresh(true);
  }
  function contextSignature() {
    const entity = playerEntity(); // Thresholded to avoid DOM churn during per-frame regeneration.
    const totals = afflictionTotals(entity);
    const resourceBuckets = ['health','stamina','footing'].map(key => Math.floor((Number(entity?.[key]) || 0) / 5));
    const afflictionBuckets = [...Object.values(totals.families), ...Object.values(totals.tags)].map(value => Math.floor(value / 5));
    const inventoryState = ownedRecipeItems().map(entry => `${entry.itemKey}:${entry.count}`).sort();
    return JSON.stringify([resourceBuckets, afflictionBuckets, inventoryState, activeEffects.map(effect => effect.recipeId).sort(), !!deps?.getInCombat?.()]);
  }
  function update() {
    const now = performance.now() / 1000; // Shared active-effect clock.
    const before = activeEffects.length; // Used to refresh the shared buff bar only on expiry.
    activeEffects = activeEffects.filter(effect => effect.expiresAt > now);
    if (before !== activeEffects.length) window.EffectBuffBar?.refresh(true);
    const signature = contextSignature();
    if (signature !== lastContextSignature) {
      lastContextSignature = signature;
      document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail: { type: before !== activeEffects.length ? 'buff-expired' : 'context' } }));
    }
  }
  function ownedRecipeItems(filter = () => true) { return Object.keys(deps?.inventory || {}).map(itemKey => ({ itemKey, count: deps.inventory[itemKey] || 0, payload: POTION_ITEMS[itemKey] || parseBrewedItemKey(itemKey) })).filter(entry => entry.count > 0 && entry.payload?.recipeId && filter(RECIPE_DEFS[entry.payload.recipeId], entry)); } // Inventory query.
  function afflictionTotals(entity = playerEntity()) {
    const families = Object.fromEntries(FAMILY_ORDER.map(family => [family, window.ResourceSystem?.afflictionTotalByFamily?.(entity, family) || 0])); // Family totals.
    const tags = { toxin: window.ResourceSystem?.afflictionTotalByTag?.(entity, 'toxin') || 0, alcohol: window.ResourceSystem?.afflictionTotalByTag?.(entity, 'alcohol') || 0 }; // Independent tag totals.
    return { families, tags };
  }
  function restorativeScore(definition, entity = playerEntity()) {
    if (!definition || definition.useMode !== 'drink' || definition.traits.drive !== 'restore' || !entity) return 0;
    const totals = afflictionTotals(entity); // Overlap-aware state.
    if (definition.application === 'restoreHealth') { const missing = Math.max(0, entity.maxHealth - entity.health); return missing * (entity.health <= entity.maxHealth * .3 ? 2.2 : 1); }
    if (definition.application === 'restoreStamina') return Math.max(0, entity.maxStamina - entity.stamina) + (entity.exhaustion?.active ? 65 : 0);
    if (definition.application === 'restoreFooting') return Math.max(0, entity.maxFooting - entity.footing);
    if (definition.application === 'cleanseFamily') return totals.families[definition.family] || 0;
    if (definition.application === 'cleanseTag') return (totals.tags[definition.tag] || 0) * 1.15;
    return 0;
  }
  function contextualRestoratives(entity = playerEntity()) { return ownedRecipeItems(definition => definition.traits.drive === 'restore' && definition.useMode === 'drink').map(entry => ({ ...entry, recipe: RECIPE_DEFS[entry.payload.recipeId], score: restorativeScore(RECIPE_DEFS[entry.payload.recipeId], entity) })).filter(entry => entry.score > 0).sort((a,b) => b.score - a.score); }
  function cureCoverage(entity = playerEntity()) {
    const owned = ownedRecipeItems(definition => definition.traits.drive === 'restore'); // Coverage even when healthy.
    const totals = afflictionTotals(entity); // Current emphasis.
    return Object.fromEntries(FAMILY_ORDER.map(family => { const remedies = owned.filter(entry => { const definition = RECIPE_DEFS[entry.payload.recipeId]; return definition.family === family || (definition.tag && window.ResourceSystem?.afflictionIdsByFamily?.(family)?.some(id => window.ResourceSystem?.afflictionHasTag?.(id, definition.tag))); }); return [family, { owned: remedies.length > 0, activeAmount: totals.families[family] || 0, urgentMissing: (totals.families[family] || 0) > 0 && !remedies.length }]; }));
  }
  function potionCategoryState(entity = playerEntity()) {
    const missingHealth = Math.max(0, (entity?.maxHealth || 0) - (entity?.health || 0)); // Healing state.
    const healing = ownedRecipeItems(definition => definition.application === 'restoreHealth'); // Owned healing.
    const buffs = ownedRecipeItems(definition => definition.useMode === 'drink' && ['buff','narcotic'].includes(definition.application) && definition.traits.drive !== 'restore'); // Owned buffs.
    const usefulBuffs = buffs.filter(entry => !activeEffects.some(effect => effect.recipeId === entry.payload.recipeId)); // Inactive first.
    const flasks = ownedRecipeItems(definition => definition.useMode === 'throw'); // All owned flasks.
    const cures = contextualRestoratives(entity).filter(entry => ['cleanseFamily','cleanseTag'].includes(entry.recipe.application)); // Useful current cures.
    return { inCombat:!!deps?.getInCombat?.(), healing:{needed:missingHealth>0,owned:healing.length>0,usefulItems:missingHealth>0?healing:[],urgentMissing:missingHealth>0&&!healing.length}, cures:{needed:cures.length>0,usefulItems:cures,coverage:cureCoverage(entity)}, buffs:{owned:buffs.length>0,usefulItems:usefulBuffs,items:[...usefulBuffs,...buffs.filter(entry=>!usefulBuffs.includes(entry))]}, flasks:{owned:flasks.length>0,items:flasks}, recommendation:contextualRestoratives(entity)[0]||null };
  }

  function toggleReagent(key) { const index = selectedReagents.indexOf(key); if (index >= 0) selectedReagents.splice(index, 1); else if (selectedReagents.length < MAX_REAGENTS && (!selectedReagents.length || canAddReagent(selectedReagents, key))) selectedReagents.push(key); if (targetedRecipeId && !enumerateRecipes(selectedReagents).some(outcome => outcome.recipeId === targetedRecipeId)) targetedRecipeId = null; renderPanel(); } // Existing table selection.
  function renderPanel() {
    const list = document.getElementById('alchemyReagentList'); // Existing reagent list.
    const selectedHost = document.getElementById('alchemySelectedStrip'); // Existing selection strip.
    const preview = document.getElementById('alchemyEffectPreview'); // Existing reaction preview.
    if (!list) return;
    selectedReagents = selectedReagents.filter(key => (deps?.inventory?.[key] || 0) > 0);
    const held = Object.keys(REAGENT_DEFS).filter(key => (deps?.inventory?.[key] || 0) > 0); // Owned rows.
    list.innerHTML = '';
    held.forEach(key => { const definition = REAGENT_DEFS[key]; const selected = selectedReagents.includes(key); const compatible = selected || !selectedReagents.length || canAddReagent(selectedReagents, key); const row = document.createElement('div'); row.className = `shop-row alch-reagent-row${selected?' selected':''}${compatible?'':' incompatible'}`; row.innerHTML = `<div class="sh-icon">${definition.icon}</div><div class="sh-info"><div class="sh-name">${definition.label} <span class="alch-count">×${deps.inventory[key]}</span></div><div class="alch-effects"><span class="alch-effect humour">${definition.traits.humour}</span><span class="alch-effect drive">${definition.traits.drive}</span><span class="alch-effect magnetism">${definition.traits.magnetism}</span></div></div><button class="shop-buy-btn" data-act="toggle" ${compatible?'':'disabled'}>${selected?'Selected':compatible?'Select':'Incompatible'}</button>`; row.querySelector('[data-act="toggle"]')?.addEventListener('click', () => toggleReagent(key)); list.appendChild(row); });
    if (!held.length) list.innerHTML = '<div class="delivery-row"><span class="dr-icon">🌿</span><span class="dr-name">No reagents in your bag.</span></div>';
    if (selectedHost) selectedHost.innerHTML = selectedReagents.length ? selectedReagents.map(key => `<span class="alch-selected-chip">${REAGENT_DEFS[key].icon} ${REAGENT_DEFS[key].label}</span>`).join('') : '<span class="alch-empty-hint">Select 2–3 reagents.</span>';
    const outcomes = enumerateRecipes(selectedReagents); // Same exact brew results.
    if (preview) preview.innerHTML = selectedReagents.length < 2 ? '' : !outcomes.length ? '<div class="alch-empty-hint">No valid mixed-source reaction.</div>' : `<div class="alch-reaction-count">${outcomes.length} possible reaction${outcomes.length===1?'':'s'}</div>` + outcomes.map(outcome => discoveredRecipes.has(outcome.recipeId) ? `<button type="button" class="alch-target${targetedRecipeId===outcome.recipeId?' selected':''}" data-recipe="${outcome.recipeId}">${outcome.recipe.icon} ${outcome.recipe.label}<small>${outcome.recipe.traits.humour} · ${outcome.recipe.traits.drive} · ${outcome.recipe.traits.magnetism}</small></button>` : '<div class="alch-unknown-reaction">❓ Unknown reaction</div>').join('') + (targetedRecipeId ? `<div class="alch-target-chance">Target chance: ${Math.round(targetingProbability(alchemyLevel(), outcomes.length)*100)}%</div>` : '');
    preview?.querySelectorAll('[data-recipe]').forEach(button => button.addEventListener('click', () => setTargetRecipe(button.dataset.recipe === targetedRecipeId ? null : button.dataset.recipe)));
    const brewButton = document.getElementById('alchemyBrewBtn'); // Existing Brew control.
    if (brewButton) brewButton.disabled = !outcomes.length;
    const diagnostics = document.getElementById('alchemyDiagnostics'); // Mobile-visible dev area.
    if (diagnostics) diagnostics.textContent = diagnosticsText();
  }
  function diagnosticsSnapshot() {
    const outcomes = enumerateRecipes(selectedReagents); // Live exact assignments.
    const entity = playerEntity(); // Live player state.
    const skillSnapshot = window.SkillSystem?.snapshot?.(false); // Read-only Alchemy XP source for mobile-visible diagnostics.
    const selectedKey = deps?.getSelectedItemKey?.() || null; // Current held/selected item.
    const flaskPayload = parseBrewedItemKey(selectedKey); // Current alchemy payload.
    const flaskDefinition = flaskPayload && RECIPE_DEFS[flaskPayload.recipeId]; // Current flask recipe.
    return { alchemy:{level:alchemyLevel(),xp:skillSnapshot?.experience?.alchemy||0}, selectedReagents:selectedReagents.map(key=>({key,traits:REAGENT_DEFS[key]?.traits})), outcomes:outcomes.map(outcome=>({recipeId:outcome.recipeId,assignments:outcome.assignments})), everyIngredientContributes:outcomes.every(outcome=>outcome.assignments.every(a=>Object.values(a.contributes).every(list=>list.length))), targetedRecipeId, targetingProbability:targetedRecipeId?targetingProbability(alchemyLevel(),outcomes.length):null, discoveredRecipeCount:discoveredRecipes.size, activeEffects:serializeActiveEffects(), afflictions:afflictionTotals(entity), contextualRecommendation:contextualRestoratives(entity)[0]?.recipeId||null, selectedFlask:flaskDefinition?.useMode==='throw'?{recipeId:flaskDefinition.id,basePotency:flaskDefinition.amount,splashRadius:flaskDefinition.splashRadius}:null, projectile:window.AlchemyFlasks?.diagnostics?.()||null, lastBrew:lastBrewDiagnostics };
  }
  function diagnosticsText() { return JSON.stringify(diagnosticsSnapshot(), null, 2); }
  window._doBrewPotion = () => { const result = brew(); deps?.showToast?.(result.message, result.ok !== false); renderPanel(); if (result.ok) deps?.saveMemberWorldData?.(); };

  window.AlchemySystem = {
    TRAIT_CATEGORIES,HUMOURS,DRIVES,MAGNETISMS,ELEMENT_DURATION_S,RAW_POTENCY_FACTOR,POTENCY_TIER_MULTIPLIERS,DEFAULT_SPLASH_RADIUS_TILES,FAMILY_ORDER,
    RECIPE_DEFS,RECIPE_BY_TRAITS,REAGENT_DEFS,POTION_ITEMS,
    init,reagentsForZone,validateTraits,nativeRecipeForReagent,enumerateRecipes,canAddReagent,targetingProbability,potencyTierForLevel,potencyMultiplier,setTargetRecipe,chooseOutcome,
    brewFrom,brew,setCampfireBrewing,herbalistPrecisionFraction,batchCountFor,discoverRecipe,isRecipeKnown,discoveryCount,serializeKnownRecipes,restoreKnownRecipes,serializeKnownEffects,restoreKnownEffects,
    itemKeyForRecipe,parseBrewedItemKey,ensureRecipeItemDef,recipeScrollKey,ensureRecipeScrollItemDef,readRecipeItem,ensurePotionItemDef,getPotionEffectsFromKey,migrateLegacyPotionInventory,consumeRawReagent,drinkPotion,consumeBrewedItem:drinkPotion,applyRecipeToEntity,
    serializeActiveEffects,restoreActiveEffects,update,getActiveStatMagnitude:statMagnitude,getMovementSpeedMultiplier,getSpeedMul,getAttackSpeedMultiplier,getOutgoingDamageMultiplier,getStaminaSpendMultiplier,getHealthRegenMultiplier,getStaminaRegenMultiplier,getMaxFootingMultiplier,getMaxStaminaMultiplier,getIncomingDamageAfflictionMultiplier,getPositiveFavorMultiplier,getPerceptionMultiplier,getFootingDamageMultiplier,
    afflictionTotals,restorativeScore,contextualRestoratives,cureCoverage,potionCategoryState,toggleReagent,renderPanel,diagnosticsSnapshot,diagnosticsText,
    get selectedReagents(){return [...selectedReagents];}, get targetedRecipeId(){return targetedRecipeId;}, get activeEffects(){return activeEffects.map(effect=>({...effect}));},
  };
})();
