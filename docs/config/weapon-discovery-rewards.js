// Weapon shapes whose first obtainable copy comes from a non-NPC discovery source.
// Runtime hooking lives in docs/js/weapon-discovery-rewards.js. Keeping this data
// separate from friendship visits means Pahu/Gantami can later receive unrelated
// trust gifts without changing Fishing Mace / Dagger acquisition rules.
(function (global) {
  'use strict';

  const config = {
    schema: 'hobunji_weapon_discovery_rewards.v1',

    // Synthetic dialogue-state IDs are used only to reuse the authoritative
    // Bronzeworks unlock/completion persistence owned by WeaponTrustVisits.
    // They never correspond to a real NPC and can therefore never visit.
    syntheticNpcIdPrefix: '__weapon_discovery__:',
    syntheticRequiredHearts: 999999,

    rewards: [
      {
        id: 'gullet_fishingmace',
        source: 'gulletFish',
        shapeKey: 'fishingmace',
        metalKey: 'nativeCopper',
        chance: 0.20,
        label: 'Fishing Mace',
      },
      {
        id: 'treasure_dagger',
        source: 'treasureChest',
        shapeKey: 'dagger',
        metalKey: 'nativeCopper',
        chance: 0.20,
        label: 'Dagger',
      },
    ],
  };

  global.WEAPON_DISCOVERY_REWARD_CONFIG = Object.freeze(config);
})(window);
