'use strict';
// Native upper stories must register the same exact footprints the ground floor gets: static props and
// door panels while closed. Without them the player's movement (canOccupyAt -> AreaFootprintBlockers
// + flat grid) walks through pillars and shut doors, because the native DS blockers are advisory.
// Runs the real mount with injected stand-ins for the footprint set and the provider registry.
const assert = require('node:assert/strict');

const scans = [], providers = new Map(), removed = [];
let setOptions = null, blocksResult = false;
globalThis.DevRandomRuinSolidFootprints = {
  createSet(options) {
    setOptions = options;
    return { scan(root, tag, opts) { scans.push({ root, tag, opts }); return 1; }, blocksBox() { return blocksResult; } };
  },
};
globalThis.AreaFootprintBlockers = {
  register(id, provider) { providers.set(id, provider); return () => {}; },
  remove(id) { removed.push(id); providers.delete(id); },
};
const Native = require('../docs/js/ruin-v50-native-mechanisms.js');

class Box3 { setFromObject(o) { let x = 0, y = 0, z = 0; for (let p = o; p; p = p.parent) { x += p.position?.x || 0; y += p.position?.y || 0; z += p.position?.z || 0; } this.min = { x:x - .25, y:y - .25, z:z - .25 }; this.max = { x:x + .25, y:y + .25, z:z + .25 }; return this; } isEmpty() { return false; } getCenter(v) { v.x = (this.min.x + this.max.x) / 2; v.y = (this.min.y + this.max.y) / 2; v.z = (this.min.z + this.max.z) / 2; return v; } }
class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Node {
  constructor(x = 0, y = 0, z = 0) { this.parent = null; this.children = []; this.userData = {}; this.position = { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } }; this.rotation = { y:0 }; this.scale = { x:1, y:1, z:1 }; this.visible = true; this.isMesh = false; }
  add(child) { this.children.push(child); child.parent = this; }
  traverse(fn) { fn(this); this.children.forEach(child => child.traverse(fn)); }
  updateWorldMatrix() {}
}
const root = new Node(0, 4, 0);
const pillar = new Node(2, 0, 2); pillar.userData = { interiorRuinRole:'ceiling support pillar' }; root.add(pillar);
const stoneDoor = new Node(5, 0, 3); stoneDoor.userData = { mechanismId:'door_a', previewMotion:{ type:'stoneDoor' } };
const stonePanel = new Node(); stonePanel.isMesh = true; stonePanel.geometry = {}; stoneDoor.add(stonePanel); root.add(stoneDoor);
const transit = new Node(8, 0, 3); transit.userData.transitDoor = true;
const transitPanel = new Node(); transitPanel.isMesh = true; transitPanel.geometry = {}; transit.add(transitPanel); root.add(transit);
Native.namespace(root, 2);

const player = { x:1, y:4, z:1 };
const runtime = Native.mount({
  nativeRoot:root, floor:2, scope:'story-f2', THREE:{ Box3, Vector3 },
  api:{ applyProgress() {}, syncPressurePlates() {}, registerDetachedCubeRoots() { return () => {}; }, rotateLinkedCube() {} },
  DynamicSurfaces:{ registerSurface() {}, registerBlocker() {}, remove() {} },
  hitPuzzles:{ registerExternalRoot:() => () => {} },
  getPlayerPosition:() => player, getPlayerY:() => player.y, addControl() {}, removeControl() {},
  floorY:4, heightAt:(x, z) => 4 + (x > 100 ? 1.26 : 0), showToast() {},
});

// Static props: each child of the root is scanned, never the root itself (its name, v50_native_floor_N,
// would trip the scanner's floor-slab exclusion and drop every prop beneath it).
const statics = scans.filter(entry => entry.tag === 'native-static');
assert.deepEqual(statics.map(entry => entry.root), root.children, 'every direct child of the native root is scanned for props');
assert.ok(!statics.some(entry => entry.root === root), 'the root itself is never the scan root');

// Door panels: forced scans with an enabled() tied to the live door state.
const doorScans = scans.filter(entry => entry.tag === 'door');
assert.equal(doorScans.length, 2, 'one footprint scan per stone door and per transit door');
assert.deepEqual(doorScans.map(entry => entry.root), [stonePanel, transitPanel]);
assert.ok(doorScans.every(entry => entry.opts.force === true && typeof entry.opts.enabled === 'function'));
const [stoneScan, transitScan] = doorScans;
assert.equal(stoneScan.opts.enabled(), true, 'a closed stone door blocks');
runtime.states.get('native-v50-f2-door_a').progress = .95;
assert.equal(stoneScan.opts.enabled(), false, 'an open stone door no longer blocks');
assert.equal(transitScan.opts.enabled(), true, 'a closed transit door blocks');

// The footprint set measures ground the way the story does, and the player the way occupancy does.
assert.equal(setOptions.floorY(1, 1), 4);
assert.equal(setOptions.floorY(200, 1), 5.26, 'ground follows the story plateau height');
assert.deepEqual({ ...setOptions.playerBox() }, { x:1, z:1, half:.2 });

// The provider answers the player's movement queries, only on the owning story.
const id = 'story-f2-solids', provider = providers.get(id);
assert.ok(provider, 'a provider is registered with the area footprint registry');
assert.equal(provider.area, 'map_i_dev_random_ruin');
blocksResult = true;
assert.equal(provider.blocksBox(3, 3, .2, null), true, 'the provider returns the footprint set\'s answer');
player.y = 4; assert.equal(provider.enabled(), true, 'enabled while the player is on this story');
player.y = 0; assert.equal(provider.enabled(), false, 'ground floor: this story\'s props must not block (stories overlap in X/Z)');
player.y = 8.06; assert.equal(provider.enabled(), false, 'another story above: likewise');
player.y = 5.2; assert.equal(provider.enabled(), true, 'a raised plateau on this story still counts');
player.y = 4;

// Dispose releases the provider and stops answering.
runtime.dispose();
assert.deepEqual(removed, [id], 'dispose removes the provider');
assert.equal(providers.has(id), false);
assert.equal(provider.enabled(), false, 'a stale reference no longer blocks');

// Without the footprint modules (older builds, other tests) mounting still works and registers nothing.
delete globalThis.DevRandomRuinSolidFootprints;
delete globalThis.AreaFootprintBlockers;
const bare = new Node(0, 4, 0), bareDoor = new Node(1, 0, 1); bareDoor.userData = { mechanismId:'x', previewMotion:{ type:'stoneDoor' } };
const barePanel = new Node(); barePanel.isMesh = true; barePanel.geometry = {}; bareDoor.add(barePanel); bare.add(bareDoor);
const bareRuntime = Native.mount({ nativeRoot:bare, floor:3, scope:'bare', THREE:{ Box3, Vector3 }, api:{ applyProgress() {}, syncPressurePlates() {}, registerDetachedCubeRoots() { return () => {}; } },
  DynamicSurfaces:{ registerSurface() {}, registerBlocker() {}, remove() {} }, hitPuzzles:{ registerExternalRoot:() => () => {} }, getPlayerPosition:() => player, getPlayerY:() => player.y, addControl() {}, removeControl() {}, floorY:4, heightAt:() => 4 });
bareRuntime.dispose();

console.log('native v50 solid footprints regression passed');
