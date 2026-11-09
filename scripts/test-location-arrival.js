#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Exercises the actual browser arrival module without a DOM or audio device.

const moduleSource = fs.readFileSync(path.join(__dirname, '../docs/js/location-arrival.js'), 'utf8'); // Production script under test.
const events = []; // Records visual and musical announcements in execution order.
let currentArea = 'map_western_slope'; // Simulated player map, updated when travel completes or aborts.
let loadingVisible = false; // Simulated visibility of the shared loading overlay.
let onHidden = null; // Registered completion listener, invoked by the fake loader.
const window = {
  ToastNotifications: { showZoneBanner: title => events.push(['title', title]) },
  Music: { playGameplayCue: cue => events.push(['cue', cue]) },
  TownMine: { floorFromMapId: id => {
    const match = /^map_i_town_mine_f_(\d{3})$/.exec(id);
    const floor = match && Number(match[1]);
    return floor >= 1 && floor <= 100 ? floor : null;
  } },
  LoadingScreenRuntime: {
    getDebug: () => ({ visible: loadingVisible }),
    onHidden: listener => { onHidden = listener; return () => { onHidden = null; }; },
  },
};
vm.runInNewContext(moduleSource, { window, console, Date });
assert.equal(typeof onHidden, 'function', 'arrival module registers a loading-completion callback');
window.LocationArrival.init({ getCurrentArea: () => currentArea });

assert.equal(window.LocationArrival.announce('Bandit Camp'), true);
assert.deepEqual(events, [['title', 'Bandit Camp']], 'existing location banners stay immediate outside loading');

loadingVisible = true;
currentArea = 'map_i_town_mine_f_012';
assert.equal(window.LocationArrival.mineDescent(currentArea), true);
assert.equal(events.length, 1, 'mine title and cue stay hidden during loading');
assert.equal(window.LocationArrival.getDebug().pending.title, 'Floor 12', 'mobile diagnostics expose pending destination');
loadingVisible = false;
onHidden({ generation: 7 });
assert.deepEqual(events.slice(1), [['title', 'Floor 12'], ['cue', 'progressDeeper']], 'HUD title and music fire together when the loader disappears');
onHidden({ generation: 7 });
assert.equal(events.length, 3, 'duplicate hide events cannot replay the sting');

loadingVisible = true;
currentArea = 'map_i_town_mine_f_013';
window.LocationArrival.mineDescent(currentArea);
currentArea = 'town';
loadingVisible = false;
onHidden({ generation: 8 });
assert.equal(events.length, 3, 'aborted mine transition cannot announce a stale floor');
assert.equal(window.LocationArrival.getDebug().pending, null, 'stale pending arrival is cleared');

assert.equal(window.LocationArrival.mineDescent('map_i_town_mine_safe'), false);
assert.equal(events.length, 3, 'non-floor mine hub cannot produce a descent cue');

loadingVisible = true;
currentArea = 'map_i_den_example';
window.LocationArrival.announce('DARKROOT CAVE');
assert.equal(events.length, 3, 'caves also delay their title until loading ends');
loadingVisible = false;
onHidden({ generation: 9 });
assert.deepEqual(events[3], ['title', 'DARKROOT CAVE'], 'cave title uses the same post-load banner path');
assert.equal(events.length, 4, 'unnamed cue does not play for ordinary cave entry');

console.log('Location arrival tests passed.');
