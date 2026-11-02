// Focused runtime regression for shared Dungeon Fire and Harlyao reactive mechanism contracts.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const fireCode = fs.readFileSync(path.join(root, 'docs/js/dungeon-fire.js'), 'utf8');
const mechanismCode = fs.readFileSync(path.join(root, 'docs/js/dev-random-ruin-dungeon-fire.js'), 'utf8');
const rangedCode = fs.readFileSync(path.join(root, 'docs/js/combat/ranged-weapons.js'), 'utf8');
const burdenCode = fs.readFileSync(path.join(root, 'docs/js/shattercasks.js'), 'utf8');
const themeCode = fs.readFileSync(path.join(root, 'docs/js/dev-random-ruin-lich-themes.js'), 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  lerp(v, alpha) {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    return this;
  }
}
class Object3D {
  constructor() {
    this.isObject3D = true;
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.rotation = { x: 0, y: 0, z: 0 };
    this.userData = {};
    this.children = [];
    this.parent = null;
    this.visible = true;
  }
  add(child) {
    child.parent?.remove?.(child);
    this.children.push(child);
    child.parent = this;
    return this;
  }
  remove(child) {
    this.children = this.children.filter(entry => entry !== child);
    if (child.parent === this) child.parent = null;
    return this;
  }
  updateWorldMatrix() {}
  updateMatrixWorld() {}
  localToWorld(point) {
    for (let node = this; node; node = node.parent) point.add(node.position);
    return point;
  }
}
class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
}
class Shape {
  moveTo() {}
  bezierCurveTo() {}
}
class ShapeGeometry {
  constructor(shape, segments) { this.shape = shape; this.segments = segments; }
  dispose() {}
}
class Material {
  constructor(options) { Object.assign(this, options); }
  dispose() {}
}
class Box3 {
  constructor() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); }
  setFromObject(object) {
    const bounds = object?.userData?.bounds;
    if (!bounds) return this;
    this.min.copy(bounds.min);
    this.max.copy(bounds.max);
    return this;
  }
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
  expandByScalar(value) {
    this.min.x -= value; this.min.y -= value; this.min.z -= value;
    this.max.x += value; this.max.y += value; this.max.z += value;
    return this;
  }
}

const THREE = {
  Vector3, Box3, Object3D, Group: Object3D, Mesh, Shape, ShapeGeometry,
  MeshBasicMaterial: Material, DoubleSide: 2, AdditiveBlending: 2,
};
const window = { THREE };
let metalMaskCalls = 0, opaqueCalls = 0, mappedIndices = [];
window.WeaponEnchantmentVFX = {
  metalMaskForSprite: async () => {
    metalMaskCalls++;
    return { width: 4, height: 4, indices: Uint32Array.from([0, 1, 5, 6]), matchedMetalPixels: 4 };
  },
  opaqueAnchorForSprite: async () => {
    opaqueCalls++;
    return { width: 4, height: 4, index: 2, opaquePixels: 8 };
  },
  metalPixelToLocal: (index, mask) => {
    mappedIndices.push(index);
    return { x: (index % mask.width) / 10, y: Math.floor(index / mask.width) / 10 };
  },
};
window.RangedWeapons = { equippedRangedKey: () => 'test-bow' };
const context = vm.createContext({
  window, THREE, Promise, Map, Set, Math, Number, String, Object, Array,
  Uint32Array, performance: { now: () => 1234 },
  console: { warn() {} },
});
vm.runInContext(fireCode, context, { filename: 'dungeon-fire.js' });

function makeProjectile(type, sprite) {
  const scene = new Object3D();
  const mesh = new Object3D();
  mesh.position.set(1, 1, 1);
  const plane = new Object3D();
  plane.geometry = { parameters: { width: 2, height: 2 } };
  mesh.add(plane);
  scene.add(mesh);
  return {
    scene, plane,
    projectile: {
      dungeonFire: true, team: 'player', dead: false,
      def: { rangedType: type, projectileSprite: sprite },
      mesh,
    },
  };
}

