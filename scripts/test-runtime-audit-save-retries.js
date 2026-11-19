#!/usr/bin/env node
'use strict';
// R1: a rejected member save never advances the livestock inventory
// fingerprint and explicit flushes must propagate serializer false values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const win = {
  FarmAnimals: { init() {} },
  CharacterMetaSave: { flush() { return true; } },
  HobunjiStorageQuota: { getWriteFailureCount: () => 0 },
};
vm.runInNewContext(fs.readFileSync('docs/js/folder-save-runtime-flush.js', 'utf8'), {window:win,console});
const inventory = {milk:0}; // Live bag mutated after the wrapped livestock save dependency is initialized.
let rejected = true; // Simulates a serializer returning false due to an unsuccessful browser write.
let writes = 0;
let farmAllowed = true;
const deps = {
  inventory,
  saveMemberWorldData() { writes++; return !rejected; },
  saveFarmLayout() { return farmAllowed; },
  saveWorldLivestock() { return true; },
};
win.FarmAnimals.init(deps);
assert.equal(win.HobunjiRuntimeSave.isReady(), true);
inventory.milk = 1;
deps.saveWorldLivestock();
assert.equal(writes,1,'livestock operation attempted persistence');
assert.equal(win.__hobunjiRuntimeSaveDebug.snapshot().livestockInventoryFlushCount,0,'rejected bag did not advance success counter');
rejected = false;
deps.saveWorldLivestock();
assert.equal(writes,2,'unchanged inventory retries after the failure');
assert.equal(win.__hobunjiRuntimeSaveDebug.snapshot().livestockInventoryFlushCount,1,'retry is acknowledged after a successful save');
deps.saveWorldLivestock();
assert.equal(writes,2,'successful inventory does not write a third time');
rejected = true;
assert.equal(win.HobunjiRuntimeSave.flushNow({reason:'audit-rejection'}).ok,false,'explicit flush propagates member rejection');
rejected = false;
assert.equal(win.HobunjiRuntimeSave.flushNow({reason:'audit-retry'}).ok,true,'explicit flush recovers when member serializer succeeds');
farmAllowed = false;
assert.equal(win.HobunjiRuntimeSave.flushNow().ok,false,'farm serializer rejection also propagates');
farmAllowed = true;
win.CharacterMetaSave.flush = () => false;
assert.equal(win.HobunjiRuntimeSave.flushNow().ok,false,'metadata flush rejection is not masked');
console.log('PASS runtime audit R1: failed saves retry, explicit flushes preserve rejection');
