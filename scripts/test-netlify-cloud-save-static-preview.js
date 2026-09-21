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
assert.match(loader, /netlify-cloud-save\.js\?v=20260920startup4/,
  'the parser-time cloud-save loader cache-busts the static-preview guard');

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
