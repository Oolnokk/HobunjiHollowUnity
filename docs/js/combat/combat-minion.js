// Minion humanoid enemy class.
//
// Minions share BanditCombat's humanoid combat/render/death executor, but
// deliberately own roster, clothing, dye, and permanent-affliction rules so
// bandit headwear guarantees and loadout substitutions cannot leak in.
(() => {
  'use strict';

  const CLASS_ID = 'minion'; // Semantic enemyClass written onto every Minion entity.
  const DEFAULT_WEAPON_SHAPES = Object.freeze(['daggerSword', 'fishingspear', 'hatchet', 'harlyaoLongsword', 'harlyaoBroadsword', 'warhammer']); // Default Harlyao Skeleton Minion melee pool.
  const OVERWEAR_OPTIONS = Object.freeze([null, 'tankan_bodywrap', 'rugged_poncho']); // Equal-choice upper-body pool; pants are supplied by the shared hostile avatar builder.
  const BANDOLIER_CHANCE = 0.5; // Independent torso roll creates six common silhouettes with the three overwear states.
  const HARLYAO_ARMOR_METAL_KEYS = Object.freeze(['nativeCopper', 'lowTinBronze', 'tinBronze', 'highTinBronze', 'arsenicalBronze', 'leadedBronze']); // Ordered smith alloys used to map Town Value onto skeleton armor quality.
  const SHAMBLING_FOOTING_FRACTION = 0.70; // Permanent Footing reservation applied after ResourceSystem initializes the entity; only the remaining 30% is ordinarily usable.
  const DYE_WEIGHTS = Object.freeze({ // Mostly low-saturation warm peasant/workwear hues with a smaller neutral tail.
    'dye:CLOTH:muted_red_orange': 4,
    'dye:CLOTH:dusty_red_orange': 4,
    'dye:CLOTH:dark_muted_red_orange': 3,
    'dye:CLOTH:muted_orange': 5,
    'dye:CLOTH:dusty_orange': 5,
    'dye:CLOTH:dark_muted_orange': 4,
    'dye:CLOTH:muted_yellow_orange': 4,
    'dye:CLOTH:dusty_yellow_orange': 4,
    'dye:CLOTH:dark_muted_yellow_orange': 3,
    'dye:CLOTH:muted_yellow': 3,
    'dye:CLOTH:dusty_yellow': 3,
    'dye:CLOTH:dark_muted_yellow': 2,
    'dye:CLOTH:brown': 2,
    'dye:CLOTH:charcoal': 1.5,
    'dye:CLOTH:silver': 1.5,
  });

  const rng = () => window.GameRandom?.random?.() ?? Math.random(); // Gameplay RNG when available keeps spawn sequences deterministic-capable.

  function weightedPick(weights = DYE_WEIGHTS) {
    const entries = Object.entries(weights).filter(([, weight]) => Number(weight) > 0); // Eligible palette entries.
    const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0); // Total used to map one RNG sample into the weighted palette.
    let roll = rng() * total; // Remaining weighted distance consumed in declaration order.
    for (const [id, weight] of entries) {
      roll -= Number(weight);
      if (roll <= 0) return id;
    }
    return entries[entries.length - 1]?.[0] || null;
  }

  function harlyaoArmorMetalKey() {
    const townValue = Math.max(0, Math.floor(Number(window.TownMine?.getTownValue?.()) || 0)); // Current town progression selects the strongest skeleton armor alloy available.
    const eligible = window.TownMine?.filterMetalKeysForTownValue?.(HARLYAO_ARMOR_METAL_KEYS, townValue); // Reuses the canonical Town Value metal ceiling used by treasure and other progression systems.
    return Array.isArray(eligible) && eligible.length ? eligible[eligible.length - 1] : HARLYAO_ARMOR_METAL_KEYS[0];
  }

  function rollRoster(speciesId, name = 'Minion', options = {}) {
    const genders = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.[speciesId]?.genders; // Species bridge registers the authored genders (Mao'ao Skeleton is male-only).
    const gender = options.gender || (Array.isArray(genders) && genders.length === 1 ? genders[0] : (rng() < 0.5 ? 'male' : 'female')); // Ghost marchers retain their authored male body while sharing skeleton equipment.
    const equippedCosmetics = []; // Explicit list bypasses BanditCombat's hood/facewrap/headband guarantee.
    const cosmeticSlots = {}; // Needed by portrait rendering, loot conversion, and outfit-weight profiling.
    const appliedDyes = {}; // Tint-slot keyed map consumed by NpcAvatarPreview.
    const overwear = OVERWEAR_OPTIONS[Math.floor(rng() * OVERWEAR_OPTIONS.length)] || null; // None/bodywrap/poncho are equally common.
    if (overwear) {
      equippedCosmetics.push(overwear);
      cosmeticSlots[overwear] = 'overwear';
      appliedDyes.CLOTH = weightedPick();
    }
    if (rng() < BANDOLIER_CHANCE) {
      equippedCosmetics.push('bandolier1');
      cosmeticSlots.bandolier1 = 'torso';
      appliedDyes.TORSO = weightedPick();
    }
    const metalArmorItems = []; // These same maximum-temper records feed the portrait and corpse loot.
    if ((options.equipmentSpeciesId || speciesId) === 'harlyao-skeleton') {
      const metalKey = harlyaoArmorMetalKey(); // Both articles share the town-scaled alloy so a skeleton's armor reads as one coherent set.
      for (const id of ['rounded_pauldron', 'tangedcirclet']) {
        const item = window.MetalArmorSystem?.makeCraftedItem?.(id, metalKey); // Shared smith article factory supplies weight and alloy metadata.
        if (!item) throw new Error('MetalArmorSystem must load before skeleton equipment is generated.');
        item.temperXp = window.MetalArmorSystem.MAX_TEMPER_XP;
        item.sprite = window.MetalArmorSystem.spriteForBlueprintAppearance(id, { speciesId, gender });
        metalArmorItems.push(item);
        equippedCosmetics.push(id);
        cosmeticSlots[id] = item.slot;
      }
    }
    return { name, appearance: { speciesId, gender, cosmetics: {} }, equippedCosmetics, appliedDyes, cosmeticSlots, metalArmorItems };
  }

  async function makeEntity(options = {}) {
    const combat = window.BanditCombat; // Shared humanoid combat implementation beneath the distinct Minion category.
    const resources = window.ResourceSystem; // Owns immutable Shambling Footing and effective Footing.
    if (!combat?.makeEntity || !resources?.setImmutableAffliction) return null;
    const baseConfig = options.baseConfig || await combat.loadGangConfig?.(); // Reuses generic rank/stat tuning but not bandit roster generation.
    if (!baseConfig) return null;

    const speciesId = options.speciesId || 'harlyao-skeleton'; // Caller override keeps Minion reusable for future species.
    const name = options.name || 'Minion'; // Display/roster name.
    const tier = Math.max(0, Math.round(Number(options.tier) || 0)); // Existing humanoid difficulty tier.
    const weaponShapes = Array.isArray(options.weaponShapePool) && options.weaponShapePool.length ? options.weaponShapePool : DEFAULT_WEAPON_SHAPES; // Validated again by BanditCombat.
    const roster = options.roster || rollRoster(speciesId, name); // Separation point: bandit clothing generation never runs. A supplied roster re-creates a specific skeleton (a lich raising its fallen).
    const entity = await combat.makeEntity({
      ...baseConfig,
      speciesWeights: { [speciesId]: 1 },
      weaponShapePool: [...weaponShapes],
      weaponMetalKey: options.weaponMetalKey || 'nativeCopper',
      rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
    }, 'grunt', tier, Number(options.x) || 0, Number(options.y) || 0, {
      zoneId: options.zoneId,
      scene: options.scene,
      grid: options.grid,
      cols: options.cols,
      rows: options.rows,
      rosterOverride: roster,
      enemyClass: options.enemyClass || CLASS_ID,
      avatarRigScale: options.avatarRigScale || null, // Caller-authored puppet proportions travel through BanditCombat before collision sizes are computed.
      defOverride: { ...(options.defOverride || {}), rangedWeaponKey: null },
      extra: { ...(options.extra || {}), enemyClass: options.enemyClass || CLASS_ID, isMinion: true },
    });
    if (!entity) return null;

    const shamblingFraction = Number.isFinite(Number(options.shamblingFootingFraction)) ? Math.max(0, Math.min(1, Number(options.shamblingFootingFraction))) : SHAMBLING_FOOTING_FRACTION; // Custom puppet troops bypass Minion's Harlyao-only shamble.
    const shamblingAmount = (Number(entity.maxFooting) || 0) * shamblingFraction; // Reserve permanent footing only when the troop requests it.
    if (shamblingAmount > 0) resources.setImmutableAffliction(entity, 'shamblingFooting', shamblingAmount);
    resources.enforceCaps?.(entity); // Respect a canonical per-entity resource cap after any immutable affliction.
    entity.shamblingFootingFraction = shamblingFraction; // Mobile/debug-readable troop value.
    return entity;
  }

  window.MinionCombat = Object.freeze({
    classId: CLASS_ID,
    defaultWeaponShapes: DEFAULT_WEAPON_SHAPES,
    overwearOptions: OVERWEAR_OPTIONS,
    bandolierChance: BANDOLIER_CHANCE,
    harlyaoArmorMetalKeys: HARLYAO_ARMOR_METAL_KEYS,
    harlyaoArmorMetalKey,
    shamblingFootingFraction: SHAMBLING_FOOTING_FRACTION,
    dyeWeights: DYE_WEIGHTS,
    rollRoster,
    makeEntity,
  });
})();
