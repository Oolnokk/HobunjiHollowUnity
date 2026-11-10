#!/usr/bin/env node
'use strict';

// Weapon-root ownership (not being parented, a slot-map lookup, or any timer)
// determines the lifetime of its authored rope and all head layers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'); // Uses the live Grapple-Flail recipe.
const runtime = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // Exercises actual assembly construction and cleanup.
const effectsRuntime = fs.readFileSync('docs/js/weapon-layer-effects.js', 'utf8'); // Verifies late-created particle materials are tracked for root-GC cleanup.
const equipment = fs.readFileSync('docs/js/equipment-panel.js', 'utf8'); // Validates real player equipment cache ownership without initializing inventory UI.
assert.match(equipment, /function ownsCachedToolRoot\(root\)/, 'EquipmentPanel exports its authoritative cached tool identity for diagnostics');
const vector = () => ({ set() {}, copy() {} }); // Texture UV parameters are not modified after creation in this regression.
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  toArray() { return [this.x, this.y, this.z]; }
}
class Object3D {
  constructor() {
    this.parent = null;
    this.children = [];
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.userData = {};
    this.renderOrder = 0;
  }
  add(...objects) {
    for (const object of objects) {
      object.parent?.remove?.(object);
      object.parent = this;
      this.children.push(object);
    }
  }
  remove(object) {
    this.children = this.children.filter(child => child !== object);
    if (object.parent === this) object.parent = null;
  }
  traverse(callback) {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }
}
class Texture {
  constructor(image) {
    this.image = image;
    this.offset = vector();
    this.repeat = vector();
  }
  clone() { return new Texture(this.image); }
  dispose() { this.disposed = true; }
}
const images = {
  'rope_long.png': { width:16, height:40 },
  'grapple-flail_grapple-back.png': { width:30, height:60 },
  'grapple-flail_grapple-front.png': { width:30, height:60 },
  'flaky-head.png': { width:30, height:60 },
}; // A unique flaky sprite exercises real cached-promise eviction without altering the shipped art.
let failHeadOnce = true; // Used by the isolated failed-texture reassembly test.
let flakyLoadAttempts = 0; // Proves a retry actually requests the formerly failed asset again.
class TextureLoader {
  load(url, success, _progress, onError) {
    const key = url.split('/').at(-1);
    const image = images[key];
    if (!image) throw new Error('unexpected asset ' + key);
    if (key === 'flaky-head.png') {
      flakyLoadAttempts++;
      if (failHeadOnce) { failHeadOnce = false; onError(new Error('transient sprite load failure')); return; }
    }
    success(new Texture(image));
  }
}
class PlaneGeometry {
  constructor(width, height) { this.parameters = { width, height }; }
  dispose() { this.disposed = true; }
}
class MeshBasicMaterial {
  constructor(options) { Object.assign(this, options); }
  dispose() { this.disposed = true; }
}
class CanvasTexture extends Texture {
  constructor(canvas) { super(canvas); }
}
class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.isMesh = true;
  }
}
const THREE = {
  Vector3, Quaternion:class {}, Matrix4:class {}, TextureLoader, PlaneGeometry, MeshBasicMaterial,
  CanvasTexture, Mesh, Group:Object3D, DoubleSide:2, ClampToEdgeWrapping:3, sRGBEncoding:3001,
  LinearFilter:1006, NearestFilter:1003,
}; // Browser-independent Three-shaped objects are sufficient to test real async setup and lifetime.
const document = {
  currentScript:{ src:'https://example.test/js/weapon-sprite-assemblies.js' },
  createElement(type) {
    assert.equal(type, 'canvas');
    const canvas = {
      width:0,
      height:0,
      getContext() {
        return {
          drawImage() {},
          getImageData(_x, _y, width, height) {
            const data = new Uint8ClampedArray(width * height * 4); // Opaque center stripe exercises the real rope-crop loop.
            for (let y = 0; y < height; y++) for (let x = 4; x < width - 4; x++) data[(y * width + x) * 4 + 3] = 255;
            return { data };
          },
          putImageData() {},
        };
      },
    };
    return canvas;
  },
};
const window = {
  WEAPON_SPRITE_ASSEMBLY_CONFIG:null,
  ColorFill:{ shadeFillPixels() {} },
  RuntimeFrameScheduler:{ register() {} },
}; // Explicitly expose the same 3D assembly API used by gameplay.
vm.runInNewContext(registry, { window });
let now = 100;
vm.runInNewContext(runtime, {
  window, document, URL, THREE, performance:{ now() { return now; } },
  location:{ href:'https://example.test/game.html', pathname:'/game.html' },
  setTimeout() {}, console,
});
const api = window.HobunjiWeaponSpriteAssemblies;
const handleImage = { width:450, height:1204 }; // Real handle-pixel coordinates drive connector and head geometry.
const plane = new Mesh(new PlaneGeometry(.5, 1204/900), new MeshBasicMaterial({ map:new Texture(handleImage) }));
const root = new Object3D();
root.userData.toolPlane = plane;
root.add(plane);
api.decorate(root, 'grappleFlail', { shapeKey:'grappleFlail' }, { THREE });

