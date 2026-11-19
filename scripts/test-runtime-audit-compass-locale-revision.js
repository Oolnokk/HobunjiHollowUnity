#!/usr/bin/env node
'use strict';
// P5: discovered-locale cache updates only for relevant metadata edits,
// while identical and character-only saves incur no compass re-read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Storage {
  constructor() { this.data = new Map(); this.reads = 0; }
  getItem(key) { this.reads++; return this.data.get(String(key)) ?? null; }
  setItem(key, value) { this.data.set(String(key), String(value)); }
  removeItem(key) { this.data.delete(String(key)); }
  clear() { this.data.clear(); }
}
const browser = new Storage();
let storageEvent = null; // Captures the real cross-tab event listener installed by the guard.
const win = {
  Storage, localStorage: browser, console,
  addEventListener(type, callback) { if (type === 'storage') storageEvent = callback; },
};
vm.runInNewContext(fs.readFileSync('docs/js/storage-quota-guard.js', 'utf8'), {window:win,console});
const guard = win.HobunjiStorageQuota;
assert.equal(guard.getSaveMetaLocaleRevision(), 0, 'clean startup requires no discovery parse');
const meta = (discovery, nickname = 'Name') => JSON.stringify({
  worlds:[{id:'world',discoveredLocales:discovery}], characters:[{id:'player',nickname}],
});
const original = meta({first:true});
browser.setItem('hobunjiSaveMeta', original);
const first = guard.getSaveMetaLocaleRevision();
assert.equal(first, 1, 'new locale section invalidates the compass');
browser.setItem('hobunjiSaveMeta', original);
assert.equal(guard.getSaveMetaLocaleRevision(), first, 'writing identical bytes never invalidates');
browser.setItem('hobunjiSaveMeta', meta({first:true}, 'Changed only character'));
assert.equal(guard.getSaveMetaLocaleRevision(), first, 'character progression does not invalidate locale discovery');
const readsBefore = browser.reads;
for (let i = 0; i < 200; i++) guard.getSaveMetaLocaleRevision();
assert.equal(browser.reads, readsBefore, 'quiet compass polling has no browser storage reads');
browser.setItem('hobunjiSaveMeta', meta({first:true,second:{by:'canyon'}}, 'Changed only character'));
assert.equal(guard.getSaveMetaLocaleRevision(), first+1, 'nested discovery additions immediately invalidate');
storageEvent({storageArea:browser,key:'hobunjiSaveMeta',newValue:meta({first:true,second:{by:'forest'}})});
assert.equal(guard.getSaveMetaLocaleRevision(), first+2, 'cross-tab updates invalidate without waiting');
browser.removeItem('hobunjiSaveMeta');
assert.equal(guard.getSaveMetaLocaleRevision(), first+3, 'deletion invalidates cached discoveries');
browser.setItem('hobunjiSaveMeta', original);
const beforeClear = guard.getSaveMetaLocaleRevision();
browser.clear();
assert.equal(guard.getSaveMetaLocaleRevision(), beforeClear+1, 'full folder/browser reset also invalidates');
win.localStorage = { getItem() { return null; } };
assert.equal(guard.getSaveMetaLocaleRevision(), undefined, 'virtual storage falls back to live cache reads');
console.log('PASS runtime audit P5: no unrelated/identical metadata re-read, correct writes and cross-tab invalidation');
