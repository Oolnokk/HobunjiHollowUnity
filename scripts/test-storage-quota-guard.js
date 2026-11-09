#!/usr/bin/env node
'use strict';

// A full localStorage quota must never block the canonical save: the guard
// evicts browser recovery-checkpoint mirrors (least valuable first) and
// retries. A checkpoint may only evict checkpoints ranked below itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function quotaError() { const e = new Error("Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota."); e.name = 'QuotaExceededError'; e.code = 22; return e; }
function Storage() { this._data = new Map(); this._limit = 100; }
Storage.prototype.getItem = function (k) { return this._data.has(k) ? this._data.get(k) : null; };
Storage.prototype.removeItem = function (k) { this._data.delete(k); };
Storage.prototype.clear = function () { this._data.clear(); };
Storage.prototype.setItem = function (k, v) {
  let used = 0; for (const [key, val] of this._data) if (key !== k) used += key.length + val.length;
  if (used + k.length + String(v).length > this._limit) throw quotaError();
  this._data.set(k, String(v));
};

const localStorage = new Storage();
const sessionStorage = new Storage();
const win = { Storage, localStorage, sessionStorage, console: { warn() {} } };
win.window = win;
vm.runInNewContext(fs.readFileSync('docs/js/storage-quota-guard.js', 'utf8'), win, { filename: 'storage-quota-guard.js' });
const Q = win.HobunjiStorageQuota;
const [autoPrev, auto, mapChange, campfire, preRestore, manual] = Q.CHECKPOINT_EVICTION_ORDER;
const fill = n => 'x'.repeat(n);

localStorage._limit = 400;
localStorage.setItem(manual, fill(60));
localStorage.setItem(autoPrev, fill(60));
localStorage.setItem(auto, fill(60));
localStorage.setItem('hobunjiSaveMeta', fill(80));

// Canonical save grows past the quota: evict autoPrevious, then auto, but keep manual.
localStorage.setItem('hobunjiSaveMeta', fill(260));
assert.equal(localStorage.getItem('hobunjiSaveMeta').length, 260, 'canonical save write succeeds');
assert.equal(localStorage.getItem(autoPrev), null, 'autoPrevious evicted first');
assert.equal(localStorage.getItem(auto), null, 'auto evicted next');
assert.notEqual(localStorage.getItem(manual), null, 'manual kept when enough space was freed');

// A checkpoint mirror may not evict a more valuable slot.
assert.throws(() => localStorage.setItem(auto, fill(150)), /quota/, 'autosave cannot push out the manual save');
assert.notEqual(localStorage.getItem(manual), null);

// Non-quota errors and other Storage instances are untouched.
sessionStorage._limit = 10;
assert.throws(() => sessionStorage.setItem('k', fill(50)), /quota/, 'sessionStorage is not guarded');
assert.equal(Q.isQuotaError(quotaError()), true);
assert.ok(Q.debugSnapshot().quotaHits >= 2);

// A canonical save too large even after eviction remains usable by an armed
// folder, while browser-only saves and other storage keys must still fail.
win.LocalSaveFolder = { getStatus: () => ({ state: 'ready', autoSyncArmed: true }) };
localStorage.setItem('hobunjiSaveMeta', fill(500));
assert.equal(localStorage.getItem('hobunjiSaveMeta'), fill(500));
assert.notEqual(localStorage._data.get('hobunjiSaveMeta'), fill(500), 'staging does not pretend to have written native browser storage');
assert.ok(Q.debugSnapshot().stagedKeys.includes('hobunjiSaveMeta'));
localStorage.setItem('hobunjiSaveMeta', fill(520));
assert.equal(localStorage.getItem('hobunjiSaveMeta'), fill(520), 'repeated read/modify/write sees the latest staged state');
assert.throws(() => localStorage.setItem('unrelated', fill(500)), /quota/);
assert.throws(() => localStorage.setItem(manual, fill(500)), /quota/, 'recovery checkpoints are not silently staged');
win.LocalSaveFolder = { getStatus: () => ({ state: 'ready', autoSyncArmed: false }) };
assert.throws(() => localStorage.setItem('hobunjiSaveMeta', fill(530)), /quota/, 'an unarmed folder does not authorize writes');
Q.importFolderSnapshot(() => localStorage.setItem('hobunjiSaveMeta', fill(540)));
assert.equal(localStorage.getItem('hobunjiSaveMeta'), fill(540), 'validated folder imports can hydrate before arming');
assert.throws(() => localStorage.setItem('hobunjiSaveMeta', fill(550)), /quota/, 'import staging permission does not leak');
localStorage.setItem('hobunjiSaveMeta', fill(20));
assert.equal(Q.debugSnapshot().stagedKeys.length, 0, 'a successful native write supersedes staging');
Q.importFolderSnapshot(() => localStorage.setItem('hobunji_farm_layout_v3:test', fill(500)));
localStorage.removeItem('hobunji_farm_layout_v3:test');
assert.equal(localStorage.getItem('hobunji_farm_layout_v3:test'), null, 'deletion clears staged layouts');
assert.throws(() => Q.requireBrowserPersistence(() => Q.importFolderSnapshot(() => localStorage.setItem('hobunjiSaveMeta', fill(600)))), /quota/, 'browser durability wins over a nested folder staging scope');
Q.importFolderSnapshot(() => localStorage.setItem('hobunjiSaveMeta', fill(600)));
assert.equal(Q.hasStagedValues(), true, 'failed browser-only writes release their staging prohibition');
sessionStorage._limit = 1000;
sessionStorage.setItem('hobunjiSaveMeta', 'session-only');
assert.equal(sessionStorage.getItem('hobunjiSaveMeta'), 'session-only', 'sessionStorage reads never see local staging');
sessionStorage.clear();
assert.equal(localStorage.getItem('hobunjiSaveMeta'), fill(600), 'clearing sessionStorage does not clear local staging');
localStorage.clear();
assert.equal(localStorage.getItem('hobunjiSaveMeta'), null);
assert.equal(Q.hasStagedValues(), false, 'clearing localStorage also clears its staged canonical values');

const index = fs.readFileSync('docs/index.html', 'utf8');
const guardAt = index.indexOf('js/storage-quota-guard.js');
const firstLocalScript = index.search(/<script src="js\//);
assert.equal(guardAt, firstLocalScript + '<script src="'.length, 'guard is the first local script, ahead of every save writer');
assert.ok(guardAt < index.indexOf('js/local-save-folder.js'), 'guard loads before the save folder / checkpoint manager');

console.log('storage quota guard: ok');
