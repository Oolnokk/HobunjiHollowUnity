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
    clone(recursive = true) {
      const copy = this.isMesh ? new Mesh(this.geometry, this.material) : new Obj(); // Mirrors THREE.Object3D.clone's shared geometry/material semantics.
      copy.name = this.name; copy.visible = this.visible; copy.userData = { ...this.userData };
      copy.position.set(this.position.x, this.position.y, this.position.z);
      copy.rotation.set(this.rotation.x, this.rotation.y, this.rotation.z);
      copy.scale.set(this.scale.x, this.scale.y, this.scale.z);
      copy.layers.mask = this.layers.mask; copy.det = this.det;
      if (recursive) for (const child of this.children) copy.add(child.clone(true));
      return copy;
    }
    getWorldScale(out) {
      let x = this.worldScale, y = this.worldScale, z = this.worldScale;
      for (let node = this; node; node = node.parent) { // Model parent scaling is what the carried clone inherits.
        x *= node.scale.x; y *= node.scale.y; z *= node.scale.z;
      }
      return out.set(x, y, z);
    } }
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
  const hidden = new THREE.Group(); hidden.name = 'inactive_hand'; hidden.visible = false; hv.add(hidden); // The walker may retain hidden GLB fallback/helper subtrees.
  hidden.add(new THREE.Mesh(geometry, material('hidden_glb_' + side)));
  const hand = new THREE.Mesh(geometry, material(side + '_hand')); hand.name = 'CombinedMesh_MaterialSlots';
  hand.layers.mask = 0x2000000B; // Player/NPC hand passes: must NOT leak onto the baby clones.
  hv.add(hand); sources[side + 'Hand'] = hand;
  const claw = new THREE.Mesh(geometry, material(side + '_hand_claw')); hv.add(claw); sources[side + 'HandClaw'] = claw; // Multi-primitive models must retain the claws.
  const foot = new THREE.Group(); foot.name = side + '_foot'; feetRoot.add(foot);
  const fallback = new THREE.Mesh(geometry, material('fallback')); fallback.visible = false; foot.add(fallback); // Hidden fallback sphere is skipped.
  const glb = new THREE.Mesh(geometry, material(side + '_foot')); foot.add(glb); sources[side + 'Foot'] = glb;
  const nail = new THREE.Mesh(geometry, material(side + '_foot_nail')); foot.add(nail); sources[side + 'FootNail'] = nail; // Second independent GLB primitive.
}
const walker = { root: walkerRoot };
const proxy = new THREE.Group();
proxy.userData = { familyBabyWidth: .2304, familyBabyHeight: .2304,
  familyBabyGripAnchors: { posterior: { x: 0, y: .112, z: 0 }, neck: { x: -.008, y: .204, z: 0 } } };
const bust = new THREE.Mesh(geometry, material('bust')); proxy.add(bust);