(async () => {
  for (let i = 0; i < 20 && !api.debugSnapshot()[0]?.loaded; i++) await Promise.resolve();
  const loaded = api.debugSnapshot()[0];
  assert(loaded?.loaded, 'live async setup creates the rope and both head layers');
  assert.equal(loaded.connector, 'rope');
  assert(root.children.some(child => child.name === 'flail_ruin_rope'), 'the reusable root owns its rendered connector');
  const head = root.children.find(child => child.name === 'grappleFlail_flail_head'); // Parent group is the two-layer metal grapple head.
  assert(head && head.children.length === 2, 'the complete composite head exists before detachment');

  // Both visible hands own complete real flails, not a copied static sprite
  // with a connector that remains attached to the hidden original weapon.
  const dualMain = new Mesh(new PlaneGeometry(.5, 1204/900), new MeshBasicMaterial({ map:new Texture(handleImage) })); // Main-hand flail carries its own pendulum.
  const dualOff = new Mesh(new PlaneGeometry(.5, 1204/900), new MeshBasicMaterial({ map:new Texture(handleImage) })); // Offhand flail must have a separate connector and head.
  assert.equal(api.syncDualWield(root, dualMain, dualOff, true), false, 'source stays visible while copies load');
  for (let i = 0; i < 25 && api.debugSnapshot().filter(item => item.dualFlail?.replica && item.loaded).length !== 2; i++) await Promise.resolve();
  assert.equal(api.debugSnapshot().filter(item => item.dualFlail?.replica && item.loaded).length, 2, 'both replica assemblies finish loading');
  assert.equal(api.syncDualWield(root, dualMain, dualOff, true), true, 'switch to both real connectors only when complete');
  assert.equal(root.children.find(child => child.name === 'flail_ruin_rope').visible, false, 'original single rope is hidden');
  assert.equal(head.visible, false, 'original single head is hidden');
  const dualMainRope = dualMain.children.find(child => child.name === 'flail_ruin_rope'); // Per-hand connector instance for render and disposal checks.
  const dualOffRope = dualOff.children.find(child => child.name === 'flail_ruin_rope'); // The second connector must never reuse the first object.
  const dualMainHead = dualMain.children.find(child => child.name === 'grappleFlail_flail_head'); // Complete main-hand head, including every authored layer.
  const dualOffHead = dualOff.children.find(child => child.name === 'grappleFlail_flail_head'); // Complete offhand head, independently positioned.
  assert(dualMainRope && dualOffRope && dualMainRope !== dualOffRope, 'the two ropes are independent scene objects');
  assert(dualMainHead && dualOffHead && dualMainHead !== dualOffHead, 'the two heads are independent scene objects');
  assert.equal(dualMainHead.children.length, 2);
  assert.equal(dualOffHead.children.length, 2);
  assert.equal(api.syncDualWield(root, dualMain, dualOff, false), false, 'leaving dual wield restores the source');
  assert.equal(root.children.find(child => child.name === 'flail_ruin_rope').visible, true, 'original connector returns');
  assert.equal(head.visible, true, 'original head returns');
  assert.equal(api.debugSnapshot().length, 1, 'dual-wield teardown drops both replica physics states');
  assert.equal(dualMain.children.length, 0, 'main-hand rope and head were disposed');
  assert.equal(dualOff.children.length, 0, 'offhand rope and head were disposed');

  // Shipped procedural-hand dependencies can omit toolMeshMap entirely.
  window.ProceduralHandAttachments = { gameDeps:{ toolHolder:{ children:[] } } };
  now = 200;
  api.tick(0);
  now = 7000; // Previously destroyed both suspended parts at the 5-second boundary.
  api.tick(0);
  window.Combat = { deps:{ toolMeshMap:new Map([['weapon', {}]]) } }; // A stale slot-map entry must not control this root's lifetime.
  now = 314000; // More than five minutes of unequipped time.
  api.tick(0);
  assert(api.debugSnapshot()[0]?.loaded, 'cached flail survives an arbitrarily long detachment with no matching cache map');
  assert.equal(api.debugSnapshot()[0]?.lifetime, 'root-weak', 'mobile debug reports root-based weak registry ownership');
  assert.equal(api.debugSnapshot()[0]?.partsAttached, true, 'head and rope still share their preserved handle root');
  assert(root.children.includes(head), 'both head layers survive the detachment');
  const rope = root.children.find(child => child.name === 'flail_ruin_rope'); // Exact cached connector should remain intact across repeated slot switches.
  assert(rope, 'rope survives the same long detachment');
  assert(api.debugSnapshot()[0]?.detachedForMs > 300000, 'mobile diagnostics report long detachment without destruction');
  assert(!head.children[0].material.disposed, 'head materials are never disposed while the cached root remains alive');
  assert.equal(api.debugSnapshot()[0]?.cachedPlayerOwned, false, 'no exposed tool slot currently claims this still-live root');
  window.Combat.deps.toolMeshMap = new Map(); // Real integrations can omit the cached player handle from all combat/hand adapters.
  const ownerStart = equipment.indexOf('  function ownsCachedToolRoot(root) {'); // Uses production EquipmentPanel logic rather than duplicating identity checks.
  const ownerEnd = equipment.indexOf('\n  // Read-only bridge', ownerStart);
  assert(ownerStart >= 0 && ownerEnd > ownerStart, 'equipment ownership bridge has a stable, testable boundary');
  const ownsCachedToolRoot = new Function('deps', equipment.slice(ownerStart, ownerEnd) + '\nreturn ownsCachedToolRoot;')({ toolMeshMap: { weapon: root } });
  window.EquipmentPanel = { ownsCachedToolRoot }; // Injects the actual cached owner independently of optional runtime adapters.
  assert.equal(api.debugSnapshot()[0]?.cachedPlayerOwned, true, 'mobile diagnostics recognize EquipmentPanel as the true weapon owner');
  now += 12000; // A long gap does not convert debug ownership into an expiration deadline.
  api.tick(0);
  assert.equal(api.debugSnapshot()[0]?.loaded, true, 'ownership diagnostics do not interfere with weak-root assembly lifetime');

  root.parent = { isScene:true }; // Equipping uses this SAME cached root instead of requiring a fresh decorate call.
  assert.equal(api.debugSnapshot()[0]?.attached, true, 'equip exposes the preserved rope/head immediately');
  api.decorate(root, 'grappleFlail', { shapeKey:'grappleFlail' }, { THREE }); // Idempotent redecoration must not duplicate layers.
  assert.equal(root.children.filter(child => child.name === 'flail_ruin_rope').length, 1, 'redecoration never duplicates the connector');
  assert.equal(root.children.filter(child => child.name === 'grappleFlail_flail_head').length, 1, 'redecoration never duplicates the head');
  root.remove(rope);
  root.remove(head);
  assert.equal(api.debugSnapshot()[0]?.partsAttached, false, 'diagnostics reveal an external temporary reparenting mistake');
  api.decorate(root, 'grappleFlail', { shapeKey:'grappleFlail' }, { THREE });
  assert(root.children.includes(rope) && root.children.includes(head), 'redecoration recovers both original components without new texture loads');
  assert.equal(api.debugSnapshot()[0]?.partsAttached, true, 'mobile diagnostics confirm both parts are repaired');
  root.remove(rope);
  root.remove(head);
  plane.updateWorldMatrix = () => {}; // The real pre-render tick repairs the mesh tree before the pose update.
  const originalImage = plane.material.map.image; // A missing base frame stops synthetic 3D math after attachment repair.
  plane.material.map.image = null;
  api.tick(0);
  plane.material.map.image = originalImage;
  assert(root.children.includes(rope) && root.children.includes(head), 'the equipped pre-render tick repairs both parts without a fresh decorate call');
  assert.equal(api.debugSnapshot()[0]?.repairedParts, 4, 'mobile diagnostics count two repairs from decorate and two from the automatic tick');
  root.parent = null;
  api.drop(root); // Owner disposal remains authoritative for both gameplay and authoring preview.
  assert.equal(api.debugSnapshot().length, 0, 'explicit teardown unregisters the root immediately');
  assert.equal(root.children.length, 1, 'explicit teardown removes connector and head but keeps the handle plane');
  assert(head.children.every(child => child.material.disposed), 'explicit teardown disposes every head-layer material');

  const discarded = new Object3D(); // A superseded cached loadout no longer referenced by either current equipment map.
  discarded.userData.toolPlane = new Mesh(new PlaneGeometry(.5, 1204/900), new MeshBasicMaterial({map:new Texture(handleImage)}));
  discarded.add(discarded.userData.toolPlane);
  api.decorate(discarded, 'grappleFlail', { shapeKey:'grappleFlail' }, { THREE });
  for (let i = 0; i < 20 && !api.debugSnapshot()[0]?.loaded; i++) await Promise.resolve();
  assert.equal(api.debugSnapshot().length, 1, 'retired equipment builds using the same live assembly API');
  now = 326100; // Continue from the prior EquipmentPanel ownership check without rewinding the synthetic clock.
  api.tick(0);
  now = 900000;
  api.tick(0);
  assert.equal(api.debugSnapshot().length, 1, 'an unparented but still externally referenced actor is never silently mutilated');
  assert(discarded.children.find(child => child.name === 'flail_ruin_rope'), 'an idle NPC/preview keeps its suspension too');
  api.drop(discarded); // Retirement/disposal is an explicit ownership event; unreachable roots are weakly collectible.
  assert.equal(api.debugSnapshot().length, 0, 'retired actor cleanup explicitly releases the registry entry');
  assert.equal(discarded.children.length, 1, 'retirement leaves only the external base plane');

  const flakyRecipe = JSON.parse(JSON.stringify(window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.grappleFlail)); // Keep canonical geometry, change only the simulated texture path.
  flakyRecipe.flail.head.layers[0].sprite = 'assets/toolsprites/flaky-head.png';
  const flakyRoot = new Object3D();
  flakyRoot.userData.toolPlane = new Mesh(new PlaneGeometry(.5, 1204/900), new MeshBasicMaterial({ map:new Texture(handleImage) }));
  flakyRoot.add(flakyRoot.userData.toolPlane);
  api.decorate(flakyRoot, 'flakyFlail', { shapeKey:'grappleFlail', weaponAssembly:flakyRecipe }, { THREE });
  for (let i = 0; i < 40 && !api.debugSnapshot()[0]?.setupFailed; i++) await Promise.resolve();
  assert.equal(api.debugSnapshot()[0]?.setupFailed, true, 'a failed async image request leaves a diagnosable, repairable assembly');
  assert.equal(flakyLoadAttempts, 1, 'initial flaky texture was requested once');
  now += 3000;
  flakyRoot.parent = { isScene:true }; // Only an actually equipped root triggers repair; dormant caches stay dormant.
  api.tick(0);
  flakyRoot.parent = null; // Synthetic Three stub cannot calculate holder matrices, so finish load in cached state.
  for (let i = 0; i < 40 && !api.debugSnapshot()[0]?.loaded; i++) await Promise.resolve();
  assert.equal(flakyLoadAttempts, 2, 'failed image promise is evicted, allowing the source to load on retry');
  assert.equal(api.debugSnapshot()[0]?.loaded, true, 'retry recreates the genuine flail rope and multilayer head');
  assert.equal(api.debugSnapshot()[0]?.setupFailed, false, 'repaired cache no longer reports failure');
  assert.equal(flakyRoot.children.filter(child => child.name === 'flail_ruin_rope').length, 1, 'retry creates exactly one rope');
  assert.equal(flakyRoot.children.find(child => child.name === 'flakyFlail_flail_head')?.children.length, 2, 'retry restores both head layers');
  api.drop(flakyRoot);
  assert.equal(api.debugSnapshot().length, 0, 'repaired weapon still supports deterministic disposal');

  // Head/shaft fire motes are allocated only on an active frame, after the initial
  // flail GPU-resource scan. The root finalizer must also own these late materials.
  const effectsWindow = {}; // Separate effects instance avoids changing the earlier headless assembly fixture.
  THREE.SpriteMaterial = class extends MeshBasicMaterial {
    constructor(props) { super(props); this.color = { set() {} }; }
  };
  THREE.Sprite = class extends Object3D {
    constructor(material) { super(); this.material = material; this.layers = { set() {} }; this.scale = { setScalar() {} }; }
  };
  vm.runInNewContext(effectsRuntime, { window:effectsWindow, document, console, THREE });
  const fireOwner = new Object3D(); // Mock parent for a fire layer on a flail head.
  const fireEmitter = {
    config:{ type:'fire', rate:2, size:.035, life:.65 }, sourceLayer:{ id:'fuel' }, image:{ width:4, height:4 },
    sources:[5], group:fireOwner, renderOrder:2, unit:1, particles:[], pool:[], accumulation:0,
    worldRise:false, visualScale:1, clusters:null, anchors:null, texture:new Texture({ width:16, height:16 }),
  }; // Minimal real interleaved emitter: one sprite created by production stepFire().
  const fireResources = new Set(); // Represents the same mutable finalizer resource set owned by the weapon root.
  const fireState = { THREE, gcResources:fireResources, fireEmitters:[fireEmitter], itemKey:'grappleFlail', masteryLevel:()=>5 };
  effectsWindow.HobunjiLayeredWeaponEffects.stepFire(fireState, .5);
  assert.equal(fireEmitter.particles.length, 1, 'production fire step spawns a material after assembly construction');
  const newFireMaterial = fireEmitter.particles[0].sprite.material;
  assert(fireResources.has(newFireMaterial), 'late sprite material is registered with the weak-root resource finalizer');
  assert(!fireResources.has(fireEmitter.texture), 'the shared fire texture is never finalized with an individual weapon');
  effectsWindow.HobunjiLayeredWeaponEffects.dispose(fireState);
  assert(newFireMaterial.disposed, 'explicit weapon disposal still releases the dynamically registered particle material');
  console.log('flail root-lifetime retention: PASS (long detach, self-repair, texture retry, late particle cleanup)');
})().catch(error => { console.error(error); process.exitCode = 1; });
