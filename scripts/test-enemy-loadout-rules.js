'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const read = (p) => fs.readFileSync(p, 'utf8');
(async () => {
  const window = {
    SCRATCHBONES_CONFIG: {
      game: {
        appearanceEditor: {
          species: { 'mao-ao-skeleton': { genders: ['male'] } },
        },
      },
    },
  };
  vm.runInNewContext(read('docs/js/combat/enemy-loadout-rules.js'), {
    window,
    document: {
      currentScript: {
        src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js',
      },
      baseURI: 'https://game.test/docs/',
    },
    URL,
    fetch: async () => ({
      ok: true,
      json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }),
    }),
    console,
  });
  const api = window.EnemyLoadoutRules;
  await api.ready;
  const originalConfig = {
    speciesWeights: { 'mao-ao': 1 },
    clothingPool: { slots: ['hood'] },
  };
  const originalRoster = {
    appearance: { speciesId: 'mao-ao', gender: 'female', cosmetics: {} },
    equippedCosmetics: ['hat', 'hood'],
    cosmeticSlots: { hat: 'hat', hood: 'hood' },
    appliedDyes: { HOOD: 'old' },
    metalArmorItems: [{ slot: 'hood' }, { slot: 'torso' }],
  };
  let randomCalls = 0;
  const never = () => {
    randomCalls++;
    return 0.4;
  };
  assert.strictEqual(
    api.configFor('bandit:grunt', originalConfig, 'grunt', never),
    originalConfig,
  );
  assert.strictEqual(
    api.applyRoster('bandit:grunt', originalRoster, never),
    originalRoster,
  );
  assert.equal(
    randomCalls,
    0,
    'empty shipped rules preserve baseline RNG and object identities',
  );
  const classifications = [
    ['bandit:flasker', 'flasker', {}, null],
    [
      'maskbound:reacher',
      'grunt',
      { extra: { maskboundTroop: 'reacher' } },
      null,
    ],
    ['lich:hronal', 'lieutenant', { extra: { lichType: 'hronal' } }, null],
    [
      'porakaneki:avenger',
      'grunt',
      { extra: { tribeId: 'porakaneki', isTribeAvenger: true } },
      null,
    ],
    ['omgurku:hunter', 'grunt', { extra: { tribeId: 'omgurku' } }, null],
    [
      'harlyao-skeleton',
      'grunt',
      {},
      { appearance: { speciesId: 'harlyao-skeleton' } },
    ],
  ];
  for (const [kind, rank, opts, roster] of classifications)
    assert.equal(api.kindFor(rank, opts, roster), kind);
  assert.equal(
    api.kindFor('grunt', {}, null, { speciesWeights: { ghoul: 1 } }),
    'ghoul',
    'mine ghoul rules apply without an explicit roster override',
  );
  const seeded1 = api.seedRandom('one'),
    seeded2 = api.seedRandom('one');
  for (let i = 0; i < 30; i++) assert.equal(seeded1(), seeded2());
  const rule = {
    species: { 'mao-ao-skeleton': 1 },
    genders: { female: 1 },
    weapons: { hatchet: 0, fishingspear: 1 },
    metals: { tinBronze: 1 },
    ranged: { scatterbow: 1 },
    rangedChance: 1,
    clothing: {
      hood: { chance: 1, items: { hachutu_binding_mask_ii: 1 } },
      pants: { chance: 0, items: { none: 1 } },
    },
    appearance: { eyes: { none: 1 } },
    dyes: { HOOD_C: { '#12aacc': 1 } },
    attacks: { tap1: { pokeCombo: 1 }, hold2: { none: 1 } },
  };
  api.set({ schema: api.schema, rules: { 'bandit:grunt': rule } });
  const cfg = api.configFor('bandit:grunt', originalConfig, 'grunt', () => 0.4);
  assert.equal(cfg.weaponShapePool[0], 'fishingspear');
  assert.equal(cfg.weaponMetalKey, 'tinBronze');
  assert.equal(cfg.rangedWeaponChanceByRank.grunt, 1);
  const roster = api.applyRoster(
    'bandit:grunt',
    originalRoster,
    () => 0.4,
    cfg,
  );
  assert.equal(roster.appearance.speciesId, 'mao-ao-skeleton');
  assert.equal(
    roster.appearance.gender,
    'male',
    'one-gender anatomy is respected',
  );
  assert(roster.equippedCosmetics.includes('hachutu_binding_mask_ii'));
  assert(!roster.equippedCosmetics.includes('hood'));
  assert(roster.equippedCosmetics.includes('hat'));
  assert.equal(roster.metalArmorItems.length, 1);
  assert.equal(roster.metalArmorItems[0].slot, 'torso');
  assert(roster.enemyLoadoutAuthoredPants);
  assert.equal(roster.appearance.bodyColors.HOOD_C.hex, '#12aacc');
  assert.equal(roster.appearance.cosmetics.eyes, 'none');
  assert.equal(originalRoster.appearance.speciesId, 'mao-ao');
  assert.deepEqual(originalRoster.equippedCosmetics, ['hat', 'hood']);
  const def = {
    banditAbilityLoadout: {
      tap1: 'swingCombo',
      tap2: 'mercySpike',
      hold2: 'counterShield',
    },
  };
  const next = api.applyDefinition('bandit:grunt', def, () => 0.5);
  assert.equal(next.banditAbilityLoadout.tap1, 'pokeCombo');
  assert.equal(next.banditAbilityLoadout.hold2, null);
  assert.equal(def.banditAbilityLoadout.tap1, 'swingCombo');
  for (const bad of [
    { weapons: { hatchet: 0 } },
    { rangedChance: 2 },
    { attacks: { tap1: { chargedBreaker: 1 } } },
    { clothing: { hood: { chance: -1, items: { fine_hood: 1 } } } },
    { dyes: { HOOD_C: { '#badcolor': 1 } } },
    { flaskCount: 0 },
    { specialAttacks: { arbitrary: true } },
  ])
    assert.throws(() => api.set({ schema: api.schema, rules: { enemy: bad } }));
  api.set({
    schema: api.schema,
    rules: { 'bandit:grunt': { enabled: false, ...rule } },
  });
  assert.strictEqual(
    api.configFor('bandit:grunt', originalConfig, 'grunt', never),
    originalConfig,
  );
  const context = {
    window: {},
    fetch: () => {},
    document: { baseURI: 'https://game.test/docs/' },
    URL,
  };
  vm.runInNewContext(
    read('docs/tools/enemy-loadout-editor/source-data.js'),
    context,
  );
  const source = context.window.EnemyLoadoutSourceData;
  assert.equal(source.types.length, 16);
  const game = read('docs/game.js');
  const shapes = source.declaration(game, 'MELEE_WEAPON_SHAPE_DEFS');
  assert.equal(shapes.harlyaoBroadsword.slots[0], 'weapon');
  assert.equal(source.declaration(game, 'METAL_DEFS').nativeCopper.tier, 1);
  assert.throws(() =>
    source.declaration('const unrelated = {};', 'METAL_DEFS'),
  );
  const calls = [];
  context.window.GameRandom = { random: () => 0.2 };
  context.window.EnemyLoadoutRules = api;
  context.window.BanditCombat = {
    makeEntity: (...args) => {
      calls.push(['bandit', ...args]);
      return {def:{moveSpeed:100,chaseSpeed:150}};
    },
  };
  for (const key of [
    'MinionCombat',
    'MaskboundGuardianCombat',
    'HarlyaoLichCombat',
  ])
    context.window[key] = {
      makeEntity: (options) => {
        calls.push([key, options]);
        return options;
      },
    };
  const data = {
    gang: originalConfig,
    tribes: {
      porakaneki: {
        equipment: {
          weaponShapes: ['fishingspear'],
          weaponMetalKey: 'tinBronze',
        },
        avengers: { weaponShapes: ['hatchet'], mountSpecies: 'nazgraku' },
      },
    },
    shapes: {
      hatchet: { dmgType: 'sharp' },
      fishingspear: { dmgType: 'sharp' },
    },
  };
  await source.spawn('maskbound:sentinel', 2, data);
  assert.equal(calls.at(-1)[0], 'MaskboundGuardianCombat');
  assert.equal(calls.at(-1)[1].troopType, 'sentinel');
  await source.spawn('lich:tothal', 1, data);
  assert.equal(calls.at(-1)[0], 'HarlyaoLichCombat');
  assert.equal(calls.at(-1)[1].type, 'tothal');
  await source.spawn('harlyao-skeleton', 1, data);
  assert.equal(calls.at(-1)[0], 'MinionCombat');
  const avenger = await source.spawn('porakaneki:avenger', 1, data);
  assert.equal(avenger.def.moveSpeed,140);
  assert.equal(avenger.def.chaseSpeed,210);
  assert.equal(calls.at(-1)[6].mountSpecies, 'nazgraku');
  assert.equal(calls.at(-1)[6].defOverride.weaponKey, 'hatchet_tinBronze');
  const banditWindow = {
    AlchemySystem: {
      RECIPE_DEFS: {
        red: { id: 'red', useMode: 'throw' },
        blue: { id: 'blue', useMode: 'throw' },
        green: { id: 'green', useMode: 'throw' },
      },
    },
  };
  vm.runInNewContext(read('docs/js/combat/combat-bandit.js'), {
    window: banditWindow,
    fetch: async () => ({
      ok: true,
      json: async () => ({ genders: ['male'] }),
    }),
  });
  banditWindow.BanditCombat.init({ rnd: () => 0.9 });
  assert.deepEqual(
    Array.from(
      banditWindow.BanditCombat.rollFlaskLoadout({
        flasker: {
          loadoutSize: 2,
          recipeWeights: { red: 1, blue: 1, green: 0 },
        },
      }),
    ).sort(),
    ['blue', 'red'],
  );
  const singleGender = await banditWindow.BanditCombat.rollRoster(
    { speciesWeights: { porakaneki: 1 }, clothingPool: { slots: [] } },
    'grunt',
  );
  assert.equal(
    singleGender.appearance.gender,
    'male',
    'native bandit roster honors NPC-only single-gender species',
  );
  const lichSource = read('docs/js/combat/combat-lich.js');
  const castStart = lichSource.indexOf('  function beginLichCast('),
    castEnd = lichSource.indexOf('  function updateLichAI(', castStart);
  const lichContext = vm.createContext({
    window: {
      EnemyLoadoutRules: {
        ruleFor: () => ({ specialAttacks: { summon: false, primary: false } }),
      },
    },
  });
  vm.runInContext(
    lichSource.slice(castStart, castEnd) + '\nthis.cast=beginLichCast;',
    lichContext,
  );
  assert.equal(lichContext.cast({ lichType: 'tothal' }, null, 'summon'), false);
  assert.equal(
    lichContext.cast({ lichType: 'tothal' }, null, 'primary'),
    false,
  );
  console.log(
    'Enemy loadout rules: native no-op, class routing, seeded weights, wardrobe/metal cleanup, species restriction, dye 3, attacks, validation and factory adapters passed',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
