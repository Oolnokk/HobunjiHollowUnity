#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/netlify-cloud-save.js', 'utf8');
const loader = fs.readFileSync('docs/js/local-save-folder.js', 'utf8');

assert.match(source, /STATIC_PREVIEW_HOSTS/, 'cloud save identifies hosts that cannot serve Netlify Functions');
assert.match(source, /startsWith\('\/\.netlify\/functions\/'\)[\s\S]{0,220}!netlifyFunctionsAvailableHere\(\)/,
  'Netlify function requests are rejected locally on static preview hosts before fetch');
assert.match(loader, /netlify-cloud-save\.js\?v=[A-Za-z0-9_.-]+/,
  'the parser-time cloud-save loader cache-busts the static-preview guard');

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
  assert.match(source, /browserCachePartsMatch\(next, _lastObservedBrowserParts\)/,
    'cloud timer uses lightweight cache signatures instead of serializing a full save each second');
}


(async () => {
  let fetchCalls = 0;
  const listeners = {};
  const storage = new Map();
  const sandbox = {
    console,
    Promise,
    Date,
    Math,
    JSON,
    Set,
    Map,
    URL,
    URLSearchParams,
    location: {
      hostname: 'raw.githack.com',
      protocol: 'https:',
      pathname: '/Oolnokk/HobunjiHollowUnity/test/docs/index.html',
      search: '',
      hash: '',
    },
    history: { replaceState() {} },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    crypto: { randomUUID: () => 'test-device' },
    fetch: async () => {
      fetchCalls++;
      throw new Error('fetch must not run on raw.githack.com');
    },
    setInterval() { return 1; },
    clearInterval() {},
    requestAnimationFrame() { return 1; },
    MutationObserver: class { observe() {} },
    document: {
      readyState: 'loading',
      body: null,
      head: null,
      visibilityState: 'visible',
      addEventListener(type, fn) { listeners[type] = fn; },
      getElementById() { return null; },
      createElement() { return { style: {}, appendChild() {}, addEventListener() {}, querySelector() { return null; } }; },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'netlify-cloud-save.js' });

  const status = await sandbox.__hobunjiCloudSaveDebug.refresh();
  assert.equal(fetchCalls, 0, 'GitHack preview does not probe /.netlify/functions and therefore emits no expected 404');
  assert.equal(status.availability, 'not-netlify', 'GitHack preview is reported as a static non-Netlify host');
  console.log('netlify cloud save static-preview host gate passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
