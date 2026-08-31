#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const questProgress = {
  request_1: {
    status: 'announced',
    progress: { kind: 'request', npcId: 'hreesh', npcName: 'Hreesh' },
  },
};
const walker = {
  rec: { id: 'hreesh', name: 'Hreesh' },
  area: 'town',
  root: { position: { x: 4, z: 7 } },
};
const context = {
  console,
  window: null,
  Object,
  Array,
  Map,
  Set,
  Math,
  Date,
};
context.window = context;
vm.createContext(context);
const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'procedural-tasks.js'); // Executes the shipped module so the cache behavior cannot drift from this regression test.
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
context.ProceduralTasks.init({
  calendar: { day: 12, time01: 0.25 },
  npcWalkers: [walker],
  getQuestProgress: () => questProgress,
  setQuestStatus: (taskId, status, progressPatch) => {
    questProgress[taskId].status = status;
    Object.assign(questProgress[taskId].progress, progressPatch || {});
  },
});

let targets = context.ProceduralTasks.allCompassTargets();
assert.equal(targets.pending.length, 1, 'an announced request should create one purple compass candidate');

context.ProceduralTasks.declineRequest('request_1');
targets = context.ProceduralTasks.allCompassTargets();
assert.equal(targets.pending.length, 0, 'a quest status mutation must remove its purple candidate immediately, without waiting for the next in-game hour');
assert.equal(context.ProceduralTasks.compassDebugSnapshot().invalidations, 1, 'mobile diagnostics should report the invalidation that rebuilt the cache');

console.log('procedural task compass cache tests passed');
