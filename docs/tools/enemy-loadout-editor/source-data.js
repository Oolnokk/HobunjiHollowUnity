// Editor adapter reads the current game's own immutable catalog declarations.
// No copied weapon/material table can quietly drift from live spawning.
(() => {
  'use strict';
  const types = [
    ['bandit:grunt', 'Bandit', 'Bandits'],
    ['bandit:flasker', 'Bandit Flasker', 'Bandits'],
    ['bandit:lieutenant', 'Bandit Lieutenant', 'Bandits'],
    ['bandit:captain', 'Bandit Captain', 'Bandits'],
    ['porakaneki:hunter', 'Porakaneki Hunter', 'Tribes'],
    ['omgurku:hunter', 'Omgurku Hunter', 'Tribes'],
    ['porakaneki:avenger', 'Porakaneki Avenger', 'Tribes'],
    ['mao-ao-skeleton', 'Mao’ao Skeleton', 'Undead'],
    ['harlyao-skeleton', 'Harlyao Skeleton', 'Undead'],
    ['ghoul', 'Ghoul', 'Undead'],
    ['lich:tothal', 'Tothal Lich', 'Liches'],
    ['lich:hronal', 'Hronal Lich', 'Liches'],
    ['lich:kanthic', 'Kanthic Lich', 'Liches'],
    ['maskbound:sentinel', 'Maskbound Sentinel', 'Maskbound'],
    ['maskbound:bulwark', 'Maskbound Bulwark', 'Maskbound'],
    ['maskbound:reacher', 'Maskbound Reacher', 'Maskbound'],
  ].map(([id, label, group]) => ({ id, label, group }));
  const read = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw Error(`${url}: HTTP ${r.status}`);
    return r.json();
  };
  function declaration(source, name) {
    const expression = new RegExp(
      'const ' + name + ' = (\\{[\\s\\S]*?\\n      \\});',
    ).exec(source)?.[1];
    if (!expression) throw Error('Game catalog declaration missing: ' + name);
    return Function('"use strict";return (' + expression + ');')();
  }
  async function load() {
    const [
      gang,
      porakaneki,
      omgurku,
      game,
      attackValues,
      index,
      npcDb,
      compositionSource,
    ] = await Promise.all([
      read('config/bandits/bandit-gang-config.json'),
      read('config/porakaneki-camp.json'),
      read('config/omgurku-camp.json'),
      fetch('game.js').then((r) => {
        if (!r.ok) throw Error('Game source HTTP ' + r.status);
        return r.text();
      }),
      read('config/combat/attack-values.json'),
      read('config/species/index.json'),
      read('config/npcs/hobunji-starter-npc-database.json'),
      fetch('js/drunk-prone-composition-bridge.js').then((r) => {
        if (!r.ok) throw Error('Movement composition source unavailable');
        return r.text();
      }),
    ]);
    const shapes = {
      ...declaration(game, 'TOOL_SHAPE_DEFS'),
      ...declaration(game, 'MELEE_WEAPON_SHAPE_DEFS'),
    };
    const metals = declaration(game, 'METAL_DEFS');
    const species = {};
    await Promise.all(
      index.entries.map(async (entry) => {
        const data = await read(
          new URL(
            entry.path,
            new URL('config/species/index.json', document.baseURI),
          ).href,
        );
        species[data.speciesId] = data;
      }),
    );
    const metalDamage = Function(
      'METAL_DEFS',
      'return (' +
        /function metalDmgMultiplier\(metalKey\) \{[\s\S]*?\n      \}/.exec(
          game,
        )[0] +
        ');',
    )(metals);
    const forwardLeanQuaternion = Function(
      'return (' +
        /function setForwardLeanQuaternion\(target, pitch, yaw\) \{[\s\S]*?\n  \}/.exec(
          compositionSource,
        )[0] +
        ');',
    )();
    return {
      forwardLeanQuaternion,
      npcs: npcDb.npcs || npcDb,
      metalDamage,
      gang,
      tribes: { porakaneki, omgurku },
      shapes,
      metals,
      species,
      attackValues,
    };
  }
  function defaults(kind, data) {
    const rank = kind.startsWith('bandit:') ? kind.split(':')[1] : 'grunt';
    const fixed = kind.startsWith('maskbound:')
      ? 'maskbound-guardian'
      : kind.startsWith('lich:')
        ? 'harlyao-skeleton'
        : kind.includes(':')
          ? kind.split(':')[0]
          : kind;
    const bandit = kind.startsWith('bandit:');
    const troop = kind.startsWith('maskbound:')
      ? window.MaskboundGuardianCombat.troopTypes[kind.split(':')[1]]
      : null;
    const minion = [
      'mao-ao-skeleton',
      'harlyao-skeleton',
      'ghost-marcher',
    ].includes(kind);
    const lich = kind.startsWith('lich:')
      ? window.HarlyaoLichCombat.TYPE_DEFS[kind.split(':')[1]]
      : null;
    const tribe = data.tribes[fixed];
    const weapons =
      troop?.weapons ||
      (lich
        ? ['pickshovel']
        : minion
          ? window.MinionCombat.defaultWeaponShapes
          : tribe
            ? kind.endsWith('avenger')
              ? tribe.avengers.weaponShapes
              : tribe.equipment.weaponShapes
            : Object.keys(data.shapes).filter((k) =>
                data.shapes[k].slots.includes('weapon'),
              ));
    const species = bandit ? data.gang.speciesWeights : { [fixed]: 1 };
    const pool = {};
    for (const id of weapons) pool[id] = 1;
    const clothing = {};
    if (bandit || tribe)
      for (const slot of data.gang.clothingPool.slots)
        clothing[slot] = {
          chance: data.gang.clothingPool.fillProbabilityByRank[rank] ?? 0.5,
          items: Object.fromEntries(
            data.gang.clothingPool.itemsBySlot[slot].map((id) => [id, 1]),
          ),
        };
    if (minion)
      Object.assign(clothing, {
        overwear: {
          chance: 1,
          items: { none: 1, tankan_bodywrap: 1, rugged_poncho: 1 },
        },
        torso: { chance: 0.5, items: { bandolier1: 1 } },
      });
    if (lich)
      Object.assign(clothing, {
        hood: { chance: 1, items: { ragged_hood: 1 } },
        overwear: { chance: 1, items: { tankan_bodywrap: 1 } },
      });
    if (troop)
      clothing.hood = { chance: 1, items: { hachutu_binding_mask_ii: 1 } };
    if (kind === 'ghoul')
      Object.assign(clothing, {
        overwear: {
          chance: 1,
          items: {
            tankan_bodywrap: 1,
            fine_bodywrap: 1,
            rugged_poncho: 1,
            fine_poncho: 1,
          },
        },
        hood: { chance: 0.4, items: { facewrap: 1, fine_hood: 1 } },
        hat: { chance: 0.6, items: { 'appearance::hat::basic_headband': 1 } },
      });
    if (!tribe)
      clothing.pants = {
        chance: 1,
        items: { pants_basic: 1, draped_pants: 1 },
      };
    const dyes = lich
      ? Object.fromEntries(
          lich.hues
            .flatMap((h) =>
              ['pure', 'muted', 'dusty', 'dark_muted'].map((v) => [
                'dye:CLOTH:' + v + '_' + h,
                1,
              ]),
            )
            .concat((lich.neutralDyes || []).map((id) => [id, 1])),
        )
      : minion
        ? { ...window.MinionCombat.dyeWeights }
        : troop
          ? { '#7F00FF': 1 }
          : kind === 'ghoul'
            ? { 'dye:CLOTH:pale_blue': 1 }
            : Object.fromEntries(
                data.gang.clothingPool.dyeVariantPool.flatMap((v) =>
                  data.gang.clothingPool.dyeHueFamilyPool.map((h) => [
                    'dye:CLOTH:' + v + '_' + h,
                    1,
                  ]),
                ),
              );
    return {
      species,
      genders: Object.fromEntries(
        (data.species[fixed]?.genders || ['male', 'female']).map((gender) => [
          gender,
          1,
        ]),
      ),
      weapons: pool,
      clothing,
      dyes,
      rank,
      lich: !!lich,
      tribe: !!tribe,
      mount:
        kind === 'porakaneki:avenger'
          ? data.tribes.porakaneki.avengers.mountSpecies
          : fixed === 'omgurku'
            ? 'omgurku lower body'
            : null,
      attacks: {
        tap1: { swingCombo: 1, pokeCombo: 1 },
        tap2: { exhaustCutter: 1, backstabFlick: 1, mercySpike: 1 },
        hold1:
          rank === 'captain' || rank === 'lieutenant'
            ? { chargedBreaker: 1 }
            : { none: 1 },
        hold2: rank === 'captain' ? { counterShield: 1 } : { none: 1 },
      },
    };
  }
  async function spawn(kind, tier, data, options = {}) {
    const shared = {
      x: 0,
      y: 0,
      tier,
      zoneId: 'map_dev_arena',
      extra: { enemyLoadoutKind: kind },
      ...options,
    };
    if (kind.startsWith('maskbound:'))
      return window.MaskboundGuardianCombat.makeEntity({
        ...shared,
        troopType: kind.split(':')[1],
        baseConfig: data.gang,
      });
    if (kind.startsWith('lich:'))
      return window.HarlyaoLichCombat.makeEntity({
        ...shared,
        type: kind.split(':')[1],
      });
    if (['mao-ao-skeleton', 'harlyao-skeleton', 'ghost-marcher'].includes(kind))
      return window.MinionCombat.makeEntity({
        ...shared,
        speciesId: kind,
        name: types.find((t) => t.id === kind).label,
        baseConfig: data.gang,
      });
    const rank = kind.startsWith('bandit:') ? kind.split(':')[1] : 'grunt';
    let config = data.gang;
    if (kind === 'ghoul') config = { ...config, speciesWeights: { ghoul: 1 } };
    const tribe = kind.split(':')[0];
    if (data.tribes[tribe]) {
      const source = data.tribes[tribe];
      const shape = window.EnemyLoadoutRules.pick(
        Object.fromEntries(
          (kind.endsWith('avenger')
            ? source.avengers.weaponShapes
            : source.equipment.weaponShapes
          ).map((s) => [s, 1]),
        ),
        window.GameRandom.random,
      );
      const metal = source.equipment.weaponMetalKey || 'nativeCopper';
      config = {
        ...config,
        speciesWeights: { [tribe]: 1 },
        rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
      };
      Object.assign(shared, {
        mountSpecies: kind.endsWith('avenger')
          ? source.avengers.mountSpecies
          : null,
        nameOverride: types.find((t) => t.id === kind).label,
        bodyColorsOverride:
          tribe === 'porakaneki'
            ? window.HobunjiPorakanekiSpecies?.bodyColorsForSeed?.(
                'loadout-editor-' + options.seed,
                'male',
              )
            : null,
        defOverride: {
          weaponKey: shape + '_' + metal,
          attackTag: data.shapes[shape]?.dmgType || 'sharp',
          rangedWeaponKey: shape === 'dagger' ? shape + '_' + metal : null,
        },
        extra: {
          ...shared.extra,
          isTribeHunter: true,
          tribeId: tribe,
          isTribeAvenger: kind.endsWith('avenger'),
        },
      });
    }
    return window.BanditCombat.makeEntity(config, rank, tier, 0, 0, shared);
  }
  window.EnemyLoadoutSourceData = Object.freeze({
    types,
    load,
    declaration,
    defaults,
    spawn,
  });
})();
