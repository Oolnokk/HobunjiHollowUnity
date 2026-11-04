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
    disabled: false, attributes: new Map(),
    setAttribute(key, value) { this.attributes.set(key, String(value)); },
    getAttribute(key) { return this.attributes.get(key); },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children.length = 0; },
    addEventListener() {}, focus() {}, blur() {},
    closest(selector) { return selector === '#chestLockOverlay' ? this : null; },
    querySelector() { return null; },
  };
}

(async () => {
  const doc = {
    body: { append() {} }, head: { append() {} }, activeElement: null, pointerLockElement: null,
    createElement: () => makeElement(),
  };
  const section = makeElement(), svg = makeElement(), target = makeElement();
  const byId = new Map(['.cl-dial', '#chestLockDial', '#chestLockTitle', '#chestLockProgress',
    '#chestLockFeedback', '#chestLockDebug', '.cl-x', '#chestLockCopy',
    '#chestLockButtons', '#chestLockDiagnostics'].map(key => [key, makeElement()]));
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
  const window = {
    ControllerInput: controller, CharacterActionLocks: lock,
    addEventListener() {}, removeEventListener() {}, __farmLog() {},
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
  const api = window.ChestLockpicking;
  const flushMicrotasks = () => { while (microtasks.length) microtasks.shift()(); };
  let now = 1000;
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
    TileType, getCurrentArea: () => area,
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
  started[0].onSuccess();
  assert.equal(placement.found, true);
  assert.equal(inventory.gold, 5);
  assert.equal(inventory.tinBar, 1);
  assert.equal(flushed.length, 1, 'asynchronous chest loot commits the canonical live game save');
  assert.equal(flushed[0].reason, 'buried-chest-lockpicked');
  assert.equal(placement.lockpickUnlocked, true, 'legacy save metadata is ignored and never used for new bypass authorization');
  assert.equal(activity.length, 1);
  assert.equal(chest.onAction('obj_open_treasure_chest').ok, false, 'stale world object cannot grant the same treasure twice');

  console.log('PASS chest-lockpicking integration: 2/4 rings, cancel and stale-target protection, controller frame release, buried treasure + immediate save.');
})().catch(error => { console.error(error); process.exitCode = 1; });