async function settleAsync() {
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const api = window.DungeonFire;
  assert(api, 'Dungeon Fire registers when THREE is present');
  assert(api.armNextProjectile(), 'a ranged weapon can arm the one-shot ignition');
  assert.equal(api.consumeNextProjectile(), true, 'first released projectile consumes the ignition');
  assert.equal(api.consumeNextProjectile(), false, 'the ignition cannot be consumed twice');

  const thrown = makeProjectile('thrown', 'assets/test-metal-weapon.png');
  assert(api.attachProjectile(thrown.projectile), 'thrown projectile receives the shared flame');
  await settleAsync();
  assert.equal(metalMaskCalls, 1, 'thrown weapons use the same source-metal mask as enchantment VFX');
  assert.equal(opaqueCalls, 0, 'a valid thrown metal mask takes priority over the general alpha anchor');
  assert.equal(thrown.projectile._dungeonFire.anchorKind, 'metal', 'thrown plume is anchored to source metal');
  assert.equal(mappedIndices[0], 1, 'the chosen anchor is the actual metal pixel nearest the metal-region centroid');
  assert.equal(thrown.projectile._dungeonFire.worldFlame.name, 'dungeonFire_worldUprightFlame',
    'thrown weapons use the same tall world-upright plume object');

  const arrow = makeProjectile('arrow', 'assets/test-arrow.png');
  assert(api.attachProjectile(arrow.projectile), 'ordinary ranged projectile receives the shared flame');
  await settleAsync();
  assert.equal(opaqueCalls, 1, 'non-thrown projectiles use source PNG alpha anchoring');
  assert.equal(arrow.projectile._dungeonFire.anchorKind, 'opaque', 'ordinary projectile uses its opaque anchor');

  const target = new Object3D();
  target.userData.bounds = {
    min: new Vector3(.8, 2, .8),
    max: new Vector3(1.2, 2.2, 1.2),
  };
  let rejectedBurns = 0, burns = 0;
  assert(api.registerTarget({
    id: 'test-rejecting-target',
    object: target,
    onBurn: () => { rejectedBurns++; return false; },
  }), 'a target may legitimately reject ignition');
  assert(api.registerTarget({
    id: 'test-ceiling-target',
    object: target,
    onBurn: () => { burns++; return true; },
  }), 'fire-reactive target registers');
  api.updateProjectile(thrown.projectile, .016);
  assert.doesNotThrow(() => api.contactProjectile(
    thrown.projectile, thrown.projectile.mesh.position, thrown.projectile.mesh.position, 1, .05
  ), 'contact calculation must use the defined plume height');
  assert.equal(rejectedBurns, 1, 'the closest mechanism receives its fire callback');
  assert.equal(burns, 1, 'a rejecting target does not shield the next valid target in the same fire sweep');

  api.disposeProjectile(thrown.projectile);
  api.disposeProjectile(arrow.projectile);
  assert.equal(api.debugSnapshot().activeVisuals, 0, 'projectile disposal releases every attached flame');
  api.clear();
  assert.equal(api.debugSnapshot().reactiveTargets, 0, 'clear removes all fire-reactive targets');

  const sourceBuilder=mechanismCode.slice(mechanismCode.indexOf('function buildSourceBrazier'),mechanismCode.indexOf('function buildNet'));
  assert(sourceBuilder.includes('world.group.add(group)'),
    'the source brazier belongs to the composer-owned group and is removed on clear/reroll');
  assert(mechanismCode.includes('!doors.some(item=>item.id===doorway.id)'),
    'Tothal shared room doorways are deduplicated before ice walls are generated');
  assert(mechanismCode.includes("registerComposer({id:'dungeonFire',buildRooms,update,controls,snapshot,clear})"),
    'Dungeon Fire is registered with the generated Harlyao ruin composer');
  assert(mechanismCode.includes('registerFireTarget(record,brazier=>') &&
    mechanismCode.includes('brazier.cleansed=window.DevRandomRuinLichThemes?.clearPlasmRadius?.(point.x,point.z,brazier.radius)||0;') &&
    !mechanismCode.includes('brazer=>'),
    'Kanthic cleansing callback consistently uses its brazier record');
  assert(mechanismCode.includes('buildNet(point,world.ceilingY,index)') &&
    mechanismCode.includes('buildIcicle(point,Number(context.ceilingY)||point.y+3.15,index)') &&
    mechanismCode.includes('buildThemeMechanisms(kit,context)'),
    'nets are shared across Harlyao themes and icicle payloads are added to Tothal ruins');
  assert(mechanismCode.includes('releaseBurdenDownward?.(record.burden,cause)') &&
    burdenCode.includes('function updateBurdenFalls(dt)') &&
    burdenCode.includes("resolveDownwardImpact(burden,state.cause+'-ground-impact',state.groundY)"),
    'ceiling payloads drop vertically through the shared Burden impact resolver');
  assert(themeCode.includes('function clearPlasmRadius(') &&
    themeCode.includes('clearPlasmRadius,') &&
    themeCode.includes('room.plasm.delete(key)'),
    'Kanthic cleansing removes live plasm tiles and rebuilds affected surfaces');
  assert(burdenCode.includes('BURDEN_FACTORIES') &&
    burdenCode.includes('BURDEN_IMPACT_HANDLERS') &&
    burdenCode.includes('registerBurdenFactory,registerBurdenImpactHandler'),
    'ceiling mechanisms support future modular Burden factories and impact handlers');
  assert(rangedCode.includes('const dungeonFire = window.DungeonFire?.consumeNextProjectile?.() === true;') &&
    rangedCode.includes('shotOptions?.dungeonFire === true && i > 0'),
    'only one player projectile in a volley consumes the one-shot fire charge');

  console.log('ok   shared Dungeon Fire anchors, contact, one-shot state and mechanism contracts');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
