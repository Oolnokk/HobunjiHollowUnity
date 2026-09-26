// Minion humanoid enemy class.
//
// Minions share BanditCombat's humanoid combat/render/death executor, but
// deliberately own roster, clothing, dye, and permanent-affliction rules so
// bandit headwear guarantees and loadout substitutions cannot leak in.
(() => {
  'use strict';

  const CLASS_ID = 'minion'; // Semantic enemyClass written onto every Minion entity.
  const DEFAULT_WEAPON_SHAPES = Object.freeze(['daggerSword', 'fishingspear', 'hatchet']); // Default Harlyao Skeleton Minion melee pool.
  const OVERWEAR_OPTIONS = Object.freeze([null, 'tankan_bodywrap', 'rugged_poncho']); // Equal-choice overwear pool; null intentionally allows unclothed skeletons.
  const BANDOLIER_CHANCE = 0.5; // Independent torso roll creates six common silhouettes with the three overwear states.
  const SHAMBLING_FOOTING_FRACTION = 0.30; // Permanent Footing reservation applied after ResourceSystem initializes the entity.
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

  function rollRoster(speciesId, name = 'Minion') {
    const gender = rng() < 0.5 ? 'male' : 'female'; // Current skeleton art authors both genders.
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
    return { name, appearance: { speciesId, gender, cosmetics: {} }, equippedCosmetics, appliedDyes, cosmeticSlots };
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
    const roster = rollRoster(speciesId, name); // Separation point: bandit clothing generation never runs.
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
      enemyClass: CLASS_ID,
      defOverride: { ...(options.defOverride || {}), rangedWeaponKey: null },
      extra: { ...(options.extra || {}), enemyClass: CLASS_ID, isMinion: true },
    });
    if (!entity) return null;

    const shamblingAmount = (Number(entity.maxFooting) || 0) * SHAMBLING_FOOTING_FRACTION; // Exactly 30% of this Minion's spawned Footing.
    resources.setImmutableAffliction(entity, 'shamblingFooting', shamblingAmount);
    resources.enforceCaps?.(entity); // Initial full Footing immediately clamps to its 70% usable ceiling.
    entity.shamblingFootingFraction = SHAMBLING_FOOTING_FRACTION; // Debug/readability marker for future Minion diagnostics.
    return entity;
  }

  window.MinionCombat = Object.freeze({
    classId: CLASS_ID,
    defaultWeaponShapes: DEFAULT_WEAPON_SHAPES,
    overwearOptions: OVERWEAR_OPTIONS,
    bandolierChance: BANDOLIER_CHANCE,
    shamblingFootingFraction: SHAMBLING_FOOTING_FRACTION,
    dyeWeights: DYE_WEIGHTS,
    rollRoster,
    makeEntity,
  });
})();
