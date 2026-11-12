#!/usr/bin/env node
'use strict';
// Focused regression of the actual game-owned loot-save scheduler plus pickup-path contracts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const game = read('docs/game.js');
const bandit = read('docs/js/bandit-camps.js');
const shatter = read('docs/js/shattercasks.js');
const crate = read('docs/js/crate-piles.js');
const start = game.indexOf('let pendingLootMemberSave = false;');
const end = game.indexOf('// ── Owner/farmhand content visibility', start);
assert(start > 0 && end > start, 'locate the canonical deferred member-save path');
const storage = new Map([['hobunjiSaveMeta', '{"members":[]}']]); // Simulates canonical save metadata across flushes.
const idle = []; // Queued idle callbacks; demonstrates one coalesced write across rapid pickups.
const listeners = new Map(); // Captures pagehide for a save before navigation.
const docListeners = new Map(); // Captures visibilitychange on mobile backgrounding.
let writes = 0; // Counts expensive storage serializations.
let farmWrites = 0; // Counts layout serializations coalesced with member saves.
const document = { hidden:false, addEventListener(name,fn){docListeners.set(name,fn);} };
const window = {requestIdleCallback(fn){idle.push(fn);},addEventListener(name,fn){listeners.set(name,fn);},
  FarmEditor: { saveFarmLayout() { farmWrites++; return true; } },
};
const localStorage = {
  getItem(key){return storage.get(key) || null;},
  setItem(key,value){writes++;storage.set(key,String(value));},
};
const context = vm.createContext({window,document,localStorage,console,
  captureMemberWorldData(meta){meta.lootCaptured=true;return meta;},
  setTimeout(){throw new Error('idle callback unexpectedly unavailable');},
});
vm.runInContext(game.slice(start,end) + '\nthis.api={scheduleLootMemberSave,saveMemberWorldData,flushLootMemberSave};',context);
const api=context.api;
api.scheduleLootMemberSave();api.scheduleLootMemberSave();api.scheduleLootMemberSave();
assert.equal(writes,0,'multiple loot actions leave the pickup frame free of synchronous serialization');
assert.equal(idle.length,1,'multiple loot actions share one scheduled write');
idle.shift()();
assert.equal(writes,1);
assert.equal(JSON.parse(storage.get('hobunjiSaveMeta')).lootCaptured,true);
api.scheduleLootMemberSave();api.saveMemberWorldData();idle.shift()();
assert.equal(writes,2,'ordinary save satisfies queued loot save without duplicate write');
api.scheduleLootMemberSave();listeners.get('pagehide')();idle.shift()();
assert.equal(writes,3,'pagehide flushes once, and its retired idle callback is inert');
api.scheduleLootMemberSave();document.hidden=true;docListeners.get('visibilitychange')();
assert.equal(writes,4,'backgrounding flushes live loot');
idle.shift()();
api.scheduleLootMemberSave(true);
api.scheduleLootMemberSave(true);
api.scheduleLootMemberSave();
assert.equal(farmWrites,0,'farm strikes do not write the layout on the strike frame');
assert.equal(writes,4,'farm strikes do not write member state on the strike frame');
assert.equal(idle.length,1,'farm strikes and loot share the scheduled callback');
idle.shift()();
assert.equal(farmWrites,1,'several strikes share one farm layout write');
assert.equal(writes,5,'several strikes and loot share one member write');
api.scheduleLootMemberSave(true);
api.saveMemberWorldData();
listeners.get('pagehide')();
idle.shift()();
assert.equal(farmWrites,2,'pagehide flushes farm state even when the member save already ran');
assert.equal(writes,6,'the explicit member save prevents a second write');
assert(game.includes('if (_res.ok !== false && !_res.deferMemberSave) saveMemberWorldData();'),
  'generic world-action dispatcher must honor already deferred member save');
const animal = game.slice(game.indexOf('function makeCorpseWorldObject(c)'),game.indexOf('function getCorpseObjectAt('));
assert(animal.includes('scheduleLootMemberSave();') && animal.includes('deferMemberSave: true'),
  'animal butchering defers the save and suppresses an immediate second write');
assert(bandit.includes('ok: true, deferMemberSave: true,'),
  'bandit corpse result suppresses the immediate world-action save');
assert(bandit.includes('(deps.scheduleLootMemberSave || deps.saveMemberWorldData)();'),
  'enemy loot queues the canonical save');
assert(shatter.includes('removePileVisual(records.get(pile.mapId),pile);'),
  'rubble swaps out only four instances instead of rebuilding every pile');
assert(shatter.includes('queuePileSave(); // The items are already awarded; storage waits for browser idle.'),
  'rubble save is deferred');
assert(crate.includes('savedDrops.delete(id);queueSupplySave();'),
  'junk supply save is deferred');
assert(crate.includes('Math.hypot(p.x-drop.x,p.z-drop.z)'),
  'junk proximity avoids a scene-matrix update per frame');
console.log('PASS loot pickup: idle coalescing, flush on hide, no double save, targeted GPU cleanup');
