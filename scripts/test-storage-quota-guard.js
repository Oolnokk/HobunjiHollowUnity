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
const [autoPrev, auto, campfire, preRestore, manual] = Q.CHECKPOINT_EVICTION_ORDER;
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

const index = fs.readFileSync('docs/index.html', 'utf8');
const guardAt = index.indexOf('js/storage-quota-guard.js');
const firstLocalScript = index.search(/<script src="js\//);
assert.equal(guardAt, firstLocalScript + '<script src="'.length, 'guard is the first local script, ahead of every save writer');
assert.ok(guardAt < index.indexOf('js/local-save-folder.js'), 'guard loads before the save folder / checkpoint manager');

console.log('storage quota guard: ok');
