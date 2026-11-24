#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = filename => fs.readFileSync(path.resolve(__dirname, '..', 'docs/js', filename), 'utf8');

// Minimal DOM stubs leave the production Ring Tumblers parser, timing model, input
// dispatcher, session ownership and cleanup untouched. No devtools are needed.
function makeElement() {
  return {
    style: { setProperty() {} }, children: [], dataset: {}, innerHTML: '', textContent: '',
    disabled: false, attributes: new Map(), listeners: new Map(), // Lets regression tests activate the mobile retry button.
    setAttribute(key, value) { this.attributes.set(key, String(value)); },
    getAttribute(key) { return this.attributes.get(key); },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children.length = 0; },
    addEventListener(name, callback) { this.listeners.set(name, callback); }, focus() {}, blur() {},
    closest(selector) { return selector === '#chestLockOverlay' ? this : null; },
    querySelector() { return null; },
  };
}

(async () => {
  // The shipping wilderness-treasure manifest owns both scripts in their former order.
  const groupManifest = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/bootstrap/classic-groups/wilderness-treasure.js'), 'utf8');
  const manifestWrites = []; // Captures the parser-blocking child tags emitted by the actual manifest.
  vm.runInNewContext(groupManifest, {
    document: { readyState:'loading', write(html) { manifestWrites.push(html); } },
  });
  const actualUrls = [...manifestWrites.join('').matchAll(/src="([^"]+)"/g)].map(match => match[1].split('?')[0]);
  assert.deepEqual(actualUrls, ['js/chest-lockpicking.js', 'js/wild-treasure.js'], 'the lock loads before its buried-treasure consumer');
  const liveHtml = fs.readFileSync(path.resolve(__dirname, '..', 'docs/index.html'), 'utf8');
  assert(liveHtml.includes('data-classic-group="wilderness-treasure"'), 'the page uses the shared parser-time group loader');
  assert(!liveHtml.includes('src="js/chest-lockpicking.js?v='), 'feature script versions stay out of the shared index');
  assert(liveHtml.indexOf('data-classic-group="wilderness-treasure"') < liveHtml.indexOf('<script src="game.js'), 'the lock group precedes gameplay');

  const doc = {
    body: { append() {} }, head: { append() {} }, activeElement: null, pointerLockElement: null,
    createElement: () => makeElement(),
  };
  const section = makeElement(), svg = makeElement(), target = makeElement();
  const byId = new Map(['.cl-dial', '#chestLockDial', '#chestLockTitle', '#chestLockProgress',
    '#chestLockFeedback', '#chestLockDebug', '.cl-x', '#chestLockCopy',
    '#chestLockButtons', '#chestLockDiagnostics', '#chestLockRetry'].map(key => [key, makeElement()]));
  byId.set('.cl-dial', svg); svg.querySelector = selector => selector === '#chestLockDial' ? target : null;
  section.querySelector = selector => byId.get(selector) || null;
  doc.createElement = tag => tag === 'section' ? section : makeElement();

  const queuedFrames = new Map(); // Only test frames actively requested by the minigame, never an always-on loop.
  const microtasks = []; // Explicitly captures deferred controller restore for same-dispatch assertions.
  let nextFrame = 1;
  const owners = []; // Ownership transitions, including the held lock on a successful last press.
  const controller = {
    owner: 'gameplay',
    setOwner(owner) { this.owner = owner; owners.push(owner); },
    subscribe(_owner, handler) { this.handler = handler; return () => { this.handler = null; }; },
    frame: () => ({ pad: null }),
  };
  const lock = { acquired: 0, released: 0, acquire() {
    lock.acquired++;
    return { release() { lock.released++; } };
  } };
  const keyEvents = new Map(); // Keyboard capture handlers let the regression simulate Escape without browser devtools.
  const window = {
    ControllerInput: controller, CharacterActionLocks: lock,
    addEventListener(type, callback) { keyEvents.set(type, callback); },
    removeEventListener(type, callback) { if (keyEvents.get(type) === callback) keyEvents.delete(type); },
    __farmLog() {},
  };
  const math = Object.create(Math);
  math.random = () => 0.5; // Every newly generated ring starts exactly at its target for deterministic completion.
  const context = {
    window, document: doc, navigator: {}, console,
    Math: math, queueMicrotask(fn) { microtasks.push(fn); },
    requestAnimationFrame(fn) { const id = nextFrame++; queuedFrames.set(id, fn); return id; },
    cancelAnimationFrame(id) { queuedFrames.delete(id); },
  };
  vm.runInNewContext(read('chest-lockpicking.js'), vm.createContext(context), { filename: 'chest-lockpicking.js' });
  vm.runInNewContext(read('attack-readiness.js'), vm.createContext(context), { filename: 'attack-readiness.js' }); // Uses the real AI readiness predicate for a lock's immediate combat handoff.
  const api = window.ChestLockpicking;
  const flushMicrotasks = () => { while (microtasks.length) microtasks.shift()(); };
  let now = 1000;
  context.performance = { now: () => now }; // Timestamp source shared with production keyboard, gamepad and RAF timing.
  const nextFrameTick = () => {
    const [id, fn] = queuedFrames.entries().next().value || [];
    assert(fn, 'the active lock must request the next animation frame');
    queuedFrames.delete(id);
    now += 50;
    fn(now);
  };
  const press = code => controller.handler?.({ focused: true, pressed: new Set([code]) });

  let wins = 0, cancels = 0;
  assert.equal(api.open({ id: 'first', tier: 1, valid: () => true, onSuccess() { wins++; }, onCancel() { cancels++; } }), true);
  assert.equal(controller.owner, 'chest-lockpicking');
  assert.equal(api.snapshot().rings.length, 2);
  press('Button4'); press('Button5'); // First lock set.
  assert.equal(api.snapshot().stage, 1);
  for (let i = 0; i < 14; i++) nextFrameTick(); // Complete the 650ms inter-set transition.
  assert.equal(api.snapshot().phase, 'playing');
  press('Button4'); press('Button5'); // Second set opens the chest.
  assert.equal(wins, 1);
  assert.equal(api.isActive(), false);
  assert.equal(controller.owner, 'chest-lockpicking', 'final shoulder press cannot leak to gameplay subscribers in the same poll');
  assert.equal(microtasks.length, 1, 'owner restoration is deferred until the shared poll unwinds');
  assert.equal(queuedFrames.size, 0, 'closing cancels the short-lived RAF loop');
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');
  assert.equal(lock.acquired, 1);
  assert.equal(lock.released, 1);

  // Target removed after last tick, immediately before the winning shoulder press.
  let valid = true;
  assert.equal(api.open({ id: 'removed', tier: 1, valid: () => valid, onSuccess() { wins++; }, onCancel(reason) {
    assert.equal(reason, 'invalid'); cancels++;
  } }), true);
  press('Button4'); press('Button5');
  for (let i = 0; i < 14; i++) nextFrameTick();
  press('Button4');
  valid = false;
  press('Button5');
  assert.equal(api.isActive(), false);
  assert.equal(wins, 1, 'stale target cannot receive an asynchronous reward');
  assert.equal(cancels, 1);
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');

  assert.equal(api.open({ id: 'cancel', tier: 4, valid: () => true, onSuccess() { wins++; }, onCancel() { cancels++; } }), true);
  assert.equal(api.snapshot().rings.length, 4);
  press('Button1');
  assert.equal(cancels, 2, 'B cancels without awarding treasure');
  assert.equal(wins, 1);
  assert.equal(api.isActive(), false);
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');
  assert.equal(lock.acquired, 3);
  assert.equal(lock.released, 3);


  // Use the real character save queue, including capture and quota failure behavior.
  const storedMeta = {characters:[{id:'char_a'},{id:'char_b'}],worlds:[{id:'world_a'},{id:'world_b'}]};
  let saveWrites=0, quotaFull=false, readBlocked=false, folderWrites=0; // Detect any lock-triggered storage or folder I/O.
  context.localStorage={
    getItem(key){if(readBlocked)throw Error('read unavailable');return key==='hobunjiSaveMeta'?JSON.stringify(storedMeta):null;},
    setItem(key,value){assert.equal(key,'hobunjiSaveMeta');if(quotaFull)throw Error('quota');saveWrites++;Object.assign(storedMeta,JSON.parse(value));}
  };
  window.__hobunjiPlayerProfile={characterId:'char_a',worldId:'world_a'};
  vm.runInNewContext(read('character-meta-save.js'),context,{filename:'character-meta-save.js'});
  const metaApi=window.CharacterMetaSave; // Production mutation queue, not a mocked persistence path.
  const recordFor=(id,character=0,world='world_a')=>storedMeta.characters[character].chestLockProgress?.[world]?.[id];
  const capturedRecord=(id,character=0,world='world_a')=>{
    const copy=JSON.parse(JSON.stringify(storedMeta)); // Simulate regular snapshot capture without disk.
    metaApi.capturePending(copy);return copy.characters[character].chestLockProgress?.[world]?.[id];
  };
  window.LocalSaveFolder={
    getStatus:()=>({state:'ready',autoSyncArmed:true}),
    canSaveLockProgress:()=>true,
    saveLockProgress(){folderWrites++;throw Error('Unexpected targeted save');},
    syncNow(){folderWrites++;throw Error('Unexpected full save');}
  };
  window.HobunjiRuntimeSave={captureSnapshot(){throw Error('Unexpected world capture');}};
  const awards=[]; // Exact scoring and reward callback assertions.
  const advance=()=>{for(let i=0;i<14;i++)nextFrameTick();};
  const missOuter=()=>{for(let i=0;i<12;i++)nextFrameTick();press('Button4');}; // Well outside the widened tier-one window.
  assert.deepEqual(Array.from(Object.values(api.PRESETS),p=>p.window),[26,23,20,18]);
  assert.deepEqual(Array.from(Object.values(api.PRESETS),p=>p.slipMs),[6500,9000,10000,14000]);
  api.open({id:'flawless',tier:1,onSuccess:a=>awards.push(a)});
  press('Button4');press('Button5');
  assert.equal(api.snapshot().phase,'transition');
  assert.equal(recordFor('flawless'),undefined);
  assert.equal(capturedRecord('flawless').stage,1);
  advance();press('Button4');press('Button5');
  assert.equal(awards[0].bestStreak,4);
  assert.equal(awards[0].bonusDrops,1);
  assert.equal(capturedRecord('flawless').stage,2);
  flushMicrotasks();

  api.open({id:'persistent',tier:1,onSuccess:a=>awards.push(a)});
  press('Button4');press('Button5');advance();
  missOuter();missOuter();
  assert.equal(api.snapshot().phase,'playing','repeated misses never block on storage');
  assert.equal(api.snapshot().stage,1);
  assert.equal(api.snapshot().streak,0);
  assert.equal(capturedRecord('persistent').misses,2);
  assert.equal(capturedRecord('persistent').failedStage,1);
  press('Button1');flushMicrotasks();
  api.open({id:'persistent',tier:1,onSuccess:a=>awards.push(a)});
  assert.equal(api.snapshot().stage,1);
  assert.equal(api.snapshot().misses,2);
  assert.equal(api.snapshot().streak,0);
  press('Button1');flushMicrotasks();
  assert.equal(saveWrites,0);
  assert.equal(folderWrites,0);

  window.__hobunjiPlayerProfile={characterId:'char_b',worldId:'world_a'};
  api.open({id:'persistent',tier:1,onSuccess(){}});
  assert.equal(api.snapshot().stage,0);press('Button1');flushMicrotasks();
  window.__hobunjiPlayerProfile={characterId:'char_a',worldId:'world_b'};
  api.open({id:'persistent',tier:1,onSuccess(){}});
  assert.equal(api.snapshot().stage,0);press('Button1');flushMicrotasks();
  window.__hobunjiPlayerProfile={characterId:'char_a',worldId:'world_a'};

  quotaFull=true;
  metaApi.flush(); // Failed browser mirror leaves queued progress for normal folder capture.
  assert.equal(saveWrites,0);
  assert.equal(capturedRecord('persistent').misses,2);
  api.open({id:'persistent',tier:1,onSuccess:a=>awards.push(a)});
  press('Button4');press('Button5');
  assert.equal(awards[1].bestStreak,2);
  assert.equal(awards[1].bonusDrops,0);
  assert.equal(api.isActive(),false);
  flushMicrotasks();
  quotaFull=false;
  metaApi.flush();
  assert.equal(saveWrites,1,'one normal flush batches multiple locks');
  assert.equal(recordFor('persistent').stage,2);
  assert.equal(recordFor('flawless').stage,2);
  assert.equal(folderWrites,0);
  metaApi.flush();assert.equal(saveWrites,1);

  api.open({id:'hard',tier:4,onSuccess:a=>awards.push(a)});
  const catchFour=()=>{for(const button of ['Button4','Button5','LeftTrigger','RightTrigger'])press(button);};
  catchFour();advance();catchFour();advance();catchFour();
  assert.equal(awards[2].bestStreak,12);assert.equal(awards[2].bonusDrops,4);flushMicrotasks();

  api.open({id:'abandon',tier:1,onSuccess(){}});
  press('Button4');press('Button1');flushMicrotasks();
  assert.equal(capturedRecord('abandon').misses,1);
  assert.equal(capturedRecord('abandon').failedStage,0);
  api.open({id:'abandon',tier:1,onSuccess(){}});
  assert.equal(api.snapshot().streak,0);press('Button1');flushMicrotasks();

  // A legacy failed-folder marker is not a gameplay gate.
  storedMeta.characters[0].chestLockProgress.world_a.legacy={version:2,tier:1,stage:1,misses:1,failedStage:1,folderUnsynced:true};
  api.open({id:'legacy',tier:1,onSuccess(){}});
  assert.equal(api.snapshot().phase,'playing');assert.equal(api.snapshot().stage,1);
  missOuter();assert.equal(capturedRecord('legacy').folderUnsynced,false);
  press('Button1');flushMicrotasks();

  api.open({id:'stutter',tier:4,onSuccess(){}});
  nextFrameTick();
  const beforeStutter=api.snapshot().rings.map(r=>r.angle);
  const [stutterId,stutterFn]=queuedFrames.entries().next().value;
  queuedFrames.delete(stutterId);now+=1400;stutterFn(now);
  assert.equal(JSON.stringify(api.snapshot().rings.map(r=>r.angle)),JSON.stringify(beforeStutter));
  assert.equal(api.snapshot().stutters,1);assert.equal(api.snapshot().lastStallMs,1400);
  press('Button1');flushMicrotasks();
  api.open({id:'stutter-input',tier:4,onSuccess(){}});
  for(let i=0;i<3;i++)nextFrameTick(); // 19.14 degrees: just outside the tier-four window, within stall grace.
  assert(api.snapshot().rings[0].angle-180>api.PRESETS[4].window);
  now+=1000;press('Button4');
  assert.equal(api.snapshot().rings[0].frozen,true);
  assert.equal(api.snapshot().misses,0);
  press('Button1');flushMicrotasks();

  api.open({id:'switch',tier:1,onSuccess(){throw Error('wrong-character award');}});
  press('Button4');
  window.__hobunjiPlayerProfile={characterId:'char_b',worldId:'world_a'};
  press('Button5');flushMicrotasks();
  assert.equal(api.isActive(),false);
  assert.equal(capturedRecord('switch',1),undefined);
  window.__hobunjiPlayerProfile={characterId:'char_a',worldId:'world_a'};
  assert.equal(window.AttackReadiness.activityFor({health:100}),null);
  assert.equal(lock.acquired,lock.released);
  assert.equal(folderWrites,0);
  assert.equal(saveWrites,1);

  // A completed lock whose consumer could not open must keep its final stage and exact score.
  let retryAward=null; // Simulates a valid chest whose original reward handoff was rejected by its own save guard.
  assert(api.open({id:'flawless',tier:1,valid:()=>true,onSuccess:a=>{retryAward=a;}}));
  assert.equal(api.snapshot().phase,'reward-ready');
  assert.equal(api.snapshot().stage,2);
  assert.equal(retryAward,null,'reward retry remains asynchronous relative to the world action');
  nextFrameTick();
  assert.equal(retryAward.bestStreak,awards[0].bestStreak);
  assert.equal(retryAward.bestScore,awards[0].bestScore);
  assert.equal(retryAward.bonusDrops,awards[0].bonusDrops);
  assert.equal(api.isActive(),false);
  assert.equal(capturedRecord('flawless').stage,2);
  flushMicrotasks();

  // A target can disappear between RAF and either a successful catch or a miss.
  let liveTarget=true;
  api.open({id:'invalid-mid-set',tier:1,valid:()=>liveTarget,onSuccess(){throw Error('stale reward');}});
  press('Button4');liveTarget=false;press('Button5');
  assert.equal(api.snapshot().lastOutcome.outcome,'invalid');
  assert.equal(capturedRecord('invalid-mid-set'),undefined);
  flushMicrotasks();

  // Pending progress remains readable even when browser storage reads fail.
  api.open({id:'read-blocked',tier:1,onSuccess(){}});
  press('Button4');press('Button5');advance();missOuter();press('Button1');flushMicrotasks();
  readBlocked=true;
  api.open({id:'read-blocked',tier:1,onSuccess(){}});
  assert.equal(api.snapshot().stage,1);
  assert.equal(api.snapshot().misses,1);
  press('Button1');flushMicrotasks();
  // If the queue itself is unavailable, keep an emergency in-memory record and restage on reentry.
  delete window.CharacterMetaSave;
  api.open({id:'queue-blocked',tier:1,onSuccess(){}});
  missOuter();press('Button1');flushMicrotasks();
  api.open({id:'queue-blocked',tier:1,onSuccess(){}});
  assert.equal(api.snapshot().misses,1);
  press('Button1');flushMicrotasks();
  window.CharacterMetaSave=metaApi;
  readBlocked=false;
  api.open({id:'queue-blocked',tier:1,onSuccess(){}});
  assert.equal(capturedRecord('queue-blocked').misses,1);
  press('Button1');flushMicrotasks();

  // Verify the longer slip timer in live ticks, not just preset values.
  api.open({id:'slip',tier:1,onSuccess(){}});
  press('Button4');
  for(let i=0;i<90;i++)nextFrameTick(); // Past the former 4.2 s limit.
  assert.equal(api.snapshot().misses,0);
  assert.equal(api.snapshot().rings[0].frozen,true);
  for(let i=0;i<45;i++)nextFrameTick();
  assert.equal(api.snapshot().misses,1);
  assert.equal(api.snapshot().phase,'playing');
  press('Button1');flushMicrotasks();
  assert.equal(saveWrites,1,'none of the retries, slips or invalidations forces storage');
  assert.equal(folderWrites,0);
  assert.equal(lock.acquired,lock.released);

  // Buried chest exercises the actual world action and existing async reward
  // callback, rather than testing the UI without granting real inventory.
  const area = 'zone_test';
  const TileType = { TRENCH: 'trench' };
  const grid = [[{ type: TileType.TRENCH }]];
  const chestMesh = {};
  const placement = {
    col: 0, row: 0, found: false, _mesh: chestMesh,
    loot: { metalKeys: ['tin'], gold: 5 },
  };
  const objectMap = new Map(), persisted = { week: 0, placements: [placement] };
  const flushed = [], toasts = [], activity = [], started = [];
  const inventory = {};
  const treasureWindow = {
    ChestLockpicking: { open(options) { started.push(options); return true; } },
    HobunjiRuntimeSave: { flushNow(options) { flushed.push(options); return { ok: true, captured: true }; } },
    InventoryStacks: { MAX_TOTAL: 999 },
    HobunjiActivityEvents: { emit(name, detail) { activity.push([name, detail]); } },
  };
  const treasureContext = { window: treasureWindow, console };
  vm.runInNewContext(read('wild-treasure.js'), vm.createContext(treasureContext), { filename: 'wild-treasure.js' });
  treasureWindow.WildTreasure.init({
    calendar: { day: 1 },
    _zoneTreasurePersist: new Map([[area, persisted]]),
    _zoneTreasureObjects: new Map([[area, objectMap]]),
    _zoneTreasureMeshGroups: new Map([[area, [chestMesh]]]),
    _zoneScenes: new Map([[area, { grid, scene: { remove() {} } }]]),
    TileType, getCurrentArea: () => area, rnd: () => 0, VERDIGRIS_METAL_KEYS: ['tin'],
    metalBarItemKey: name => name + 'Bar', METAL_DEFS: { tin: { label: 'Tin' } },
    ITEM_DEFS: {}, inventory,
    refreshItemScroll() {}, buildInventoryGrid() {}, buildPackClothingSection() {},
    showToast(message) { toasts.push(message); },
  });
  treasureWindow.WildTreasure.syncZoneInteractivity(area);
  const chest = objectMap.get('0,0');
  assert(chest);
  placement.lockpickUnlocked = true; // Legacy persisted bit must never authorize bypassing a new chest's minigame.
  assert.equal(chest.onAction('obj_open_treasure_chest').ok, false);
  assert.equal(started.length, 1);
  assert.equal(started[0].valid(), true);
  persisted.placements = []; // Weekly re-scatter/removal invalidates a previously targeted buried chest.
  assert.equal(started[0].valid(), false, 'a replaced chest may not grant old loot');
  persisted.placements = [placement];
  assert.equal(started[0].valid(), true);
  assert.equal(flushed.length, 0);
  assert.equal(inventory.gold, undefined);
  started[0].onSuccess({ bonusDrops: 1 }); // The real decorated chest action must preserve earned bonus metadata.
  assert.equal(placement.found, true);
  assert.equal(inventory.gold, 5);
  assert.equal(inventory.tinBar, 2, 'earned bonus adds one more real town-gated metal bar');
  assert.equal(flushed.length, 1, 'asynchronous chest loot commits the canonical live game save');
  assert.equal(flushed[0].reason, 'buried-chest-lockpicked');
  assert.equal(placement.lockpickUnlocked, true, 'legacy save metadata is ignored and never used for new bypass authorization');
  assert.equal(activity.length, 1);
  assert.equal(chest.onAction('obj_open_treasure_chest').ok, false, 'stale world object cannot grant the same treasure twice');

  console.log('PASS chest-lockpicking integration: permanent stages, saved failure penalty, scored bonus loot, stalled frames, cancel, invalid targets and buried treasure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
