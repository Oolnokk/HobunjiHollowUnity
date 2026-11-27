#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Cloud change polling must compare raw browser cache parts, rather than repeatedly
// parse and stringify an entire world/farm layout just to see if it changed.
{
  const snapshotSource = fs.readFileSync('docs/js/save-snapshot-core.js', 'utf8');
  const cache = new Map([
    ['hobunjiSaveMeta', JSON.stringify({ characters: [{ id: 'c' }], worlds: [{ id: 'w' }] })],
    ['hobunji_farm_layout_v3:w', JSON.stringify({ tiles: [1] })],
  ]);
  let parses = 0; // Counts full JSON.parse calls performed during browser cache observation.
  const instrumentedJson = {
    parse(raw) { parses++; return JSON.parse(raw); },
    stringify(...args) { return JSON.stringify(...args); },
  };
  const cacheWindow = {};
  vm.runInNewContext(snapshotSource, {
    window: cacheWindow,
    JSON: instrumentedJson,
    localStorage: {
      getItem(key) { return cache.get(key) ?? null; },
    },
  }, { filename: 'save-snapshot-core.js' });
  const observe = () => cacheWindow.HobunjiSaveSnapshot.browserCacheParts(); // Shared fast poll consumed by cloud autosync.
  const initial = observe();
  for (let i = 0; i < 20; i++) observe();
  assert.equal(parses, 1, 'unchanged browser metadata is parsed once across repeated cloud polls');
  cache.set('hobunji_farm_layout_v3:w', JSON.stringify({ tiles: [2] }));
  assert.notDeepEqual(observe(), initial, 'farm-layout-only edits trigger cloud dirty detection');
  assert.equal(parses, 1, 'layout edits do not require metadata or layout JSON parsing');
  cache.set('hobunjiSaveMeta', JSON.stringify({ characters: [{ id: 'c' }], worlds: [{ id: 'w' }, { id: 'z' }] }));
  cache.set('hobunji_farm_layout_v3:z', JSON.stringify({ tiles: [3] }));
  assert.equal(observe().length, 5, 'new world layouts participate in the next cloud signature');
  assert.equal(parses, 2, 'world IDs are refreshed only when raw metadata actually changes');
}
console.log('save snapshot cache-parts regression passed');
