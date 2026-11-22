#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
}
class Group {
  constructor() { this.isObject3D = true; this.parent = null; this.children = []; this.visible = true;
    this.position = new Vector(); this.rotation = new Vector(); this.scale = new Vector(1, 1, 1);
    this.userData = {}; }
  add(node) { node.parent?.remove(node); node.parent = this; this.children.push(node); }
  remove(node) { this.children = this.children.filter(child => child !== node); if (node.parent === this) node.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
  updateWorldMatrix() {}
  getWorldPosition(out) { return out.copy(this.position); }
}
class Mesh extends Group { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class PlaneGeometry { constructor(w, h) { this.width = w; this.height = h; } dispose() { this.disposed = true; } }
class MeshBasicMaterial { constructor(options) { Object.assign(this, options); } dispose() { this.disposed = true; } }
const THREE = { Group, Mesh, Vector3: Vector, PlaneGeometry, MeshBasicMaterial, FrontSide: 0 }; // Small structural stand-in for actual THREE objects.
const scene = new Group(), babyRoot = new Group(), spouseRoot = new Group(), portrait = new Group();
babyRoot.position.set(6.5, 0, 6.5); spouseRoot.position.set(6.7, 0, 6.5);
scene.add(babyRoot); scene.add(spouseRoot); spouseRoot.add(portrait);
const babyAvatar = { userData: { frontTexture: {}, backTexture: {}, portraitModelWidth: .3, portraitModelHeight: .3 } };
const spouseAvatar = portrait; spouseAvatar.userData.portraitModelHeight = .95;
const child = { id: 'test-baby', name: 'Pip', otherParentId: 'spouse-id', carryBy: null };
const babyWalker = { rec: { id: child.id }, area: 'interior', root: babyRoot, avatarGroup: babyAvatar };
const spouseWalker = { rec: { id: 'spouse-id' }, area: 'interior', root: spouseRoot, avatarGroup: spouseAvatar };
let held = null, back = null, persistCount = 0, registered = 0, migrationCount = 0;
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
  THREE, Shattercasks: api,
  RomanceSystem: { helpers: { deps: () => ({ getCurrentArea: () => 'interior' }), findWalker: id => id === 'spouse-id' ? spouseWalker : null } },
};
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
assert.equal(carry.returnToBasket(child, { col: 6, row: 6 }), true);
assert.equal(babyWalker.area, 'interior', 'real infant returns through the normal NPC area mover');
assert.deepEqual(areaTransfers.map(x => x.area), ['farm', 'interior'], 'no improvised baby-only zone transfer');
assert.equal(babyRoot.position.x, 6.5, 'returning the baby really moves their authoritative NPC to the basket');
assert.equal(babyRoot.position.z, 6.5, 'basket return cannot leave the infant at their previous throw landing');
assert.equal(babyRoot.visible, true); assert.equal(child.carryBy, null); assert.equal(item.mapId, 'interior',
  'parent returning indoors re-registers the physical baby in the home area');
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
carry.sync(child, rebuiltWalker, 'toddler', persist);
assert.equal(carry.snapshot().babies.length, 0, 'toddler transition retires carrying proxy');
assert.equal(newerRoot.visible, true);
child.carryBy = 'spouse'; // Restore a save made while an NPC was holding the baby.
carry.sync(child, rebuiltWalker, 'basket', persist);
assert.equal(child.carryBy, null, 'reloading cannot teleport baby into spouse arms without a live attachment');
assert.equal(carry.snapshot().babies.length, 1);
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
console.log('Single infant Burden, player/spouse handoff, scene rebuild, zone transfer and cleanup: PASS');
