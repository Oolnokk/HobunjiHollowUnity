#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Checks tracking behavior through the public runtime API.
const fs = require('node:fs'); // Loads the actual owning module.
const vm = require('node:vm'); // Isolates browser globals for the runtime test.
const stored = new Map(); // Emulates persistent per-world discovery state.
let rank = 0; // Exercises the perk gate without changing shared creature definitions.
const notices = []; // Captures player-visible discovery alerts.
const context = { window: { THREE: {}, RuinSiteLocales: { CATEGORY: 'ruin_entrance' }, AuthoredFurniture: { load: async () => null }, StableAnimalProgression: { activeEntryForRole: () => ({}), perkRank: () => rank } }, localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } }; // Supplies only module dependencies used by tracking.
vm.runInNewContext(fs.readFileSync('docs/js/ruin-sites.js', 'utf8'), context);
const api = context.window.RuinSites; // Tests the same public API called by updateCompanions.
const instance = { localeId: 'ruin', category: 'ruin_entrance', objects: [{ kind: 'ruinDoor', x: 10, y: 10 }] }; // A nearby placed cliff entrance.
const layouts = new Map([['zone', { localeInstances: [instance] }]]); // Existing map locale authority.
api.init({ TILE: 64, getCurrentArea: () => 'zone', _zoneLayouts: layouts, showToast: text => notices.push(text) });
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
console.log('companion ruin tracking checks passed');
