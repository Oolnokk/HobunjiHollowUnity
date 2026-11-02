// Real Three.js regression for Dungeon Fire's world-space anchor and swept contact.
// Uses the same Three.js r128 revision shipped by the game, without booting the full renderer.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const THREE = require('three');

assert.equal(THREE.REVISION, '128', 'Dungeon Fire integration is tested against the shipped Three.js r128 API');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/dungeon-fire.js'), 'utf8');
const window = { THREE };
let metalMaskCalls = 0;
let opaqueCalls = 0;
let mappedPixel = null;
window.RangedWeapons = { equippedRangedKey: () => 'test-bow' };
window.WeaponEnchantmentVFX = {
  metalMaskForSprite: async () => {
    metalMaskCalls++;
    return {
      width: 4,
      height: 4,
      indices: Uint32Array.from([0, 1, 5, 6]),
      matchedMetalPixels: 4,
    };
  },
  opaqueAnchorForSprite: async () => {
    opaqueCalls++;
    return { width: 4, height: 4, index: 2, opaquePixels: 8 };
  },
  metalPixelToLocal: (index, mask, plane) => {
    mappedPixel = { index, width: mask.width, height: mask.height, plane };
    return { x: 0.25, y: 0.5 };
  },
};
const context = vm.createContext({
  window,
  THREE,
  console,
  performance,
  Promise,
  Map,
  Set,
  Math,
  Number,
  String,
  Object,
  Array,
  Uint32Array,
});
vm.runInContext(source, context, { filename: 'dungeon-fire.js' });

function createProjectile(type, spritePath) {
  const scene = new THREE.Scene();
  const mesh = new THREE.Group();
  mesh.name = 'testProjectile';
  const facePivot = new THREE.Group();
  facePivot.rotation.z = Math.PI / 5; // Exercise the real rotated held-plane transform, not just root translation.
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
  );
  plane.name = 'projectilePlane';
  facePivot.add(plane);
  mesh.add(facePivot);
  mesh.userData.projectilePlane = plane;
  scene.add(mesh);
  return {
    scene,
    mesh,
    plane,
    projectile: {
      dungeonFire: true,
      team: 'player',
      dead: false,
      def: { rangedType: type, projectileSprite: spritePath },
      mesh,
    },
  };
}

function closeVector(actual, expected, message) {
  assert.ok(actual.distanceTo(expected) < 1e-6, message + ': ' + JSON.stringify({
    actual: actual.toArray(),
    expected: expected.toArray(),
  }));
}

async function main() {
  const fire = window.DungeonFire;
  assert.ok(fire, 'Dungeon Fire registers with actual Three.js');
  assert.equal(fire.armNextProjectile(), true, 'an equipped ranged weapon can arm one shot');
  assert.equal(fire.consumeNextProjectile(), true, 'the next shot consumes the arm');
  assert.equal(fire.consumeNextProjectile(), false, 'the same arm cannot be consumed twice');

  const thrown = createProjectile('thrown', 'assets/test-metal-weapon.png');
  assert.equal(fire.attachProjectile(thrown.projectile), true, 'thrown projectile creates its live flame');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(metalMaskCalls, 1, 'thrown weapons resolve the verdigris-compatible metal mask');
  assert.equal(opaqueCalls, 0, 'a usable metal mask takes precedence over the general alpha fallback');
  assert.equal(thrown.projectile._dungeonFire.anchorKind, 'metal');
  assert.equal(mappedPixel?.index, 1, 'the metal centroid resolves to a real source-pixel index');

  const state = thrown.projectile._dungeonFire;
  assert.ok(state.worldFlame?.isObject3D, 'the world flame is a real Three.js object');
  assert.equal(state.worldFlame.parent, thrown.scene, 'the plume is a sibling of the moving projectile, not trapped in its rotating plane');

  // First sample establishes the alpha-pixel anchor, then move the projectile
  // through a target. The flame must follow the transformed plane point.
  fire.updateProjectile(thrown.projectile, 1 / 60);
  const expectedStart = thrown.plane.localToWorld(new THREE.Vector3(0.25, 0.5, 0));
  closeVector(state.anchorWorld, expectedStart, 'source pixel maps through the projectile plane world matrix');
  thrown.mesh.position.set(6, 0, 0);
  thrown.projectile.mesh.updateWorldMatrix(true, true);
  fire.updateProjectile(thrown.projectile, 1 / 60);
  const expectedEnd = thrown.plane.localToWorld(new THREE.Vector3(0.25, 0.5, 0));
  closeVector(state.anchorWorld, expectedEnd, 'moving projectile updates the source-pixel world anchor');
  closeVector(state.worldFlame.position, expectedEnd, 'upright plume remains attached to the moving source pixel');
  assert.ok(Math.abs(state.previousAnchorWorld.x - expectedStart.x) < 1e-6,
    'the fire sweep preserves the previous frame anchor for continuous collision');

  // This target is above the projectile's flight line. The upward flame volume
  // must reach it using actual Box3 geometry, rather than a mocked bounds object.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), material);
  target.position.set(3, 2, 0);
  thrown.scene.add(target);
  thrown.scene.updateMatrixWorld(true);
  let burnCount = 0;
  assert.ok(fire.registerTarget({
    id: 'real-three-ceiling-target',
    object: target,
    onBurn: () => { burnCount++; return true; },
  }), 'actual Three.js meshes register as fire targets');

  // Limit the sweep to 20% of its travel, simulating terrain/cover/actor impact
  // before the mechanism. It must not burn the target beyond that cutoff.
  assert.equal(fire.contactProjectile(
    thrown.projectile,
    expectedStart,
    expectedEnd,
    0.2,
    0.05,
  ), false, 'fire cannot contact a target beyond the collision-system cutoff');
  assert.equal(burnCount, 0, 'occluded target receives no callback');

  assert.equal(fire.contactProjectile(
    thrown.projectile,
    expectedStart,
    expectedEnd,
    1,
    0.05,
  ), true, 'the same swept flame can contact the elevated target when unobstructed');
  assert.equal(burnCount, 1, 'accepted ignition runs exactly once');
  assert.equal(fire.debugSnapshot().reactiveTargets, 1);

  // Ordinary arrows use the source PNG alpha instead of a weapon-metal mask.
  const arrow = createProjectile('arrow', 'assets/test-arrow.png');
  assert.equal(fire.attachProjectile(arrow.projectile), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(opaqueCalls, 1, 'ordinary ranged projectiles resolve the top opaque source pixel');
  assert.equal(arrow.projectile._dungeonFire.anchorKind, 'opaque');

  assert.equal(fire.disposeProjectile(thrown.projectile), true);
  assert.equal(state.worldFlame.parent, null, 'disposing the projectile removes its detached world flame');
  assert.equal(fire.disposeProjectile(arrow.projectile), true);
  assert.equal(fire.debugSnapshot().activeVisuals, 0, 'all projectile-owned visuals are released');
  fire.clear();
  assert.equal(fire.debugSnapshot().reactiveTargets, 0, 'composer cleanup clears registered fire targets');

  console.log('Dungeon Fire real Three.js r128 transforms, plume contact, cutoff and cleanup passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