const found = api.sourceLimbs(walker);
assert.equal(found.hand.left, sources.leftHand, 'left hand GLB found under its rig visual');
assert.equal(found.foot.right, sources.rightFoot, 'visible right foot GLB found, hidden fallback skipped');
walkerRoot.visible = false; // The live baby NPC hides during carrying, but its 3D source parts still exist.
assert.equal(api.sourceLimbs(walker).hand.left, sources.leftHand, 'hidden walker parent does not suppress carried limb sources');
walkerRoot.visible = true;

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
assert.equal(meshes.length, 8, 'all eight visible body/claw and foot/nail primitives are present, with hidden groups excluded');
for (const mesh of meshes) {
  assert.equal(mesh.geometry, geometry, 'limb shares the walker GLB geometry');
  assert(!Object.values(sources).some(src => src.material === mesh.material), 'limb owns a cloned material');
  assert.equal(mesh.layers.mask, 0b11, 'world + shell-outline layers only (curved 3D gets generated outline)');
  assert.equal(mesh.userData.shattercaskKeepsOwnDepth, true, 'excluded from the back-stow transparent PNG sandwich');
  assert.notEqual(mesh.userData.noOutline, true, '3D limbs are not suppressed from outlines');
}
assert.equal(proxy.children[0], bust, 'bust stays children[0] (refreshProxyArt texture swap relies on it)');
assert.equal(meshes.filter(m => m.material.name.includes('fallback')).length, 0, 'hidden fallback feet are never copied to a carried child');
assert.equal(meshes.filter(m => m.material.name.includes('hidden_glb')).length, 0, 'invisible GLB subtrees do not pollute the carried model');
assert(meshes.some(m => m.material.name.includes('hand_claw')), 'independently authored hand claws survive the carry clone');
assert(meshes.some(m => m.material.name.includes('foot_nail')), 'independently authored foot nails survive the carry clone');
const carriedScale = () => Math.abs(proxy.getObjectByName('family_baby_left_hand')?.scale?.x || 0); // Proxy uses world-scaled source visuals.
assert(Math.abs(carriedScale() - 1.2) < 1e-8, 'carried hands initially match corrected world newborn size');
assert.equal(api.balanceWalker(walker, { hand: 1.25, foot: 1.25 }), 4, 'late proportion change updates the same source visuals');
assert.equal(api.attach(proxy, walker), true, 'same-mesh scale change invalidates its previously cloned proxy');
assert.equal(api.debugSnapshot().refreshed, 1, 'scale change replaces old clone exactly once');
assert(Math.abs(carriedScale() - 1.25) < 1e-8, 'carried hands inherit updated scale, not a stale 1.20 clone');
assert.equal(api.attach(proxy, walker), true, 'same sources and same resize revision are stable');
assert.equal(api.debugSnapshot().refreshed, 1, 'no per-tick re-cloning when already balanced');

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
assert.equal(api.debugSnapshot().refreshed, 2, 'a replaced GLB triggers one extra refresh');
assert.equal(api.attach(proxy, walker), true);
assert.equal(api.debugSnapshot().refreshed, 2, 'no redundant refresh from an unchanged source');
assert.equal(proxy.getObjectByName('family_baby_kicking_limbs').children.length, 4, 'replacement still has all limbs');
assert(!disposed.includes('geometry'), 'refresh never frees walker-owned geometry');
const newGeometry = { attributes: { position: { count: 111 } } }; // In-place GLB geometry updates keep the Mesh object identity.
newRightFoot.geometry = newGeometry;
assert.equal(api.attach(proxy, walker), true, 'in-place resource replacement refreshes the clone');
assert.equal(api.debugSnapshot().refreshed, 3, 'geometry replacement refreshes once');
const carriedFoot = proxy.getObjectByName('family_baby_right_foot');
const hasUpdatedGeometry = () => { let found = false; carriedFoot.traverse(node => { if (node.isMesh && node.geometry === newGeometry) found = true; }); return found; };
assert(hasUpdatedGeometry(), 'recloned right-foot hierarchy contains the updated geometry');
assert.equal(api.attach(proxy, walker), true, 'the new source geometry stays stable');
assert.equal(api.debugSnapshot().refreshed, 3, 'same geometry never triggers unnecessary updates');
const nail = sources.rightFootNail; // An unchanged first mesh must not mask updates to the second GLB primitive.
nail.geometry = { attributes: { position: { count: 75 } } };
assert.equal(api.attach(proxy, walker), true, 'secondary foot primitive change refreshes the complete hierarchy');
assert.equal(api.debugSnapshot().refreshed, 4, 'second primitive refreshes just once');
assert.equal(api.attach(proxy, walker), true);
assert.equal(api.debugSnapshot().refreshed, 4, 'unchanged multi-material model is stable');

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
assert.equal(disposed.filter(n => n.endsWith('_clone')).length, 8, 'all cloned body and claw/nail materials are disposed');
assert.equal(api.debugSnapshot().groups, 0, 'hook no longer tracks the detached proxy');

// Wiring: burdens attach after registration and detach before disposal.
// test-back-carried-burdens.js checks the live stow runtime preserves limb depth.
const burdens = fs.readFileSync('docs/js/family-baby-burdens.js', 'utf8');
assert(burdens.indexOf('entry.burden = burden;\n    window.FamilyBabyLimbs?.attach?.(group, walker);') > 0, 'limbs attach after registerBurden (never colliders)');
assert.match(burdens, /function disposeVisual\(group\) \{\n    window\.FamilyBabyLimbs\?\.detach\?\.\(group\);/, 'limbs detach before proxy disposal');
assert.match(burdens, /familyBabyFlying = true/, 'thrown baby flails');
assert(burdens.includes('window.FamilyBabyLimbs?.attach?.(group, walker); // Shared refresh checks late-loaded GLBs'), 'existing proxy refresh checks late GLB and size changes once per family update');
const family = fs.readFileSync('docs/js/romance-family.js', 'utf8');
assert(family.includes("phase === 'child' ? cfg().childLimbModifiers : cfg().phaseScales?.[phase]"),
  'each family growth stage uses its shared, configurable limb proportions');
assert(family.includes("if (phase === 'basket' || (limbScale && (Number(limbScale.hand) !== 1 || Number(limbScale.foot) !== 1)))"),
  'babies always receive their tuned limbs, while toddlers/children only need rebalance when a global non-default multiplier is authored');
const romanceConfig = fs.readFileSync('docs/config/romance-config.js', 'utf8');
const configWindow = {};
vm.runInNewContext(romanceConfig, { window: configWindow });
const { phaseScales, childLimbModifiers } = configWindow.HobunjiRomanceConfig.family;
assert.deepEqual({ ...phaseScales.basket }, { body: .28, width: .59, height: .28, head: .65, hand: 1.66, foot: 1.62 },
  'fallback newborn keeps its body and limbs and uses the 65% adult head');
assert.deepEqual({ ...phaseScales.toddler }, { body: .48, width: .59, height: .48, head: .65, hand: 1.66, foot: 1.62 },
  'toddler fallback retains its taller body and uses the same head ratio');
assert.deepEqual({ ...childLimbModifiers }, { hand: 1, foot: 1 }, 'older child limb defaults stay unchanged');
const html = fs.readFileSync('docs/index.html', 'utf8');
assert(html.indexOf('js/family-baby-limbs.js?v=') > 0 && html.indexOf('js/family-baby-limbs.js?v=') < html.indexOf('js/family-baby-burdens.js?v='),
  'limbs module loads before family-baby-burdens.js');
console.log('PASS family baby kicking limbs: complete species GLBs, resize invalidation, outlines, depth policy, restoring hook, safe disposal');
