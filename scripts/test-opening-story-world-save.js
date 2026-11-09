#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/opening-story-cutscene.js', 'utf8');
function boot(initial = {}) {
  const saved = new Map(Object.entries(initial)), events = {}, queued = [];
  const profile = { characterId: 'char1', worldId: 'world1', isWorldOwner: true };
  if (!saved.has('hobunjiSaveMeta')) saved.set('hobunjiSaveMeta', JSON.stringify({
    characters: [{ id: 'char1' }],
    worlds: [{ id: 'world1', ownerCharacterId: 'char1', lastDay: 1 }],
  }));
  const sandbox = {
    window: { __hobunjiPlayerProfile: profile },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) },
    document: { addEventListener: (name, handler) => { events[name] = handler; } },
    queueMicrotask: fn => queued.push(fn),
  };
  vm.runInNewContext(source, sandbox);
  return { saved, queued, profile, api: sandbox.window.OpeningStoryCutscene,
    ready: () => events.hobunjiPlayerReady({ detail: profile }),
    world: () => JSON.parse(saved.get('hobunjiSaveMeta')).worlds[0] };
}
const key = 'hobunjiOpeningStory.v1:world1';
const fresh = boot();
fresh.ready();
assert.equal(fresh.queued.length, 1);
assert.equal(fresh.world().openingStory.opening, 'pending');

const old = boot({ [key]: 'complete', [key + ':farm-tour']: 'complete',
  [key + ':farm-tour:completed-hours']: '350', [key + ':jubmir-fey']: 'complete' });
old.ready();
assert.equal(old.queued.length, 0);
assert.equal(old.world().openingStory.opening, 'complete');
assert.equal(old.world().openingStory.farmTourComplete, true);
assert.equal(old.world().openingStory.farmTourCompletedAtHours, 350);
assert.equal(old.world().openingStory.jubmirFeyComplete, true);

const restored = boot({ hobunjiSaveMeta: old.saved.get('hobunjiSaveMeta') });
restored.ready();
assert.equal(restored.queued.length, 0, 'world-only restore must not replay opening');
assert.equal(restored.api.needsTempleArrival(restored.profile), false);
assert.equal(restored.api.canEnterWilderness(restored.profile), true);
assert.equal(restored.api.debugSnapshot().jubmirFey.completed, true);

const staleWorld = JSON.parse(old.saved.get('hobunjiSaveMeta'));
staleWorld.worlds[0].openingStory.opening = 'pending';
staleWorld.worlds[0].openingStory.farmTourComplete = false;
const stale = boot({ hobunjiSaveMeta: JSON.stringify(staleWorld), [key]: 'complete' });
stale.ready();
assert.equal(stale.queued.length, 1, 'world saved state outranks stale local completion');

const historicWorld = JSON.parse(fresh.saved.get('hobunjiSaveMeta'));
delete historicWorld.worlds[0].openingStory;
historicWorld.worlds[0].lastDay = 8;
const historic = boot({ hobunjiSaveMeta: JSON.stringify(historicWorld) });
historic.ready();
assert.equal(historic.queued.length, 0, 'progressed world without old flags must not replay');
assert.equal(historic.world().openingStory.farmTourComplete, true);
console.log('opening-story portable world save tests passed');
