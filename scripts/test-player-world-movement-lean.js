'use strict';
const assert = require('assert'); // Checks final tilt under independent movement, stance, and billboard headings.
const fs = require('fs'); // Loads the shipped composer functions for execution.
const vm = require('vm'); // Supplies a small renderer-independent math fixture.
const source = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8'); // Production composer including world-channel routing.
class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w, isQuaternion: true }); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  copy(q) { Object.assign(this, q); return this; }
  invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; } // Reverses unit world rotations for inherited-child compensation.
  multiply(q) {
    const { x, y, z, w } = this; // Hamilton product for the rendered orientation.
    return this.copy(new Q(w*q.x+x*q.w+y*q.z-z*q.y, w*q.y-x*q.z+y*q.w+z*q.x,
      w*q.z+x*q.y-y*q.x+z*q.w, w*q.w-x*q.x-y*q.y-z*q.z));
  }
}
class V {
  constructor(x = 0, y = 0, z = 0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  clone() { return new V(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  applyQuaternion(q) {
    const x = this.x, y = this.y, z = this.z; // Input world offset converted below by a unit quaternion.
    const ix = q.w*x + q.y*z - q.z*y, iy = q.w*y + q.z*x - q.x*z, iz = q.w*z + q.x*y - q.y*x, iw = -q.x*x-q.y*y-q.z*z;
    return this.set(ix*q.w + iw*-q.x + iy*-q.z - iz*-q.y,
      iy*q.w + iw*-q.y + iz*-q.x - ix*-q.z,
      iz*q.w + iw*-q.z + ix*-q.y - iy*-q.x);
  }
  lengthSq() { return this.x*this.x+this.y*this.y+this.z*this.z; }
}
const body = { quaternion: new Q(), worldPosition: new V(), localToWorld: v => v }; // Represents the character after weapon yaw and camera-facing correction.
const held = { quaternion: new Q(), worldPosition: new V(0.4, 0.7, 0.2) }; // Scene-sibling weapon/tool holder should stay upright under movement lean.
const pet = { quaternion: new Q(), worldPosition: new V(-0.2, 1.1, 0.1) }; // Shoulder-mounted animals should still follow the moving torso.
const bagItem = { quaternion: new Q(), worldPosition: new V(), parent: body, isObject3D: true, type: 'Group', visible: true,
  name: '', userData: { isPngPlane: true }, children: [{ isMesh: true }] }; // Recreates game.js's directly nested heldItemHolder, including Kurraya.
body.children = [bagItem]; // The held bag item inherits every transform on playerMesh until the renderer counters it.
const roots = [{ root: body, kind: 'player', providerName: 'player' }, { root: held, kind: 'external', providerName: 'equippedTool' }, { root: pet, kind: 'external', providerName: 'shoulderPets' }]; // Matches the actual named attachment providers.
const context = {
  THREE: { Quaternion: Q, Vector3: V }, channels: new Map(), playerMesh: body, playerPosteriorY: 0.5,
  finite: (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback,
  currentOwnedRootEntries: () => roots, hierarchyWorldQuaternion: root => root.quaternion,
  quaternionEulerDegrees: () => ({}), playerLegRoot: null, isAvatarBodyRoot: () => false,
  hasRenderableDescendant: root => root.children?.some(child => child.isMesh) || false,
  applyWorldDelta(root, pivot, rotation, translation, undo) {
    const targets = root === body ? [body, bagItem] : [root]; // Emulates how Three.js automatically passes parent world transforms to heldItemHolder.
    const saved = targets.map(node => ({ node, quaternion: node.quaternion.clone(), position: node.worldPosition.clone() })); // Restored in reverse render order.
    for (const node of targets) {
      node.quaternion.copy(rotation.clone().multiply(node.quaternion));
      node.worldPosition.sub(pivot).applyQuaternion(rotation).add(pivot).add(translation);
    }
    undo.push(() => saved.forEach(({ node, quaternion, position }) => { node.quaternion.copy(quaternion); node.worldPosition.copy(position); }));
  },
}; // Only rendering IO is mocked; channel storage, filtering, and final routing execute production code.
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function isHeldVisualRoot('), source.indexOf('  // The whole player rig')), context);
vm.runInContext(source.slice(source.indexOf('  function channelQuaternion('), source.indexOf('  function applyWorldDelta(')), context);
vm.runInContext(source.slice(source.indexOf('  function setChannel('), source.indexOf('  function clearChannel(')), context);
vm.runInContext(source.slice(source.indexOf('  const worldChannelPivot'), source.indexOf('  function registerPlayerRig(')), context);
for (let movement = 0; movement < 8; movement++) {
  for (const stance of [-2.4, -0.9, 0, 0.7, 2.1]) {
    const yaw = movement*Math.PI/4; // Covers forward, backward, lateral, and diagonal travel independent of stance.
    const lean = new Q(Math.cos(yaw)*Math.sin(Math.PI/12),0,-Math.sin(yaw)*Math.sin(Math.PI/12),Math.cos(Math.PI/12)); // Thirty-degree lean toward movement.
    body.quaternion = new Q(0,Math.sin(stance/2),0,Math.cos(stance/2));
    held.quaternion.copy(body.quaternion);
    pet.quaternion.copy(body.quaternion);
    bagItem.quaternion.copy(body.quaternion);
    bagItem.worldPosition.copy(new V(0.55,0.75,0.32).applyQuaternion(body.quaternion)); // Initial held pose is parented beneath the stance-rotated player.
    const initialBagWorld = bagItem.worldPosition.clone(); // The same position must remain after run lean and full render restoration.
    const initialBagQuaternion = bagItem.quaternion.clone(); // Kurraya/bottle local pose should not inherit run pitch or roll.
    context.setChannel('stance', { quaternion: new Q(0,Math.sin(stance/2),0,Math.cos(stance/2)) });
    context.setChannel('run-lean', { space: 'world', quaternion: lean, excludeExternalProviders: ['equippedTool', 'heldItem'] });
    assert.deepStrictEqual(Array.from(context.resolveDelta('player').applied), ['stance'], 'world lean never participates in portrait-local composition');
    assert.deepStrictEqual(Array.from(context.resolveDelta('external').applied), ['stance'], 'held tools retain authored local stance channels');
    assert.deepStrictEqual(Array.from(context.resolveDelta('external', 'world', 'equippedTool').applied), [], 'movement lean never rotates the held weapon/tool');
    assert.deepStrictEqual(Array.from(context.resolveDelta('external', 'world', 'heldItem').applied), [], 'nested bottles and Kurraya also opt out');
    assert.deepStrictEqual(Array.from(context.resolveDelta('external', 'world', 'shoulderPets').applied), ['run-lean'], 'shoulder pets still follow movement lean');
    const undo = []; // Runs the same final-phase restoration used by the renderer.
    const debug = { appliedOrder: ['stance'] }; // Existing yaw contributions remain visible in diagnostics.
    context.applyWorldChannels(undo, debug);
    for (const root of [body, pet]) {
      const q = root.quaternion; // Rotated up must point toward velocity for every stance.
      assert(Math.abs(2*(q.x*q.y-q.w*q.z)-Math.sin(yaw)*0.5)<1e-12);
      assert(Math.abs(2*(q.y*q.z+q.w*q.x)-Math.cos(yaw)*0.5)<1e-12);
      assert(Math.abs(1-2*(q.x*q.x+q.z*q.z)-Math.cos(Math.PI/6))<1e-12);
    }
    assert(debug.appliedOrder.includes('run-lean'));
    assert.strictEqual(debug.heldItemLeanCompensated, 1, 'the actual nested inventory holder must be counter-rotated');
    for (const axis of ['x', 'y', 'z', 'w']) assert(Math.abs(bagItem.quaternion[axis] - initialBagQuaternion[axis]) < 1e-12, 'held item must retain its pre-lean world orientation');
    for (const axis of ['x', 'y', 'z']) assert(Math.abs(bagItem.worldPosition[axis] - initialBagWorld[axis]) < 1e-12, 'held item must retain its pre-lean world position');
    assert.deepStrictEqual([held.quaternion.x,held.quaternion.y,held.quaternion.z,held.quaternion.w],
      [0,Math.sin(stance/2),0,Math.cos(stance/2)], 'held weapon/tool retains its stance orientation through the render');
    for (const restore of undo.reverse()) restore();
    for (const axis of ['x', 'y', 'z', 'w']) assert(Math.abs(bagItem.quaternion[axis] - initialBagQuaternion[axis]) < 1e-12, 'held item pose restores after render');
    for (const axis of ['x', 'y', 'z']) assert(Math.abs(bagItem.worldPosition[axis] - initialBagWorld[axis]) < 1e-12, 'held item world position restores after render');
    assert.strictEqual(pet.quaternion.x, 0, 'shoulder-pet world tilt is transient');
    assert.strictEqual(body.quaternion.x,0, 'render lean never accumulates into gameplay facing');
    assert.strictEqual(body.quaternion.z,0);
  }
}
// Other world-space influences must still reach the nested held item without inheriting movement lean.
const baseBag = bagItem.worldPosition.clone(); // Expected reference pose before combined world transforms.
const baseBagQuaternion = bagItem.quaternion.clone(); // Expected held orientation before combined world transforms.
const drunken = new Q(Math.sin(0.1), 0, 0, Math.cos(0.1)); // Separate world-space body sway, intentionally allowed on equipment.
const offset = new V(0.07, 0.025, -0.04); // Tests that correcting inherited movement rotation also preserves allowed translations.
context.setChannel('drunk', { space: 'world', quaternion: drunken, translation: offset });
const combinedUndo = []; // All original world transforms must restore, even with two channels.
const combinedDebug = { appliedOrder: [] }; // Observes nested compensation with more than one world-space channel.
context.applyWorldChannels(combinedUndo, combinedDebug);
const expectedBagPosition = baseBag.clone().sub(new V(0,0.5,0)).applyQuaternion(drunken).add(new V(0,0.5,0)).add(offset);
const expectedBagQuaternion = drunken.clone().multiply(baseBagQuaternion);
for (const axis of ['x','y','z']) assert(Math.abs(bagItem.worldPosition[axis] - expectedBagPosition[axis]) < 1e-12, 'held inventory items preserve allowed world-space movement/translation');
for (const axis of ['x','y','z','w']) assert(Math.abs(bagItem.quaternion[axis] - expectedBagQuaternion[axis]) < 1e-12, 'held inventory items preserve allowed world-space sway without running tilt');
for (const restore of combinedUndo.reverse()) restore();
for (const axis of ['x','y','z']) assert(Math.abs(bagItem.worldPosition[axis] - baseBag[axis]) < 1e-12, 'combined inherited transforms restore completely');
console.log('World movement lean: 40 headings/stances, scene tools, nested bottles/Kurraya, shoulder pets, sway and translations verified.');
