#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('docs/js/npc-furniture-wardrobe-bridge-v4.js');
const loader = read('docs/js/combat/combat-config-loader.js');
const innMap = JSON.parse(read('docs/config/maps/map_i_inn.json'));
const rawNpcDatabase = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json'));
const scheduleOverrides = JSON.parse(read('docs/config/npcs/schedule-overrides.json'));
const registry = JSON.parse(read('docs/config/npcs/placeholder-wardrobes.json'));
const removedNpcIds = new Set(scheduleOverrides.removeNpcIds || []);
const runtimeNpcDatabase = { ...rawNpcDatabase, npcs: (rawNpcDatabase.npcs || []).filter(rec => !removedNpcIds.has(rec.id)) };

assert.doesNotThrow(() => new vm.Script(source, { filename: 'npc-furniture-wardrobe-bridge-v4.js' }), 'wardrobe v4 must parse');
assert.doesNotMatch(source, /\b(?:requestAnimationFrame|setInterval)\s*\(/, 'placeholder wardrobes must not introduce a permanent polling loop');
assert.match(source, /placeholderEnabled:\s*true/, 'placeholder registry is modular and enabled by default');
assert.match(source, /LocalDBOverrides\?\.loadDatabase[\s\S]*?loadDatabase\('npcDatabase'\)/, 'placeholder eligibility uses the same post-override NPC database as the game');
assert.match(source, /delete button\.dataset\.action/, 'suppression removes the semantic wardrobe action rather than merely hiding the button');
assert.match(source, /buttons\.filter\(entry => actionId\(entry\) !== 'npc_open_wardrobe'\)/, 'world popup filtering removes old NPC-centered wardrobe rows');
assert.match(loader, /npc-furniture-wardrobe-bridge-v4\.js/, 'runtime loader uses registry-backed wardrobe v4');

const seenPopupButtons = [];
const popupStub = {
  syncInteractionPrompts(options = {}) {
    seenPopupButtons.push(...(options.buttons || []));
    return options.buttons || [];
  },
};
const wardrobeWindow = {
  SCRATCHBONES_CONFIG: { game: { input: { targeting: { orbitRadiusTiles: 0.62 } } } },
  NpcWardrobe: { openWardrobePanel() { return true; } },
  WorldPopupText: popupStub,
  LocalDBOverrides: { loadDatabase(id) { assert.equal(id, 'npcDatabase'); return Promise.resolve(runtimeNpcDatabase); } },
  __hobunjiFurnitureDebug: { getCurrentArea: () => null, playerState: null, targetAimAngleDeg: 0 },
  matchMedia: () => ({ matches: false }),
};
const documentStub = {
  readyState: 'complete',
  documentElement: { dataset: {} },
  body: { dataset: {} },
  getElementById() { return null; },
  addEventListener() {},
};
class MutationObserverStub { observe() {} }

vm.runInNewContext(source, {
  window: wardrobeWindow,
  document: documentStub,
  MutationObserver: MutationObserverStub,
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  queueMicrotask(fn) { fn(); },
  localStorage: { getItem: () => null },
  Math,
  console,
});

const api = wardrobeWindow.NpcFurnitureWardrobes;
assert.equal(api?.version, 4, 'wardrobe v4 installs');
assert.equal(api?.eventDriven, true, 'wardrobe v4 stays event-driven');

const hreesh = runtimeNpcDatabase.npcs.find(rec => rec.id === 'hreesh');
assert(hreesh, 'runtime-effective NPC database contains Hreesh');
assert.equal(hreesh.homeId, 'inn', 'Hreesh is an inn resident in the real NPC database');
assert.equal(runtimeNpcDatabase.npcs.some(rec => rec.id === 'hammerhead_tuhupnuk'), false, 'runtime-effective NPC database excludes schedule-override removals');

const placeholders = api.placeholderWardrobeBindings(innMap, 'map_i_inn', runtimeNpcDatabase, registry);
const hreeshPlaceholder = placeholders.find(binding => binding.npcId === 'hreesh');
assert(hreeshPlaceholder, 'Hreesh resolves his explicit temporary registry entry in the real inn map');
assert.equal(hreeshPlaceholder.source, 'placeholder-registry', 'Hreesh fallback is explicitly marked temporary registry data');
assert.equal(hreeshPlaceholder.id, 'fmss04iltqngq', 'Hreesh uses the selected long-table placeholder');
assert(innMap.furniture.some(piece => piece.id === hreeshPlaceholder.id), 'Hreesh placeholder points to an existing placed inn furniture instance');

const authoredOverrideMap = JSON.parse(JSON.stringify(innMap));
const overridePiece = authoredOverrideMap.furniture.find(piece => piece.id && piece.id !== hreeshPlaceholder.id) || authoredOverrideMap.furniture[0];
overridePiece.npcWardrobeFor = 'hreesh';
const combined = api.wardrobeBindings(authoredOverrideMap, 'map_i_inn', runtimeNpcDatabase, registry);
const hreeshBindings = combined.filter(binding => binding.npcId === 'hreesh');
assert.equal(hreeshBindings.length, 1, 'authored npcWardrobeFor replaces rather than duplicates Hreesh placeholder in the authored interior');
assert.equal(hreeshBindings[0].source, 'authored', 'explicit authored wardrobe always wins over placeholder registry logic');

const registryWithRemovedNpc = JSON.parse(JSON.stringify(registry));
registryWithRemovedNpc.assignments.hammerhead_tuhupnuk = { area: 'map_i_inn', furnitureId: 'fmqj09loev97n', itemKey: 'stoolFurniture', reason: 'test' };
const filtered = api.placeholderWardrobeBindings(innMap, 'map_i_inn', runtimeNpcDatabase, registryWithRemovedNpc);
assert.equal(filtered.some(binding => binding.npcId === 'hammerhead_tuhupnuk'), false, 'registry cannot resurrect a runtime-removed NPC');

popupStub.syncInteractionPrompts({
  buttons: [
    { action: 'npc_open_wardrobe', label: 'Wardrobe' },
    { action: 'npc_offer_gift', label: 'Gift' },
  ],
});
assert.equal(seenPopupButtons.some(entry => entry.action === 'npc_open_wardrobe'), false, 'old NPC wardrobe prompt is removed before WorldPopupText receives it');
assert.equal(seenPopupButtons.some(entry => entry.action === 'npc_offer_gift'), true, 'non-wardrobe NPC prompts are preserved');

console.log(`NPC wardrobe v4 regression passed. Hreesh placeholder: ${hreeshPlaceholder.id} (${hreeshPlaceholder.itemKey}).`);
