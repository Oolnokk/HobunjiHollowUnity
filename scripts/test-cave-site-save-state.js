'use strict';

// Cave discovery/cache/trap/looted-body flags travel in the world save
// (member.caveSiteState) instead of a separate localStorage key, so cloud and
// folder saves carry them. Runs the real module against a stubbed world.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storage = new Map();
let cycle = 3;
let calendarReady = true;
const context = {
  console, setTimeout, clearTimeout, Promise, URL,
  localStorage: {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
  },
  __hobunjiPlayerProfile: { worldId: 'w1' },
  CalendarSystem: { tothalCycle() { if (!calendarReady) throw new Error('not initialised'); return cycle; } },
  __farmLog: () => {},
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'docs/js/cave-site-system.js'), 'utf8'), context, { filename: 'cave-site-system.js' });
const Cave = context.CaveSiteSystem;
const T = Cave.__test;
const plain = value => JSON.parse(JSON.stringify(value)); // vm-realm objects fail deepStrictEqual.
const sites = () => plain(Object.fromEntries(T.runtimeStateBySignature));

let saves = 0;
Cave.init({ save: () => { saves++; } });

// Existing progress under the old per-world key is adopted into the save.
storage.set('hobunji.caveSites.v1:w1|3', JSON.stringify({ sigA: { discovered: true } }));
Cave.restore(null);
T.ensureStateLoaded();
assert.deepStrictEqual(sites(), { sigA: { discovered: true } }, 'legacy localStorage progress is still read');
assert.deepStrictEqual(plain(Cave.serialize()), { version: 2, identity: 'w1|3', sites: { sigA: { discovered: true } } }, 'and carried into the next world save');

// The world save wins over the legacy key once it exists.
Cave.restore({ version: 2, identity: 'w1|3', sites: { sigB: { cacheOpened: true } } });
T.ensureStateLoaded();
assert.deepStrictEqual(sites(), { sigB: { cacheOpened: true } }, 'restored save payload is the source of truth');

// A real change asks the game to save and is what serialize() returns.
T.runtimeStateBySignature.get('sigB').occupantsCleared = true;
T.persistState();
assert.strictEqual(saves, 1, 'persistState writes through the game save');
assert.deepStrictEqual(plain(Cave.serialize().sites), { sigB: { cacheOpened: true, occupantsCleared: true } });
const stored = Cave.serialize();
stored.sites.sigB.cacheOpened = false;
assert.strictEqual(Cave.serialize().sites.sigB.cacheOpened, true, 'serialize hands out a copy');
assert.ok(![...storage.keys()].some(key => key !== 'hobunji.caveSites.v1:w1|3'), 'no new localStorage keys are written');

// A save made before the calendar is ready (wrong Tothal cycle) must not wipe progress.
const payload = plain(Cave.serialize());
Cave.restore(payload);
calendarReady = false;
T.ensureStateLoaded();
assert.deepStrictEqual(sites(), {}, 'an early, wrong-cycle lookup sees no caves');
assert.deepStrictEqual(plain(Cave.serialize()), payload, 'but the save payload is left untouched');
calendarReady = true;
T.ensureStateLoaded();
assert.deepStrictEqual(sites(), payload.sites, 'once the calendar is ready the real progress is back');

// A new Tothal cycle regenerates caves: old flags do not carry over.
cycle = 4;
T.ensureStateLoaded();
assert.deepStrictEqual(sites(), {}, 'a new Tothal cycle starts with fresh caves');

// Another world loads its own (empty) state.
cycle = 3;
context.__hobunjiPlayerProfile = { worldId: 'w2' };
Cave.restore(null);
T.ensureStateLoaded();
assert.deepStrictEqual(sites(), {}, 'a different world does not see w1 caves');

console.log('cave site save-state tests passed');
