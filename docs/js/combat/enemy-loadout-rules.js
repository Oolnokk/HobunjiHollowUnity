// Shared, opt-in spawn authoring. An empty rules file preserves every existing generator.
(() => {
  'use strict';
  const SCHEMA = 'hobunji_enemy_loadouts.v1';
  const self =
    document.currentScript?.src ||
    new URL('js/combat/enemy-loadout-rules.js', document.baseURI).href;
  const configUrl = new URL('../../config/combat/enemy-loadouts.json', self)
    .href;
  let documentData = { schema: SCHEMA, rules: {} };
  let error = null;
  const attackChoices = Object.freeze({
    tap1: ['none', 'swingCombo', 'pokeCombo'],
    tap2: ['none', 'exhaustCutter', 'backstabFlick', 'mercySpike'],
    hold1: ['none', 'chargedBreaker'],
    hold2: ['none', 'counterShield'],
  });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const unsafe = (key) =>
    ['__proto__', 'prototype', 'constructor'].includes(key);
  function weights(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error(`${label}: expected weighted choices`);
    const entries = Object.entries(value);
    if (!entries.length || !entries.some(([, n]) => Number(n) > 0))
      throw Error(`${label}: at least one weight must be positive`);
    for (const [key, n] of entries)
      if (
        unsafe(key) ||
        !key.trim() ||
        typeof n !== 'number' ||
        !Number.isFinite(n) ||
        n < 0 ||
        n > 1000000
      )
        throw Error(`${label}: invalid choice or weight`);
  }
  function validate(data) {
    if (
      data?.schema !== SCHEMA ||
      !data.rules ||
      typeof data.rules !== 'object' ||
      Array.isArray(data.rules)
    )
      throw Error('Expected a hobunji_enemy_loadouts.v1 rules file');
    for (const [kind, rule] of Object.entries(data.rules)) {
      if (
        unsafe(kind) ||
        !rule ||
        typeof rule !== 'object' ||
        Array.isArray(rule)
      )
        throw Error('Invalid enemy rule');
      if (rule.enabled != null && typeof rule.enabled !== 'boolean')
        throw Error('Enemy rule enabled must be true/false');
      for (const [ability, allowed] of Object.entries(
        rule.specialAttacks || {},
      ))
        if (
          !['primary', 'summon'].includes(ability) ||
          typeof allowed !== 'boolean'
        )
          throw Error('Invalid special attack toggle');
      for (const key of [
        'species',
        'genders',
        'weapons',
        'metals',
        'ranged',
        'flasks',
      ])
        if (rule[key] != null) weights(rule[key], `${kind}.${key}`);
      if (
        rule.flaskCount != null &&
        (!Number.isInteger(rule.flaskCount) ||
          rule.flaskCount < 1 ||
          rule.flaskCount > 12)
      )
        throw Error('Flask loadout size must be an integer from 1 to 12');
      if (
        rule.genders &&
        Object.keys(rule.genders).some((k) => !['male', 'female'].includes(k))
      )
        throw Error('Gender choices must be male/female');
      if (
        rule.rangedChance != null &&
        (!Number.isFinite(rule.rangedChance) ||
          rule.rangedChance < 0 ||
          rule.rangedChance > 1)
      )
        throw Error('Ranged chance must be between 0 and 1');
      for (const [slot, value] of Object.entries(rule.clothing || {})) {
        if (!['hat', 'hood', 'torso', 'overwear', 'pants'].includes(slot))
          throw Error('Unknown clothing slot: ' + slot);
        if (
          !Number.isFinite(value.chance) ||
          value.chance < 0 ||
          value.chance > 1
        )
          throw Error('Clothing chance must be between 0 and 1');
        weights(value.items, `${kind}.clothing.${slot}`);
      }
      for (const group of ['appearance', 'dyes', 'attacks'])
        for (const [slot, value] of Object.entries(rule[group] || {})) {
          if (unsafe(slot)) throw Error('Invalid slot');
          weights(value, `${kind}.${group}.${slot}`);
          if (
            group === 'attacks' &&
            (!attackChoices[slot] ||
              Object.keys(value).some(
                (id) => !attackChoices[slot].includes(id),
              ))
          )
            throw Error('Unsupported ability for attack slot ' + slot);
          if (
            group === 'dyes' &&
            Object.keys(value).some(
              (id) => id.startsWith('#') && !/^#[0-9a-f]{6}$/i.test(id),
            )
          )
            throw Error('Expected a #RRGGBB color');
        }
    }
    return clone(data);
  }
  function set(data) {
    documentData = validate(data);
    error = null;
    return snapshot();
  }
  function snapshot() {
    return clone(documentData);
  }
  function pick(pool, random = Math.random) {
    const entries = Object.entries(pool || {}).filter(([, w]) => Number(w) > 0);
    const total = entries.reduce((n, [, w]) => n + Number(w), 0);
    if (!total) return null;
    let cursor = random() * total;
    for (const [id, w] of entries) {
      cursor -= Number(w);
      if (cursor < 0) return id === 'none' ? null : id;
    }
    const id = entries.at(-1)[0];
    return id === 'none' ? null : id;
  }
  function kindFor(rank, opts = {}, roster, config = {}) {
    if (opts.enemyLoadoutKind || opts.extra?.enemyLoadoutKind)
      return opts.enemyLoadoutKind || opts.extra.enemyLoadoutKind;
    const extra = opts.extra || {};
    if (extra.maskboundTroop) return 'maskbound:' + extra.maskboundTroop;
    if (extra.lichType || roster?.lichType)
      return 'lich:' + (extra.lichType || roster.lichType);
    if (extra.tribeId)
      return (
        extra.tribeId + ':' + (extra.isTribeAvenger ? 'avenger' : 'hunter')
      );
    const configuredSpecies = Object.entries(config.speciesWeights || {})
      .filter(([, weight]) => Number(weight) > 0)
      .map(([id]) => id);
    const species =
      roster?.appearance?.speciesId ||
      (configuredSpecies.length === 1 ? configuredSpecies[0] : null);
    if (
      [
        'mao-ao-skeleton',
        'harlyao-skeleton',
        'ghoul',
        'ghost-marcher',
      ].includes(species)
    )
      return species;
    return 'bandit:' + rank;
  }
  const ruleFor = (kind) =>
    documentData.rules[kind]?.enabled === false
      ? {}
      : documentData.rules[kind] || {};
  function configFor(kind, config, rank, random) {
    const rule = ruleFor(kind);
    if (!Object.keys(rule).length) return config;
    const out = { ...config };
    if (rule.species) {
      out._enemyLoadoutSpecies = pick(rule.species, random);
      out.speciesWeights = { [out._enemyLoadoutSpecies]: 1 };
    }
    if (rule.genders) out._enemyLoadoutGender = pick(rule.genders, random);
    if (rule.weapons) out.weaponShapePool = [pick(rule.weapons, random)];
    if (rule.metals) out.weaponMetalKey = pick(rule.metals, random);
    if (rule.flasks || rule.flaskCount != null)
      out.flasker = {
        ...config.flasker,
        ...(rule.flasks ? { recipeWeights: { ...rule.flasks } } : {}),
        ...(rule.flaskCount != null ? { loadoutSize: rule.flaskCount } : {}),
      };
    if (rule.ranged)
      out.rangedWeaponWeightsByRank = {
        ...config.rangedWeaponWeightsByRank,
        [rank]: { ...rule.ranged },
      };
    if (rule.rangedChance != null)
      out.rangedWeaponChanceByRank = {
        ...config.rangedWeaponChanceByRank,
        [rank]: rule.rangedChance,
      };
    return out;
  }
  function applyRoster(kind, source, random, config = {}) {
    const rule = ruleFor(kind);
    if (!Object.keys(rule).length) return source;
    const roster = clone(source);
    roster.appearance ||= {};
    roster.appearance.cosmetics ||= {};
    if (rule.species)
      roster.appearance.speciesId =
        config._enemyLoadoutSpecies || pick(rule.species, random);
    if (rule.genders)
      roster.appearance.gender =
        config._enemyLoadoutGender || pick(rule.genders, random);
    const supported =
      window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.[
        roster.appearance.speciesId
      ]?.genders;
    if (supported?.length && !supported.includes(roster.appearance.gender))
      roster.appearance.gender = supported[0];
    roster.equippedCosmetics ||= [];
    roster.cosmeticSlots ||= {};
    roster.appliedDyes ||= {};
    for (const [slot, value] of Object.entries(rule.clothing || {})) {
      if (roster.metalArmorItems)
        roster.metalArmorItems = roster.metalArmorItems.filter(
          (item) => item.slot !== slot,
        );
      roster.equippedCosmetics = roster.equippedCosmetics.filter(
        (id) => roster.cosmeticSlots[id] !== slot,
      );
      for (const [id, oldSlot] of Object.entries(roster.cosmeticSlots))
        if (oldSlot === slot) delete roster.cosmeticSlots[id];
      const id = random() < value.chance ? pick(value.items, random) : null;
      if (id) {
        roster.equippedCosmetics.push(id);
        roster.cosmeticSlots[id] = slot;
      }
    }
    if (rule.clothing?.pants) roster.enemyLoadoutAuthoredPants = true;
    for (const [slot, pool] of Object.entries(rule.appearance || {}))
      roster.appearance.cosmetics[slot] = pick(pool, random) || 'none';
    for (const [slot, pool] of Object.entries(rule.dyes || {})) {
      const id = pick(pool, random);
      if (id?.startsWith('#')) {
        roster.appearance.bodyColors ||= {};
        roster.appearance.bodyColors[slot] = {
          hex: id,
          tintMode: 'hexShadeFill',
        };
        delete roster.appliedDyes[slot];
      } else if (id) roster.appliedDyes[slot] = id;
    }
    roster.enemyLoadoutKind = kind;
    return roster;
  }
  function applyDefinition(kind, source, random) {
    const attacks = ruleFor(kind).attacks;
    if (!attacks) return source;
    const out = {
      ...source,
      banditAbilityLoadout: { ...source.banditAbilityLoadout },
    };
    for (const [slot, pool] of Object.entries(attacks))
      out.banditAbilityLoadout[slot] = pick(pool, random);
    return out;
  }
  function seedRandom(value) {
    let n = 2166136261;
    for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
    return () => {
      n += 0x6d2b79f5;
      let t = Math.imul(n ^ (n >>> 15), 1 | n);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ready = fetch(configUrl)
    .then((r) => {
      if (!r.ok) throw Error('Enemy loadout rules HTTP ' + r.status);
      return r.json();
    })
    .then(set)
    .catch((e) => {
      error = e.message;
      console.warn('[enemy loadouts]', error);
    });
  window.EnemyLoadoutRules = Object.freeze({
    schema: SCHEMA,
    attackChoices,
    ready,
    set,
    snapshot,
    validate,
    pick,
    kindFor,
    configFor,
    applyRoster,
    applyDefinition,
    seedRandom,
    ruleFor,
    status: () => ({ error }),
  });
})();
