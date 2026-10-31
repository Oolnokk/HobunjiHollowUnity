// Per-weapon-shape melee balance, independent of metal reinforcement and mastery.
(function (global) {
  'use strict';
  const DEFAULT = Object.freeze({ power: 1, speed: 1, range: 1, efficiency: 1 }); // Neutral fallback for unregistered and unequipped shapes.
  const SHAPES = Object.freeze({
    workhammer: { power: 1.25, speed: 0.90, range: 0.90, efficiency: 0.90 },
    hatchet: { power: 1.00, speed: 1.00, range: 1.00, efficiency: 1.00 },
    hoe: { power: 0.80, speed: 1.05, range: 0.90, efficiency: 1.15 }, // Farm-tool donor; available as a Foundry head/shaft despite its non-weapon standalone slot.
    fishingmace: { power: 1.05, speed: 0.95, range: 1.00, efficiency: 0.95 },
    fishingspear: { power: 0.90, speed: 1.15, range: 1.30, efficiency: 1.05 },
    pickshovel: { power: 1.10, speed: 0.85, range: 0.85, efficiency: 0.85 },
    warhammer: { power: 1.50, speed: 0.75, range: 1.00, efficiency: 0.80 },
    porakanekiGreatclub: { power: 1.60, speed: 0.65, range: 1.25, efficiency: 0.70 }, // Heavy head donor meaningfully alters the selected shaft's stats.
    harlyaoLongsword: { power: 1.10, speed: 1.05, range: 1.20, efficiency: 1.00 },
    harlyaoBroadsword: { power: 1.25, speed: 0.90, range: 1.15, efficiency: 0.90 },
    bshuakauitl: { power: 0.50, speed: 1.75, range: 1.25, efficiency: 1.20 },
    hachutuTorchStaff: { power: 0.50, speed: 1.75, range: 1.25, efficiency: 1.20 }, // Identical initial melee timings and reach to B'shuakauitl; no blowgun ranged role.
    bgungku: { power: 1.00, speed: 1.00, range: 1.00, efficiency: 1.00 }, // Editor-only unmapped donor remains explicitly neutral until assigned a gameplay shape.
    daggerSword: { power: 0.75, speed: 1.40, range: 0.80, efficiency: 1.20 },
    plainsSword: { power: 1.30, speed: 0.85, range: 1.20, efficiency: 0.85 },
    dagger: { power: 0.50, speed: 2.00, range: 0.25, efficiency: 1.40 },
    kylie: { power: 0.85, speed: 1.15, range: 1.15, efficiency: 1.05 },
    warCleaver: { power: 1.20, speed: 0.85, range: 1.00, efficiency: 0.90 },
  }); // Authoritative shape stats used by player combos, quick attacks, charged attacks and Foundry weapons.
  const HEAD_INFLUENCE = 0.5; // Foundry: half of each head multiplier's deviation from neutral modifies the shaft baseline.
  const finitePositive = (value, fallback = 1) => Number.isFinite(value) && value > 0 ? value : fallback;
  function forShape(shape) {
    return SHAPES[shape] || DEFAULT;
  }
  function forKey(key, definition) {
    const modular = global.ModularWeapons?.decode?.(key); // Preserve shaft identity even when a Foundry head changes the damage type.
    if (modular) {
      const config = global.ModularWeapons.getConfig();
      const shaft = forShape(config.shafts[modular.shaft]?.sourceShape);
      const head = forShape(config.heads[modular.head]?.sourceShape);
      const result = {};
      for (const stat of Object.keys(DEFAULT)) {
        result[stat] = finitePositive(shaft[stat] * (1 + HEAD_INFLUENCE * (head[stat] - 1)));
      }
      return result;
    }
    const shape = definition?.shapeKey || (/^bound:harlyao:/.test(String(key || '')) ? definition?.sourceShape : null)
      || String(key || '').replace(/_(nativeCopper|lowTinBronze|tinBronze|highTinBronze|arsenicalBronze|leadedBronze)$/, '');
    return forShape(shape);
  }
  function current() {
    const deps = global.Combat?.deps;
    const key = deps?.currentWeaponKey?.();
    return forKey(key, deps?.getWeaponDefinition?.(key));
  }
  function duration(seconds, stats = current()) {
    return Math.max(0, Number(seconds) || 0) / finitePositive(stats.speed);
  }
  function stamina(cost, stats = current()) {
    return Math.max(0, Number(cost) || 0) / finitePositive(stats.efficiency);
  }
  function geometry(rangePx, halfConeRad, stats = current()) {
    return { rangePx: rangePx * stats.range, halfConeRad: Math.min(Math.PI, halfConeRad * stats.range) };
  }
  function applyPower(context) {
    if (!context || context.attacker !== global.Combat?.deps?.player) return context; // Hostile attacks are handled by their own combat executor.
    const stats = forKey(context.weaponKey, global.Combat?.deps?.getWeaponDefinition?.(context.weaponKey));
    for (const field of ['damage', 'affliction', 'knockback', 'footingDamage']) {
      context.modifiers[field] = (Number(context.modifiers[field]) || 1) * stats.power;
    }
    return context;
  }
  global.WeaponShapeStats = Object.freeze({
    SHAPES, DEFAULT, HEAD_INFLUENCE, forShape, forKey, current, duration, stamina, geometry, applyPower,
    snapshot: () => ({ weapon: global.Combat?.deps?.currentWeaponKey?.() || null, ...current() }),
  }); // Mobile-friendly inspectable current-weapon diagnostic.
})(window);
