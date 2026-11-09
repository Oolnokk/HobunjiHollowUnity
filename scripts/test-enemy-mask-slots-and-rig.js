'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = (path) => fs.readFileSync(path, 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1,
    end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (a, b, label) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} / ${b}`);
const context = {
  console,
  window: null,
  location: { pathname: '/game/' },
  setInterval() {
    return 1;
  },
  clearInterval() {},
  URL,
  document: { baseURI: 'https://game.test/docs/', currentScript: null },
  fetch: async () => ({
    ok: true,
    json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }),
  }),
};
context.window = context;
vm.createContext(context);
for (const file of [
  'docs/config/character-rig-scale-defaults.js',
  'docs/js/character-rig-scale.js',
  'docs/js/species-pose-scaling.js',
])
  vm.runInContext(read(file), context);
vm.runInContext(
  'const portraitMaskIds=new Set();' +
    extract(read('docs/js/portrait-utils.js'), 'isPortraitMaskCosmeticId'),
  context,
);
vm.runInContext(read('docs/js/combat/enemy-loadout-rules.js'), context);
const rules = context.EnemyLoadoutRules;
const original = {
  schema: rules.schema,
  rules: {
    'maskbound:sentinel': {
      clothing: {
        hood: {
          chance: 0.8,
          items: { hachutu_binding_mask_ii: 3, ragged_hood: 1 },
        },
      },
      dyes: { HOOD_C: { '#12aacc': 1 } },
    },
  },
};
const migrated = rules.validate(original).rules['maskbound:sentinel'];
near(
  migrated.clothing.mask.chance,
  0.6,
  'mixed old hood pool retains mask marginal chance',
);
near(
  migrated.clothing.hood.chance,
  0.2,
  'mixed old hood pool retains hood marginal chance',
);
assert.equal(
  original.rules['maskbound:sentinel'].clothing.mask,
  undefined,
  'import remains immutable',
);
assert.ok(migrated.dyes.MASK_C);
const zero = rules.validate({
  schema: rules.schema,
  rules: {
    x: {
      clothing: {
        hood: {
          chance: 1,
          items: { hachutu_binding_mask_ii: 0, ragged_hood: 1 },
        },
      },
    },
  },
}).rules.x;
assert.equal(zero.clothing.mask.chance, 0);
rules.set({
  schema: rules.schema,
  rules: {
    x: {
      clothing: {
        mask: { chance: 1, items: { hachutu_binding_mask_ii: 1 } },
        hood: { chance: 1, items: { ragged_hood: 1 } },
      },
      dyes: { MASK_C: { '#12aacc': 1 } },
    },
  },
});
const roster = rules.applyRoster(
  'x',
  {
    appearance: { speciesId: 'mao-ao', gender: 'male' },
    equippedCosmetics: [],
    cosmeticSlots: {},
  },
  () => 0.1,
);
assert.deepEqual(plain(roster.equippedCosmetics), [
  'hachutu_binding_mask_ii',
  'ragged_hood',
]);
assert.equal(roster.cosmeticSlots.hachutu_binding_mask_ii, 'mask');
assert.equal(roster.cosmeticSlots.ragged_hood, 'hood');
assert.equal(roster.appearance.bodyColors.MASK_C.hex, '#12aacc');
for (const name of fs.readdirSync('docs/config/cosmetics/clothes/masks')) {
  const mask = JSON.parse(
    read('docs/config/cosmetics/clothes/masks/' + name),
  );
  assert.equal(mask.slot, 'mask');
  assert.equal(mask.tintSlot, 'MASK');
}

// Execute both production placement helpers with the SAME authored pose point.
// The player has a floor-root, while hostiles have a model-center root. Both
// must resolve the same rig-scaled hand anchor and species/gender orbit.
const pose = context.HobunjiSpeciesPoseScale;
assert.equal(pose.resolveScale('harlyao-skeleton', 'female'), 0.65);
assert.equal(pose.resolveScale('maskbound-guardian', 'male'), 1);
pose.setScale('harlyao-skeleton', 'female', { x: 0.8, y: 0.9, z: 1.1 });
assert.equal(
  pose.resolveScale('engh-sho', 'female'),
  0.65,
  'child override cannot rewrite the donor',
);
const playerSource = read('docs/game.js'),
  banditSource = read('docs/js/combat/combat-bandit.js');
vm.runInContext(
  extract(banditSource, 'scaleBanditToolPositionAroundCentroid'),
  context,
);
context._speciesPoseScaling = pose;
context._toolPoseCentroidDebug = { rawWorld: {}, finalWorld: {} };
context.playerPoseIdentity = () => context.identity;
context.playerToolPoseCentroidScale = () =>
  pose.scaleForPose(context.playerPoseOrbitScale, context.playerArmLength);
vm.runInContext(
  extract(playerSource, 'scaleToolWorldPointAroundPlayerCentroid'),
  context,
);
for (const speciesId of [
  'mao-ao',
  'engh-sho',
  'kenkari',
  'mashtzarr',
  'tletingan',
  'harlyao-skeleton',
])
  for (const gender of ['male', 'female']) {
    const scale = context.HobunjiCharacterRigScale.scaleFor(
      speciesId,
      gender,
    );
    const modelHeight = 0.9,
      handY = 0.45,
      floorY = 3;
    context.identity = { speciesId, gender };
    context.playerMesh = { position: { x: 2, y: floorY, z: 4 } };
    context.playerToolBaseY = handY;
    context.playerArmLength = 0.558;
    context.playerAvatarModelHeight = modelHeight;
    context.playerPoseOrbitScale = pose.resolveAxes(speciesId, gender);
    for (const yaw of [0, 0.7, Math.PI]) {
      const raw = {
        x: 2 + Math.cos(yaw) * 0.4 + Math.sin(yaw) * 0.3,
        y: floorY + handY + 0.2,
        z: 4 - Math.sin(yaw) * 0.4 + Math.cos(yaw) * 0.3,
      };
      const point = () => ({
        ...raw,
        set(x, y, z) {
          Object.assign(this, { x, y, z });
        },
      });
      const expected = point(),
        actual = point();
      context.scaleToolWorldPointAroundPlayerCentroid(expected, yaw);
      const actor = {
        avatarRef: {
          speciesId,
          gender,
          modelHeight: modelHeight * scale.y,
          poseModelHeight: modelHeight,
          poseRigScaleY: scale.y,
          handAttachY: handY,
          armLength: 0.558,
          poseOrbitAxes: context.playerPoseOrbitScale,
          group: {
            position: {
              x: 2,
              y: floorY + (modelHeight * scale.y) / 2,
              z: 4,
            },
            userData: {},
          },
        },
      };
      context.scaleBanditToolPositionAroundCentroid(
        actor,
        { position: actual },
        yaw,
      );
      for (const axis of ['x', 'y', 'z'])
        near(
          actual[axis],
          expected[axis],
          `${speciesId}/${gender}/${yaw} ${axis}`,
        );
    }
  }

// Ranged enemies must convert the logical facing angle into the player's
// visual basis, turn the body with the authored pose, and use the actual hand
// scan instead of the historical one-size-fits-all -0.34 X anchor.
context.THREE = {
  MathUtils: { degToRad: (degrees) => (degrees * Math.PI) / 180 },
};
context.deps = { TILE: 55 };
const rangedPose = {
  x: 0.23,
  y: 0.08,
  z: 0.14,
  pitch: 16,
  yaw: 65,
  roll: 11,
  bodyYaw: -52,
  scale: 1,
};
context.defFor = () => ({ rangedType: 'crossbow' });
context.idlePose = () => rangedPose;
context.SharedAttackPose = {};
context.BanditCombat = { applyRiderMount() {} };
vm.runInContext(
  extract(read('docs/js/combat/ranged-weapons.js'), 'updateBanditVisual'),
  context,
);
const currentScale = context.HobunjiCharacterRigScale.scaleFor(
  context.identity.speciesId,
  context.identity.gender,
);
const holder = {
  scale: {
    x: 1,
    setScalar(n) {
      this.x = this.y = this.z = n;
    },
  },
  rotation: {
    set(...args) {
      this.args = args;
    },
  },
  position: {
    set(x, y, z) {
      Object.assign(this, { x, y, z });
    },
  },
};
const rangedActor = {
  facing: Math.PI / 2,
  _rangedMode: true,
  x: 110,
  y: 220,
  def: { rangedWeaponKey: 'crossbow', aimAngleOffset: Math.PI / 2 },
  _banditRangedToolHolder: holder,
  avatarRef: {
    speciesId: context.identity.speciesId,
    gender: context.identity.gender,
    modelHeight: 0.9 * currentScale.y,
    poseModelHeight: 0.9,
    poseRigScaleY: currentScale.y,
    handAttachX: -0.21,
    handAttachY: 0.45,
    armLength: 0.558,
    poseOrbitAxes: context.playerPoseOrbitScale,
    group: {
      position: { x: 2, y: 3 + (0.9 * currentScale.y) / 2, z: 4 },
      rotation: {},
      userData: {},
    },
  },
};
context.updateBanditVisual(rangedActor);
const bodyYaw = (rangedPose.bodyYaw * Math.PI) / 180;
near(
  holder.rotation.args[1],
  bodyYaw + (rangedPose.yaw * Math.PI) / 180,
  'ranged yaw agrees with player visual basis',
);
near(
  rangedActor.avatarRef.group.rotation.y,
  bodyYaw - Math.PI / 2,
  'body shares ranged authored yaw',
);
const rangedExpected = {
  x:
    2 +
    Math.cos(bodyYaw) * (-0.21 + rangedPose.x) +
    Math.sin(bodyYaw) * rangedPose.z,
  y: 3 + 0.45 + rangedPose.y,
  z:
    4 -
    Math.sin(bodyYaw) * (-0.21 + rangedPose.x) +
    Math.cos(bodyYaw) * rangedPose.z,
  set(x, y, z) {
    Object.assign(this, { x, y, z });
  },
};
context.scaleToolWorldPointAroundPlayerCentroid(rangedExpected, bodyYaw);
for (const axis of ['x', 'y', 'z'])
  near(
    holder.position[axis],
    rangedExpected[axis],
    'ranged player/hostile ' + axis,
  );

// Head-scale influence must be fully rigid throughout the bare skull, while
// shoulders outside its geometric region retain only the turn blend.
const avatarSource = read('docs/js/png-plane-avatar.js');
context.smoothstep01 = (value) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
for (const name of ['headScaleGateAtPixel', 'headScaleWeightAt'])
  vm.runInContext(extract(avatarSource, name), context);
near(
  context.headScaleWeightAt(0.1, 0.1, 1, 50, { left: 40, right: 60 }, 0.4),
  1,
  'lowest skull row has full scale influence',
);
near(
  context.headScaleWeightAt(0.2, 0.1, 1, 95, { left: 40, right: 60 }, 0.9),
  0,
  'far shoulder never inherits skull scaling',
);
console.log(
  'Mask slot migration, independent hood rolls and player/hostile rig-orbit parity passed',
);
