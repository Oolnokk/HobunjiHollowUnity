#!/usr/bin/env node
'use strict';
// Runs js/grid-tile-accessors.js's den collision with a counting ZoneDenTotemFeatures: within one task every den's
// collision state is looked up once however many tiles creature pathfinding asks about; a new task, a den moved or
// resized, a changed entrance template, or any recompute in the den module (locale edit, source switch) looks it up
// again; with the memo switched off every tile asks again (the previous behaviour).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let calls = 0, generation = 0;
const states = new Map(); // den -> state the fake den module returns
const context = vm.createContext({ Promise, Map, WeakMap, Number, Math, Object, Array, Set, queueMicrotask });
context.window = context;
context.ZoneDenTotemFeatures = {
  denEntranceCollisionState(den) { calls++; return states.get(den) || null; },
  denCollisionGeneration: () => generation,
};
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/grid-tile-accessors.js'), 'utf8'), context, { filename: 'grid-tile-accessors.js' });
const G = context.GridTileAccessors;
const area = 'zone_test';
const denA = { x: 10, y: 10, w: 4, h: 4, mouthAnchor: { x: 12, y: 14 }, entranceTemplateId: 'cave_small' };
const denB = { x: 30, y: 10, w: 4, h: 4, mouthAnchor: { x: 32, y: 14 } };
states.set(denA, { bounds: { x: 10, y: 10, w: 4, h: 4 }, rects: [{ x: 10, y: 10, w: 4, h: 2 }], useLegacyCave: false });
states.set(denB, { bounds: { x: 30, y: 10, w: 4, h: 4 }, rects: [], useLegacyCave: true });
G.init({ _zoneLayouts: new Map([[area, { dens: [denA, denB] }]]) });
const nextTask = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // One A*-style burst: hundreds of tiles, two dens.
  let blocked = 0;
  for (let col = 0; col < 40; col++) for (let row = 0; row < 20; row++) if (G.isAnimalDenCollisionTile(col, row, area)) blocked++;
  assert.equal(calls, 2, 'each den looked up once for 800 tile checks in one task');
  assert.ok(G.isAnimalDenCollisionTile(11, 10, area), 'authored rect still blocks');
  assert.equal(G.isAnimalDenCollisionTile(11, 13, area), false, 'outside the authored rects stays open (authored cave)');
  assert.ok(G.isAnimalDenCollisionTile(30, 10, area), 'legacy cave shell still blocks');
  assert.equal(calls, 2);
  const snap = G.debugSnapshot().denStateMemo;
  assert.equal(snap.enabled, true);
  assert.equal(snap.computed, 2);

  // A den moved within the same task is looked up again at once.
  denA.x = 11; states.set(denA, { bounds: { x: 11, y: 10, w: 4, h: 4 }, rects: [{ x: 11, y: 10, w: 4, h: 2 }], useLegacyCave: false });
  assert.ok(G.isAnimalDenCollisionTile(14, 10, area), 'moved den blocks at its new position');
  assert.equal(calls, 3);
  denA.entranceTemplateId = 'cave_wide';
  G.isAnimalDenCollisionTile(0, 0, area);
  assert.equal(calls, 4, 'a changed entrance template is looked up again');
  denA.mouthAnchor = { x: 13, y: 14 };
  G.isAnimalDenCollisionTile(0, 0, area);
  assert.equal(calls, 5, 'a moved mouth is looked up again');

  // Any recompute in the den module (a locale edit reaching it, a source switch) drops the memo.
  generation++;
  G.isAnimalDenCollisionTile(0, 0, area);
  assert.equal(calls, 7, 'both dens looked up again after the den module recomputed');

  // A new task starts fresh (edits arrive in their own task).
  await nextTask();
  G.isAnimalDenCollisionTile(0, 0, area); G.isAnimalDenCollisionTile(1, 1, area);
  assert.equal(calls, 9, 'next task: one lookup per den again');

  // Off: every tile asks the den module (previous behaviour).
  assert.equal(G.setDenStateMemoEnabled(false), false);
  const before = calls;
  for (let i = 0; i < 10; i++) G.isAnimalDenCollisionTile(i, 0, area);
  assert.equal(calls, before + 20, 'memo off: each tile checks every den');
  G.setDenStateMemoEnabled(true);
  console.log(`den collision memo: one lookup per den per task (${blocked} of 800 tiles blocked), moved/re-templated dens and den-module recomputes looked up at once, per-tile when off`);
})().catch(error => { console.error(error); process.exit(1); });
