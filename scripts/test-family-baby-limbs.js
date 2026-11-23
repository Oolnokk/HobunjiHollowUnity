#!/usr/bin/env node
'use strict';
// Carried-baby kicking hands/feet: cloned from the hidden walker's own 3D limb GLBs,
// outlined 3D (layer 1 only), excluded from colliders and the back-stow PNG sandwich,
// animated by one restoring RenderHooks frame hook, and disposed without freeing
// the walker's shared geometry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let THREE;
try { THREE = require('three'); } catch (_) {
  // Minimal Object3D/Mesh/Group stand-ins: enough for parenting, transforms and layers.
  class Layers { constructor() { this.mask = 1; } enable(bit) { this.mask |= 1 << bit; } }
  class Vec { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
  class Obj { constructor() { this.children = []; this.parent = null; this.name = ''; this.userData = {};
      this.position = new Vec(); this.rotation = new Vec(); this.scale = new Vec(1, 1, 1); this.layers = new Layers();
      this.visible = true; this.id = Obj.n = (Obj.n || 0) + 1; this.worldScale = 1; this.det = 1;
      this.matrixWorld = { determinant: () => this.det }; }
    add(c) { c.parent?.remove(c); c.parent = this; this.children.push(c); return this; }
    remove(c) { this.children = this.children.filter(x => x !== c); c.parent = null; return this; }
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
    getObjectByName(name) { let found; this.traverse(n => { if (!found && n.name === name) found = n; }); return found; }
    updateWorldMatrix() {}
    getWorldScale(out) { return out.set(this.worldScale, this.worldScale, this.worldScale); } }
  class Mesh extends Obj { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
  THREE = { Group: Obj, Mesh, Vector3: Vec };
}

const disposed = [];
const material = name => ({ name, clone() { const m = material(name + '_clone'); return m; }, dispose() { disposed.push(this.name); } });
const geometry = { attributes: { position: { count: 99 } }, dispose() { disposed.push('geometry'); } };
const hooks = [];
const window = { THREE, RenderHooks: { ORDER: { FAMILY_BABY_LIMBS: 950 }, register: spec => hooks.push(spec) } };
vm.runInNewContext(fs.readFileSync('docs/js/family-baby-limbs.js', 'utf8'), { window, THREE, performance: { now: () => 1234 }, Math, Object, Array, Number, String });
const api = window.FamilyBabyLimbs;
assert(api, 'FamilyBabyLimbs is exposed');
assert.equal(hooks.length, 1, 'one render hook');
assert.equal(hooks[0].scope, 'frame', 'limb motion is a once-per-world-frame presentation hook');
assert.equal(hooks[0].order, 950, 'hook uses the registered FAMILY_BABY_LIMBS order');

// A walker with real-shaped rig names: <name>_procedural_hands > left_hand_visual > mesh; left_foot > mesh.
const walkerRoot = new THREE.Group();
const handsRoot = new THREE.Group(); handsRoot.name = 'kid_procedural_hands'; walkerRoot.add(handsRoot);
const feetRoot = new THREE.Group(); feetRoot.name = 'kid_procedural_feet'; walkerRoot.add(feetRoot);
const sources = {};
for (const side of ['left', 'right']) {
  const hv = new THREE.Group(); hv.name = side + '_hand_visual'; handsRoot.add(hv);
  const hand = new THREE.Mesh(geometry, material(side + '_hand')); hand.name = 'CombinedMesh_MaterialSlots';
  hand.layers.mask = 0x2000000B; // Player/NPC hand passes: must NOT leak onto the baby clones.
  hv.add(hand); sources[side + 'Hand'] = hand;
  const foot = new THREE.Group(); foot.name = side + '_foot'; feetRoot.add(foot);
  const fallback = new THREE.Mesh(geometry, material('fallback')); fallback.visible = false; foot.add(fallback); // Hidden fallback sphere is skipped.
  const glb = new THREE.Mesh(geometry, material(side + '_foot')); foot.add(glb); sources[side + 'Foot'] = glb;
}
const walker = { root: walkerRoot };
const proxy = new THREE.Group();
proxy.userData = { familyBabyWidth: .2304, familyBabyHeight: .2304,
  familyBabyGripAnchors: { posterior: { x: 0, y: .112, z: 0 }, neck: { x: -.008, y: .204, z: 0 } } };
const bust = new THREE.Mesh(geometry, material('bust')); proxy.add(bust);

const found = api.sourceLimbs(walker);
assert.equal(found.hand.left, sources.leftHand, 'left hand GLB found under its rig visual');
assert.equal(found.foot.right, sources.rightFoot, 'visible right foot GLB found, hidden fallback skipped');

// Balance the world newborn before the carried proxy takes a copy of its limb sizes.
const babyScale = { hand: 1.20, foot: 1.20 }; // Exact basket-phase multipliers in romance-config.
assert.equal(api.balanceWalker(walker, babyScale), 4, 'both hands and feet receive newborn-only sizing');
assert.equal(api.balanceWalker(walker, babyScale), 0, 'family updates never multiply limb sizes repeatedly');
for (const side of ['left', 'right']) {
  assert.equal(walkerRoot.getObjectByName(side + '_hand_visual').scale.x, 1.2, 'hand visual scales about its own wrist');
  assert.equal(walkerRoot.getObjectByName(side + '_foot').scale.y, 1.2, 'foot visual scales without modifying leg anchors');
}
assert.equal(api.attach(proxy, { root: new THREE.Group() }), false, 'attach waits while limb GLBs are still loading');
assert.equal(api.attach(proxy, walker), true, 'attach succeeds once the walker has its limbs');
assert.equal(api.attach(proxy, walker), true, 'attach is idempotent');
const limbRoot = proxy.getObjectByName('family_baby_kicking_limbs');
assert(limbRoot && limbRoot.children.length === 4, 'two hands and two feet pivots');
const meshes = []; limbRoot.traverse(n => { if (n.isMesh) meshes.push(n); });
assert.equal(meshes.length, 4, 'four limb meshes');
for (const mesh of meshes) {
  assert.equal(mesh.geometry, geometry, 'limb shares the walker GLB geometry');
  assert(!Object.values(sources).some(src => src.material === mesh.material), 'limb owns a cloned material');
  assert.equal(mesh.layers.mask, 0b11, 'world + shell-outline layers only (curved 3D gets generated outline)');
  assert.equal(mesh.userData.shattercaskKeepsOwnDepth, true, 'excluded from the back-stow transparent PNG sandwich');
  assert.notEqual(mesh.userData.noOutline, true, '3D limbs are not suppressed from outlines');
}
assert.equal(proxy.children[0], bust, 'bust stays children[0] (refreshProxyArt texture swap relies on it)');

// Anatomy: shoulders sit above the hips, both inside the bust, mirrored about the body.
const a = api.anatomy(proxy);
assert(a.shoulder('left').y > a.hip('left').y, 'shoulders above hips');
assert(a.shoulder('left').x > 0 && a.shoulder('right').x < 0, 'left/right shoulders mirror across the body');
const big = new THREE.Group(); big.userData = { familyBabyWidth: .4608, familyBabyHeight: .4608 };
assert(Math.abs(api.anatomy(big).k - 2) < 1e-9, 'limb reach scales with the baby portrait size');

// A new GLB replacing a fallback updates the proxy without creating a second baby.
const oldRightFoot = sources.rightFoot; // The loader swaps this visible foot after proxy registration.
const footParent = oldRightFoot.parent;
footParent.remove(oldRightFoot);
const newRightFoot = new THREE.Mesh(geometry, material('right_foot_loaded'));
footParent.add(newRightFoot);
assert.equal(api.attach(proxy, walker), true, 'rebind when the source foot changes');
assert.equal(api.debugSnapshot().refreshed, 1, 'a replaced GLB triggers exactly one refresh');
assert.equal(api.attach(proxy, walker), true);
assert.equal(api.debugSnapshot().refreshed, 1, 'no redundant refresh from an unchanged source');
assert.equal(proxy.getObjectByName('family_baby_kicking_limbs').children.length, 4, 'replacement still has all limbs');
assert(!disposed.includes('geometry'), 'refresh never frees walker-owned geometry');

// Hook: poses visible carried babies, restores rest pose after the frame.
proxy.parent = new THREE.Group();
const posed = hooks[0].before({});
assert.equal(posed.length, 1, 'visible carried baby is posed');
const moved = proxy.getObjectByName('family_baby_kicking_limbs').children.some(p => p.rotation.x !== 0 || p.rotation.z !== 0);
assert(moved, 'limbs wave/kick during the frame');
hooks[0].after({}, posed);
assert(proxy.getObjectByName('family_baby_kicking_limbs').children.every(p => p.rotation.x === 0 && p.rotation.y === 0 && p.rotation.z === 0), 'rest pose restored after the frame');
proxy.visible = false;
assert.equal(hooks[0].before({}).length, 0, 'a hidden proxy (baby in its basket) is not animated');

// Detach: only cloned materials are disposed; walker geometry survives.
disposed.length = 0;
api.detach(proxy);
assert.equal(api.isAttached(proxy), false, 'limbs removed');
assert(!disposed.includes('geometry'), 'shared walker geometry is never disposed');
assert.equal(disposed.filter(n => n.endsWith('_clone')).length, 4, 'each cloned limb material disposed');
assert.equal(api.debugSnapshot().groups, 0, 'hook no longer tracks the detached proxy');

// Wiring: burdens attach after registration and detach before disposal.
// test-back-carried-burdens.js checks the live stow runtime preserves limb depth.
const burdens = fs.readFileSync('docs/js/family-baby-burdens.js', 'utf8');
assert(burdens.indexOf('entry.burden = burden;\n    window.FamilyBabyLimbs?.attach?.(group, walker);') > 0, 'limbs attach after registerBurden (never colliders)');
assert.match(burdens, /function disposeVisual\(group\) \{\n    window\.FamilyBabyLimbs\?\.detach\?\.\(group\);/, 'limbs detach before proxy disposal');
assert.match(burdens, /familyBabyFlying = true/, 'thrown baby flails');
assert(burdens.includes('FamilyBabyLimbs?.attach?.(entry.burden.group, walker)'), 'sync retries late GLB sources');
const family = fs.readFileSync('docs/js/romance-family.js', 'utf8');
assert(family.includes("if (phase === 'basket') window.FamilyBabyLimbs?.balanceWalker"), 'only newborns are rebalanced');
const romanceConfig = fs.readFileSync('docs/config/romance-config.js', 'utf8');
assert(romanceConfig.includes('basket: { body: 0.32, head: 0.50, hand: 1.20, foot: 1.20 }'), 'head ratio is smaller while both GLB extremities are larger');
const html = fs.readFileSync('docs/index.html', 'utf8');
assert(html.indexOf('js/family-baby-limbs.js?v=') > 0 && html.indexOf('js/family-baby-limbs.js?v=') < html.indexOf('js/family-baby-burdens.js?v='),
  'limbs module loads before family-baby-burdens.js');
console.log('PASS family baby kicking limbs: cloned walker GLBs, outlines, depth policy, restoring hook, safe disposal');
