#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Checks tracking behavior through the public runtime API.
const fs = require('node:fs'); // Loads the actual owning module.
const vm = require('node:vm'); // Isolates browser globals for the runtime test.
const stored = new Map(); // Emulates persistent per-world discovery state.
let rank = 0; // Exercises the perk gate without changing shared creature definitions.
const notices = []; // Captures player-visible discovery alerts.
class Group {
  constructor() {
    this.children = []; this.userData = {}; this.rotation = {}; this.scale = {}; // Minimal scene ownership used by the real entrance builder.
    this.position = { x:0, y:0, z:0, set(x,y,z) { Object.assign(this,{x,y,z}); } };
  }
  add(node) { node.parent = this; this.children.push(node); }
  remove(node) { this.children = this.children.filter(child => child !== node); node.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); }
  updateMatrixWorld() {}
}
class Box3 {
  setFromObject(object) {
    this.min = { ...object.position }; this.max = { ...object.position }; // Only lifecycle/state, not geometric precision, is under test here.
    return this;
  }
  expandByScalar() { return this; }
}
const THREE = { Group, Box3 }; // The public mesh-build path only needs these Three.js interfaces.
const context = { THREE, window: { THREE, RuinSiteLocales: { CATEGORY: 'ruin_entrance', hashString: () => 1 }, AuthoredFurniture: { load: async () => ({}), peek: () => ({}), buildGroup: () => new Group() }, StableAnimalProgression: { activeEntryForRole: () => ({}), perkRank: () => rank } }, localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } }; // Supplies scene and persistence dependencies to the real runtime.
vm.runInNewContext(fs.readFileSync('docs/js/ruin-sites.js', 'utf8'), context);
const api = context.window.RuinSites; // Tests the same public API called by updateCompanions.
const instance = { localeId: 'ruin', category: 'ruin_entrance', objects: [{ kind: 'ruinDoor', x: 10, y: 10 }, { kind: 'ruinSlot', id: 'glyph', x: 11, y: 10 }] }; // A nearby placed cliff entrance with a real target slot.
const layouts = new Map([['zone', { localeInstances: [instance] }]]); // Existing map locale authority.
api.init({ TILE: 64, NORMAL_TOP:0, PLATEAU_UNIT:2.5, getCurrentArea: () => 'zone', _zoneLayouts: layouts, showToast: text => notices.push(text) });
api.registerWorkspace('zone', layouts.get('zone'));
const actor = { stableRole: 'companion', def: { label: 'Dog' } }; // Active companion triggering scans.
const master = { x: 0, y: 0 }; // Pixel coordinates exercise tile conversion.
api.trackNearby(actor, master, 1);
assert.equal(notices.length, 0);
rank = 1;
api.trackNearby(actor, master, 1);
assert.equal(instance.alwaysVisible, true);
assert.equal(notices.length, 1);
api.trackNearby(actor, master, 1);
assert.equal(notices.length, 1, 'saved discovery prevents repeated alerts');
instance.alwaysVisible = false;
api.syncMapMarkers();
assert.equal(instance.alwaysVisible, true, 'saved discovery restores map visibility');
api.registerWorkspace('zone', { localeInstances: [{ ...instance, localeId: 'far', objects: [{ kind: 'ruinDoor', x: 100, y: 100 }] }] });
api.trackNearby(actor, master, 1);
assert.equal(notices.length, 1, 'distant ruins are not tracked');

(async () => {
  api.registerWorkspace('zone', { localeInstances: [instance] });
  const scene = new Group(); scene.type = 'Scene'; // Zone renderer supplied through the public API; no private source extraction.
  const rebuild = async () => {
    api.buildZoneMeshes(scene, [], 'zone');
    await new Promise(resolve => setImmediate(resolve));
    const snapshot = api.debugSnapshot(); // Mobile debug data must remain readable for saved discovery-only records too.
    assert.equal(snapshot.rendered.zone.sites.length, 1);
    assert.equal(snapshot.rendered.zone.sites[0].pillars.length, 1);
    assert.equal(snapshot.rendered.zone.sites[0].pillars[0].struck, false);
    assert(api.objectAt('zone', 10, 10), 'rebuilt entrance retains its normal interaction footprint');
  };
  await rebuild();
  assert.equal(scene.children.length, 1);
  const save = JSON.parse(stored.get('hobunjiRuinSites.v1')); // Reproduce already-written saves from the affected version.
  save.default.entrances.ruin = { tracked:true };
  stored.set('hobunjiRuinSites.v1', JSON.stringify(save));
  await rebuild();
  assert.equal(scene.children.length, 1, 'legacy discovery records rebuild without duplicate or missing scenery');
  assert.equal(api.debugSnapshot().zones.zone[0].state.tracked, true, 'normalizing legacy state retains discovery');
  assert.equal(instance.alwaysVisible, true);
  console.log('companion ruin tracking checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
