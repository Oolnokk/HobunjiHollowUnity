#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
}
class Matrix4 {
  constructor(value = 0) { this.value = value; }
  copy(other) { this.value = other.value; return this; }
}
class Group {
  constructor() { this.isObject3D = true; this.parent = null; this.children = []; this.visible = true;
    this.matrixWorld = new Matrix4();
    this.position = new Vector(); this.rotation = new Vector(); this.scale = new Vector(1, 1, 1);
    this.userData = {}; this.layers = { mask: 1, enable(bit) { this.mask |= 1 << bit; }, set(bit) { this.mask = 1 << bit; } }; }
  add(node) { node.parent?.remove(node); node.parent = this; this.children.push(node); }
  remove(node) { this.children = this.children.filter(child => child !== node); if (node.parent === this) node.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
  updateWorldMatrix() {}
  getWorldPosition(out) { return out.copy(this.position); }
}
class Mesh extends Group { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
class PlaneGeometry { constructor(w, h) { this.width = w; this.height = h; } dispose() { this.disposed = true; } }
class MeshBasicMaterial { constructor(options) { Object.assign(this, options); } dispose() { this.disposed = true; } }
const THREE = { Group, Mesh, Matrix4, Vector3: Vector, PlaneGeometry, MeshBasicMaterial, FrontSide: 0, LessEqualDepth: 3 }; // Small structural stand-in for actual THREE objects.
const scene = new Group(), babyRoot = new Group(), spouseRoot = new Group(), portrait = new Group();
scene.isScene = true;
babyRoot.position.set(6.5, 0, 6.5); spouseRoot.position.set(6.7, 0, 6.5);
scene.add(babyRoot); scene.add(spouseRoot); spouseRoot.add(portrait);
const babyAvatar = { userData: { frontTexture: {}, backTexture: {}, portraitModelWidth: .3, portraitModelHeight: .3 } };
const spouseAvatar = portrait; spouseAvatar.userData.portraitModelHeight = .95;
const child = { id: 'test-baby', name: 'Pip', otherParentId: 'spouse-id', carryBy: null };
const babyWalker = { rec: { id: child.id }, area: 'interior', root: babyRoot, avatarGroup: babyAvatar };
const spouseWalker = { rec: { id: 'spouse-id' }, area: 'interior', root: spouseRoot, avatarGroup: spouseAvatar };
let held = null, back = null, persistCount = 0, registered = 0, migrationCount = 0;
let currentArea = 'interior'; // Simulated active player zone changes independently of the baby's zone.
const areaRecords = new Map(); // Simulate an unloaded/rebuilt farmhouse zone losing only its old in-memory Burden record.
const api = {
  registerBurden(options) {
    assert.equal(Object.hasOwn(options, 'scene'), false, 'registry resolves the actual world scene, not NPC rig group');
    assert.equal(options.kind, 'familyBaby'); assert.equal(options.invulnerable, true); assert.equal(options.noHang, true);
    registered++;
    const burden = { ...options, col: 6, row: 6, carried: false, flying: false, exploded: false };
    areaRecords.set(burden.id, burden);
    return burden;
  },
  rebindRegisteredBurden(item) { areaRecords.set(item.id, item); return true; },
  pickUp(item) { held = item; item.carried = true; item.onPickup(item); return true; },
  heldBurdenInfo: () => held && { id: held.id },
  backCarriedInfo: () => back && { id: back.id },
  takeFromBack() { held = back; back = null; return !!held; },
  transferCarriedBurdenToArea(area, item) { assert(item.carried); item.mapId = area; migrationCount++; return true; },
  discardBurden(item) { if (held === item) held = null; if (back === item) back = null;
    item.onLost?.(item); item.group.parent?.remove(item.group); return true; },
};
const window = {
  THREE, Shattercasks: api, PNGPlaneAvatar: { buildSinglePlaneAvatarModel() {} },
  RomanceSystem: { helpers: { deps: () => ({ getCurrentArea: () => currentArea }), findWalker: id => id === 'spouse-id' ? spouseWalker : null } },
};
vm.runInNewContext(fs.readFileSync('docs/js/png-plane-outline-occluder.js', 'utf8'), { window, THREE });
const pngDepth = window.PngPlaneOutlineOccluder;
let clock = 1000; // The adjacent visible/depth draws share a fresh snapshot.
vm.runInNewContext(fs.readFileSync('docs/js/portrait-plane-outline-parity.js', 'utf8'), { window, performance: { now: () => clock } });
vm.runInNewContext(fs.readFileSync('docs/js/family-baby-burdens.js', 'utf8'), { window, console });
const carry = window.FamilyBabyBurdens, persist = () => persistCount++;
assert(carry.sync(child, babyWalker, 'basket', persist));
assert.equal(registered, 1, 'one shared physical baby burden registered');
assert.equal(carry.isProxyActive(child.id), false, 'the baby NPC is command-targetable in its basket');
areaRecords.clear(); // Simulate Shattercasks.releaseZone('interior') and a rebuilt home scene.
assert.equal(carry.sync(child, babyWalker, 'basket', persist).burden, areaRecords.get('family_baby_test-baby'),
  'the same Burden is re-registered after an interior scene rebuild');
assert.equal(registered, 1, 'scene recovery must not create a second physical infant');
assert.equal(babyRoot.visible, true, 'baby NPC is visible in cradle');
assert.equal(carry.takeIntoArms(child, babyWalker, persist), true);
assert.equal(babyRoot.visible, false, 'baby NPC hides while player holds its lightweight proxy');
assert.equal(child.carryBy, 'player'); assert.equal(child.carryPose, 'arms');
assert.equal(carry.isProxyActive(child.id), true, 'an invisible carried baby cannot open its ordinary NPC wheel');
assert.equal(carry.sync(child, babyWalker, 'basket', persist).burden.id, 'family_baby_test-baby');
back = held; held = null; carry.sync(child, babyWalker, 'basket', persist);
assert.equal(child.carryPose, 'back', 'player stowing is observed without a second carry implementation');
const stowedFaces = back.group.children;
for (const [index, face] of stowedFaces.entries()) {
  assert(face.layers.mask & (1 << pngDepth.LAYER));
  assert.equal(face.userData.__hobunjiPortraitOutlineParity, true, 'carry-specific face installs the real visible-pose adapter');
  face.material.depthWrite = false; face.material.colorWrite = true;
  face.matrixWorld.value = 10 + index;
  face.onBeforeRender(null, scene, null, null, face.material); face.onAfterRender();
  face.matrixWorld.value = 50 + index; // Simulate the composed color pose being undone before the depth replay.
}
clock += 10;
const depthCamera = new Group();
let depthDraws = 0;
pngDepth.init({ camera: depthCamera, renderer: { render(root, camera) {
  assert.equal(root, scene); assert.equal(camera.layers.mask, 1 << pngDepth.LAYER);
  for (const [index, face] of stowedFaces.entries()) {
    assert.equal(face.material.depthWrite, true); assert.equal(face.material.colorWrite, false);
    assert.equal(face.material.depthFunc, THREE.LessEqualDepth); assert.equal(face.material.alphaTest, .35);
    face.onBeforeRender(null, root, camera, null, face.material);
    assert.equal(face.matrixWorld.value, 10 + index, 'depth-only infant silhouette follows the rendered pose');
    face.onAfterRender();
    assert.equal(face.matrixWorld.value, 50 + index, 'depth-only pose is restored');
  }
  depthDraws++;
} } });
pngDepth.renderDepth(scene);
assert.equal(depthDraws, 1, 'stowed child participates in the existing PNG outline depth pass');
pngDepth.renderDepth(scene);
assert.equal(depthDraws, 2, 'repeat draw preserves the same visible pose and restores again');
for (const face of stowedFaces) { assert.equal(face.material.depthWrite, false); assert.equal(face.material.colorWrite, true); }
assert.equal(depthCamera.layers.mask, 1, 'camera layer restored after depth replay');
held = back; back = null; carry.sync(child, babyWalker, 'basket', persist);
assert.equal(child.carryPose, 'arms', 'player retrieving from back returns to arms');
const item = held; held = null; item.carried = false; item.flying = true;
item.onThrow(item);
carry.sync(child, babyWalker, 'basket', persist);
assert.equal(babyRoot.visible, false, 'airborne child remains a single proxy; no duplicate NPC returns during flight');
assert.equal(child.carryBy, 'player', 'spouse does not take over until the flight safely lands');
item.col = 7; item.row = 8; item.group.position.set(7.5, 0, 8.5); item.onImpact(item);
assert.equal(item.flying, false, 'shared physical impact stops the baby flight');
assert.equal(babyRoot.visible, true, 'original baby NPC returns only after landing');
assert.equal(child.carryBy, null); assert.equal(child.carrySpot.area, 'interior'); assert.equal(babyRoot.visible, true);
assert.equal(carry.isProxyActive(child.id), false, 'the baby NPC becomes command-targetable after landing');
pngDepth.renderDepth(scene);
assert.equal(depthDraws, 2, 'hidden carry proxy does not participate in outline depth after landing');
assert.equal(carry.spouseCarry(child, babyWalker, spouseWalker, 'back', persist), true);
assert.equal(child.carryBy, 'spouse'); assert.equal(child.carryPose, 'back');
assert.equal(carry.snapshot().babies[0].parent, portrait.name || null);
assert.equal(carry.takeIntoArms(child, babyWalker, persist), true, 'shared physical burden hands off from spouse to player');
assert.equal(child.carryBy, 'player'); assert.equal(registered, 1, 'handoff does not duplicate baby');
held = null; item.carried = false; child.carryBy = null; item.mapId = 'farm';
const areaTransfers = []; // Existing NPC zone mover is the only way to switch the real infant's active map.
babyWalker.transferToArea = (area, tile) => { babyWalker.area = area; areaTransfers.push({ area, tile }); };
item.col = 11; item.row = 12; item.group.position.set(11.5, 0, 12.5);
item.onDrop(item);
assert.equal(babyWalker.area, 'farm', 'an infant landed outdoors changes their actual NPC area');
assert.equal(babyRoot.position.x, 11.5, 'landed baby NPC sits at the physical burden tile');
assert.equal(child.carrySpot.area, 'farm', 'saved landing follows the authoritative physical map');
item.carried = true; child.carryBy = 'spouse';
currentArea = 'farm'; // Player remains outside as the NPC takes the real baby through the farmhouse door.
assert.equal(carry.returnToBasket(child, { col: 6, row: 6 }), true);
assert.equal(babyWalker.area, 'interior', 'real infant returns through the normal NPC area mover');
assert.deepEqual(areaTransfers.map(x => x.area), ['farm', 'interior'], 'no improvised baby-only zone transfer');
assert.equal(babyRoot.position.x, 6.5, 'returning the baby really moves their authoritative NPC to the basket');
assert.equal(babyRoot.position.z, 6.5, 'basket return cannot leave the infant at their previous throw landing');
assert.equal(babyRoot.visible, true); assert.equal(child.carryBy, null);
assert.equal(item.mapId, 'farm', 'physical burden remains indexed in old zone until player enters home');
assert.equal(item.carried, true, 'invisible old-zone proxy cannot be selected as a duplicate baby');
assert.equal(carry.takeIntoArms(child, babyWalker, persist), false,
  'remote infant in the farmhouse cannot be teleported into the player hand from farm');
currentArea = 'interior'; carry.sync(child, babyWalker, 'basket', persist);
assert.equal(item.mapId, 'interior', 'physical baby follows authoritative NPC into the active home scene');
assert.equal(item.carried, false, 'on return home, the physical baby is normally available again');
assert(migrationCount > 0);
spouseWalker.area = 'farm';
assert.equal(carry.spouseCarry(child, babyWalker, spouseWalker, 'back', persist), false,
  'spouse cannot acquire the infant from a different unloaded area');
spouseWalker.area = 'interior';
const newerRoot = new Group(), newerFront = {}, newerBack = {};
newerRoot.position.set(6.5, 0, 6.5); scene.add(newerRoot);
const rebuiltWalker = { ...babyWalker, root: newerRoot,
  avatarGroup: { userData: { frontTexture: newerFront, backTexture: newerBack, portraitModelWidth: .37, portraitModelHeight: .42 } } };
const rebound = carry.sync(child, rebuiltWalker, 'basket', persist);
assert.equal(rebound.burden.group.children[0].material.map, newerFront, 'reloaded baby uses the live new portrait texture');
assert.equal(rebound.burden.group.children[1].material.map, newerBack, 'reloaded baby uses the live new back texture');
assert.equal(rebound.burden.group.children[0].geometry.width, .37, 'reloaded baby proxy updates its real scaled width');
assert.equal(rebound.burden.data.carryable.handTargets.left.x, .37 * .40, 'hand grips follow new infant dimensions');
assert(carry.sync(child, rebuiltWalker, 'toddler', persist), 'toddlers keep the physical carry proxy');
assert.equal(carry.snapshot().babies.length, 1);
carry.sync(child, rebuiltWalker, 'child', persist);
assert.equal(carry.snapshot().babies.length, 0, 'older child transition retires carrying proxy');
assert.equal(newerRoot.visible, true);
child.carryBy = 'spouse'; // Restore a save made while an NPC was holding the baby.
carry.sync(child, rebuiltWalker, 'basket', persist);
assert.equal(child.carryBy, null, 'reloading cannot teleport baby into spouse arms without a live attachment');
assert.equal(carry.snapshot().babies.length, 1);
// Silhouette-only rear art is for NPC occlusion, never a visible baby burden.
rebuiltWalker.avatarGroup.userData.backTextureUsesSilhouette = true;
const beforeBaking = carry.sync(child, rebuiltWalker, 'basket', persist).burden;
assert.equal(carry.snapshot().babies[0].rearArt, 'colored-front-fallback');
assert.equal(beforeBaking.group.children[1].material.map, newerFront,
  'rear-facing carried baby uses the real colored portrait');

// The newborn head bone is enlarged relative to its body. Capture the posed
// baby one time instead of shrinking the entire image into a flat card.
const bakedGeometry = new PlaneGeometry(.48, .59);
bakedGeometry.boundingBox = { min: { x: -.24, y: -.18 }, max: { x: .24, y: .41 } };
const skinned = { isSkinnedMesh: true, geometry: { id: 'live-head-scaled-geometry' }, position: new Vector(0, 0, .13) };
rebuiltWalker.avatarGroup.userData.visualCentroidLocalZ = .13; // A live rig's skinnedPlane.position.z already contains the avatar anchor.
rebuiltWalker.avatarGroup.userData.neckRig = { skinnedPlane: skinned, headScaleJoint: { scale: new Vector(1.8, 1.8, 1) } };
let bakeCalls = 0;
window.PNGPlaneAvatar = { meshBudget: { bakeStaticPortraitForCarry(_THREE, input) {
  assert.equal(input, skinned); bakeCalls++; return { geometry: bakedGeometry, flat: false };
} } };
const sameBurden = carry.sync(child, rebuiltWalker, 'basket', persist).burden;
assert.equal(sameBurden, beforeBaking, 'switching the artwork keeps the one physical baby');
assert.equal(sameBurden.group.children.length, 1, 'posed portrait replaces the flat proxy faces');
assert.equal(sameBurden.group.children[0].geometry, bakedGeometry);
assert(sameBurden.group.children[0].layers.mask & (1 << pngDepth.LAYER), 'baked portrait registers for outline depth');
assert.equal(sameBurden.group.children[0].userData.__hobunjiPortraitOutlineParity, true, 'baked proxy installs pose parity');
assert.equal(sameBurden.group.children[0].position.z, .13,
  'baked infant keeps the original portrait depth; the mesh anchor must not be added twice');
assert.equal(sameBurden.group.children[0].material[1].map, newerFront, 'posed rear face remains colored');
assert.equal(sameBurden.meshColliders[0], sameBurden.group.children[0], 'colliders use current geometry');
assert.equal(carry.snapshot().babies[0].artMode, 'posed-rig');
assert.equal(carry.snapshot().babies[0].dimensions.height,.42, 'hand coordinate dimensions stay tied to the original infant portrait');
assert.equal(sameBurden.group.userData.familyBabyPosedHeight,.59, 'enlarged head silhouette bounds are diagnostic, not grip position inputs');
assert.equal(carry.snapshot().babies[0].posedDimensions.height,.59, 'mobile debug distinguishes visible head bounds from the actual portrait-coordinate grip basis');
assert.equal(sameBurden.data.carryable.handTargets.left.x,.37*.4, 'head enlargement must not move portrait-local hand grip');
carry.sync(child, rebuiltWalker, 'basket', persist);
assert.equal(bakeCalls, 1, 'family ticks do not trigger per-frame skin baking');
const newestFront = { source: 'recolored' };
rebuiltWalker.avatarGroup.userData.frontTexture = newestFront;
carry.sync(child, rebuiltWalker, 'basket', persist);
assert.equal(sameBurden.group.children[0].material[0].map, newestFront, 'live front-art updates propagate');
assert.equal(sameBurden.group.children[0].material[1].map, newestFront, 'rear fallback tracks front art');
assert.equal(bakeCalls, 1, 'texture refresh does not re-bake');
// Head compensation can move the head bone without changing its scale.
// The rigid carry portrait must update for that offset, not for ordinary ticks.
const oldBakedMesh = sameBurden.group.children[0];
const shiftedGeometry = new PlaneGeometry(.48, .59);
shiftedGeometry.boundingBox = bakedGeometry.boundingBox;
window.PNGPlaneAvatar.meshBudget.bakeStaticPortraitForCarry = () => {
  bakeCalls++;
  return { geometry: shiftedGeometry, flat: false };
};
rebuiltWalker.avatarGroup.userData.neckRig.headScaleJoint.position = new Vector(0, .06, 0);
carry.sync(child, rebuiltWalker, 'basket', persist);
assert.equal(bakeCalls, 2, 'head-offset adjustment triggers exactly one replacement bake');
assert.equal(sameBurden.group.children[0].geometry, shiftedGeometry);
assert(sameBurden.group.children[0].layers.mask & (1 << pngDepth.LAYER), 'replacement portrait registers for outline depth');
assert.equal(sameBurden.group.children[0].userData.__hobunjiPortraitOutlineParity, true, 'replacement proxy installs pose parity');
pngDepth.prune();
assert.equal(pngDepth.snapshot().registered, 1, 'retired portrait registrations are pruned');
assert.equal(sameBurden.meshColliders[0], sameBurden.group.children[0], 'rebuild refreshes collision mesh references');
assert.equal(bakedGeometry.disposed, true, 'old baked geometry is disposed after the art swap');
assert.equal(oldBakedMesh.material[0].disposed, true, 'retired front material is disposed');
assert.equal(oldBakedMesh.material[1].disposed, true, 'retired back material is disposed');
carry.sync(child, rebuiltWalker, 'basket', persist);
assert.equal(bakeCalls, 2, 'unchanged head offsets do not rebake on following family ticks');
// Family restore may replace the JS child record without replacing the live burden.
// OnPickup must update the current authoritative child, not its original closure value.
const restoredRecord = { ...child, carryBy: null, carryPose: null };
carry.sync(restoredRecord, rebuiltWalker, 'basket', persist);
assert.equal(carry.takeIntoArms(restoredRecord, rebuiltWalker, persist), true);
assert.equal(restoredRecord.carryBy, 'player', 'pickup writes to the replacement family child record');
assert.equal(restoredRecord.carryPose, 'arms');
assert.equal(child.carryBy, null, 'pickup cannot mutate an obsolete family record');
carry.clear(); assert.equal(carry.snapshot().babies.length, 0);
assert(persistCount > 0);

// Execute the REAL Shattercasks registry as well. A rebuilt farmhouse scene previously orphaned
// the live child Burden even though it still existed in family state.
let activeArea = 'interior', activeScene = new Group();
const realWindow = { THREE, Combat: { deps: { getCurrentArea: () => activeArea } },
  GridTileAccessors: { getCurrentArea: () => activeArea, getActiveScene: () => activeScene } };
vm.runInNewContext(fs.readFileSync('docs/js/shattercasks.js', 'utf8'),
  { window: realWindow, performance: { now: () => 123 }, console });
const physical = realWindow.Shattercasks;
assert(physical?.rebindRegisteredBurden, 'scene registry exposes generic same-object rebind');
const realProxy = new Group(); realProxy.position.set(4.5, 0, 5.5); activeScene.add(realProxy);
const realBaby = physical.registerBurden({ id: 'family_baby_scene', mapId: 'interior',
  kind: 'familyBaby', group: realProxy, hanging: false, invulnerable: true, noHang: true });
assert(realBaby && physical.getBurden(realBaby.id) === realBaby, 'infant initially owns one scene registry slot');
physical.releaseZone('interior'); activeScene = new Group();
assert.equal(physical.getBurden(realBaby.id), null, 'zone unload evicts its previous registry');
assert.equal(physical.rebindRegisteredBurden(realBaby), true, 'scene rebuild reclaims the same child');
assert.equal(physical.getBurden(realBaby.id), realBaby, 'rebind does not clone its mesh, carry handle or identity');
assert.equal(physical.rebindRegisteredBurden(realBaby), true, 'repeated scene repair is idempotent');
activeArea = 'farm'; activeScene = new Group(); realBaby.carried = true;
assert.equal(physical.transferCarriedBurdenToArea('farm', realBaby), true, 'shared Burden migration survives a zone rebuild');
assert.equal(physical.getBurden(realBaby.id, 'farm'), realBaby, 'destination registry owns the original child');
// Execute the production PNGPlaneAvatar bake, not only the family mock. A
// skinned baby's head-scale bone must survive as rigid vertex positions.
const portraitRuntime = {};
vm.runInNewContext(fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'),
  { window: portraitRuntime, localStorage: { getItem: () => null }, console });
assert.equal(typeof portraitRuntime.PNGPlaneAvatar.meshBudget.bakeStaticPortraitForCarry, 'function');
class IdentityMatrix {
  constructor() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  copy() { return this; } multiply() { return this; }
}
function attr(values, step) {
  return { array: values, count: values.length / step,
    getX: i => values[i * step], getY: i => values[i * step + 1], getZ: i => values[i * step + 2],
    setXYZ(i, x, y, z) { values.splice(i * step, 3, x, y, z); } };
}
function skinGeometry(attributes) {
  return { attributes, index: null, boundingBox: null, drawRange: { start: 0, count: 3 },
    getAttribute(key) { return this.attributes[key]; },
    deleteAttribute(key) { delete this.attributes[key]; },
    clone() { return skinGeometry(Object.fromEntries(Object.entries(attributes).map(([key, a]) =>
      [key, attr([...a.array], key === 'position' ? 3 : 4)]))); },
    computeBoundingBox() { this.boundingBox = { min: { x: 0, y: 0 }, max: { x: .18, y: .18 } }; },
    computeBoundingSphere() {},
  };
}
const sourceSkin = skinGeometry({
  position: attr([0,0,0, 0,.1,0, .1,0,0], 3),
  skinWeight: attr([1,0,0,0, 1,0,0,0, 1,0,0,0], 4),
  skinIndex: attr([0,0,0,0, 0,0,0,0, 0,0,0,0], 4),
});
const posedMesh = { isSkinnedMesh: true, geometry: sourceSkin,
  skeleton: { bones: [{ matrixWorld: new IdentityMatrix() }], boneInverses: [new IdentityMatrix()] },
  bindMatrix: new IdentityMatrix(), bindMatrixInverse: new IdentityMatrix(),
  updateWorldMatrix() {}, updateMatrixWorld() {},
  boneTransform(i, point) { const p = sourceSkin.attributes.position;
    return point.set(p.getX(i) * 1.8, p.getY(i) * 1.8, p.getZ(i)); },
};
const pose = portraitRuntime.PNGPlaneAvatar.meshBudget.bakeStaticPortraitForCarry(
  { Matrix4: IdentityMatrix, Vector3: Vector }, posedMesh);
assert(pose?.geometry?.boundingBox, 'real bake computes new static bounds');
assert(Math.abs(pose.geometry.attributes.position.getX(2) - .18) < 1e-9,
  'head-scale skinning becomes visible static geometry');
assert(!pose.geometry.attributes.skinIndex, 'carried baby no longer draws a second skinned rig');
assert.equal(portraitRuntime.PNGPlaneAvatar.meshBudget.bakeStaticPortraitForCarry({}, {}), null);

console.log('Single infant Burden, player/spouse handoff, scene rebuild, zone transfer and cleanup: PASS');
