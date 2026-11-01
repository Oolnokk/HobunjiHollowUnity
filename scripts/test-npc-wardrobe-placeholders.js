#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8'); // Reads the shipped runtimes and authored maps, not copied test fixtures.
const room = JSON.parse(read('docs/config/maps/map_i_inn_F2_hreesh.json')); // A real explicitly authored NPC bedroom.
const temple = JSON.parse(read('docs/config/maps/map_i_temple.json')); // A real registry-fallback interior.
const rawDb = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json')); // Existing NPC ids and home assignments.
const overrides = JSON.parse(read('docs/config/npcs/schedule-overrides.json')); // Runtime removals must invalidate placeholders.
const removed = new Set(overrides.removeNpcIds || []); // Mirrors the local NPC database removal list.
const runtimeDb = { ...rawDb, npcs: (rawDb.npcs || []).filter(npc => !removed.has(npc.id)) }; // Post-override DB is authoritative.
const registry = JSON.parse(read('docs/config/npcs/placeholder-wardrobes.json')); // Shipping fallback assignments.

const bridgeSource = read('docs/js/npc-furniture-wardrobe-bridge-v5.js');
const furnitureSource = read('docs/js/furniture-table-system.js');
const loaderSource = read('docs/js/combat/combat-config-loader.js');
const gameplaySource = read('docs/game.js');
const saveSource = read('docs/js/farm-editor.js');
const placerSource = read('docs/js/furniture-placer.js');
assert.doesNotThrow(() => new vm.Script(bridgeSource));
assert.doesNotThrow(() => new vm.Script(furnitureSource));
assert.match(loaderSource, /npc-furniture-wardrobe-bridge-v5\.js/, 'the shipped loader installs the furniture-owned v5 adapter');
assert.doesNotMatch(bridgeSource, /\b(?:requestAnimationFrame|setInterval|MutationObserver)\s*\(/, 'no permanent wardrobe polling or DOM arch injection');
assert.doesNotMatch(bridgeSource, /syncInteractionPrompts\s*=/, 'the normal world prompt and its input glyphs must not be filtered or replaced');
assert.match(gameplaySource, /promptInputs,[\s\S]*?showInputHints: true/, 'ordinary world prompts include keyboard/gamepad/touch input hints');
assert.doesNotMatch(gameplaySource, /btns\.push\(\{\s*icon: '👗',[\s\S]{0,250}npc_open_wardrobe/, 'no old NPC-proximity wardrobe button');
assert.match(saveSource, /npcWardrobeFor: obj\.npcWardrobeFor/, 'furniture assignments must be saved in the farm layout');
assert.match(saveSource, /restoredObject\.npcWardrobeFor = String\(npcWardrobeFor\)/, 'restored chest must regain its exact NPC owner');
assert.match(placerSource, /assignWardrobeOwner/, 'house furniture menu must expose wardrobe owner assignments');
assert.match(gameplaySource, /assignWardrobeOwner: \(id, npcId\)/, 'furniture menu updates the real placed record');

(async () => {
  const opened = []; // Tracks the existing NPC wardrobe's actual ID-keyed opening.
  const openedContexts = []; // Verifies the targeter passes validated furniture assignment provenance to the wardrobe.
  let spouseId = 'aliri_ginju'; // Live spouse changes validate assignments, not a stale snapshot.
  let familySnapshotCalls = 0; // Ensures per-frame focus checks do not repeatedly allocate full family snapshots.
  const popup = { syncInteractionPrompts() {} }; // An ordinary popup must survive untouched by the bridge.
  const w = {
    WorldPopupText: popup,
    SCRATCHBONES_CONFIG: { game: {} },
    LocalDBOverrides: { loadDatabase: async () => runtimeDb },
    NpcWardrobe: { openWardrobePanel: (id, context) => { opened.push(id); openedContexts.push(context); return true; } },
    RomanceSystem: { getSpouse: () => spouseId ? { npcId: spouseId } : null, helpers: { npcName: id => id === 'aliri_ginju' ? 'Aliri' : id } },
    RomanceFamily: { snapshot: () => { familySnapshotCalls++; return { children: [{ id: 'child_tester', name: 'Hushka' }] }; },
      isWardrobeChild: id => id === 'child_tester', wardrobeChildName: id => id === 'child_tester' ? 'Hushka' : null },
  }; // Browser globals are limited to the public integration seams used in production.
  const fetchStub = async url => {
    const file = path.resolve(__dirname, '..', 'docs', url); // All registry/map calls use shipping relative URLs.
    if (!file.startsWith(path.resolve(__dirname, '..', 'docs') + path.sep)) throw new Error('Unexpected wardrobe URL ' + url);
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  vm.runInNewContext(bridgeSource, { window: w, fetch: fetchStub, console, Math, Promise });
  const api = w.NpcFurnitureWardrobes;
  assert.equal(api.version, 5);
  assert.equal(w.WorldPopupText, popup, 'v5 leaves floating prompts and bindings under the normal UI owner');

  assert.equal(api.wardrobeBindings(room, 'map_i_inn_F2_hreesh', runtimeDb, registry).filter(b => b.npcId === 'hreesh').length, 1);
  const hreesh = room.furniture.find(piece => piece.npcWardrobeFor === 'hreesh');
  assert(hreesh, 'author explicitly bound Hreesh to bedroom furniture');
  assert.equal(api.ownerForPlacement('map_i_inn_F2_hreesh', hreesh).npcId, 'hreesh', 'authored metadata targets the exact piece immediately');
  const fallback = api.placeholderWardrobeBindings(temple, 'map_i_temple', runtimeDb, registry).find(b => b.npcId === 'bird_bone');
  assert(fallback, 'legacy registry links a real piece for Bird Bone');
  assert.equal(fallback.source, 'placeholder-registry');
  assert(!api.placeholderWardrobeBindings(temple, 'map_i_temple', runtimeDb, registry).some(b => removed.has(b.npcId)), 'removed NPCs do not revive through the fallback');
  await api.primeArea('map_i_temple');
  const fallbackPiece = temple.furniture.find(piece => piece.id === fallback.id);
  assert.equal(api.ownerForPlacement('map_i_temple', fallbackPiece).npcId, 'bird_bone', 'the registry resolves by existing furniture ID, not aim proximity');

  const spouseChest1 = { id: 'family-chest-a', key: 'chest', npcWardrobeFor: 'aliri_ginju', col: 2, row: 2 };
  const spouseChest2 = { id: 'family-chest-b', key: 'wardrobe', npcWardrobeFor: 'aliri_ginju', col: 8, row: 2 };
  const childChest = { id: 'family-child', key: 'chest', npcWardrobeFor: 'child_tester', col: 5, row: 2 };
  assert.equal(api.ownerForPlacement('interior', spouseChest1).npcId, api.ownerForPlacement('interior', spouseChest2).npcId, 'duplicate furniture points at exactly one inventory key');
  assert.equal(api.ownerForPlacement('interior', childChest).npcId, 'child_tester');
  for (let iteration = 0; iteration < 100; iteration++) api.ownerForPlacement('interior', childChest); // Simulate repeated camera-frame focus polls.
  assert.equal(familySnapshotCalls, 0, 'repeated wardrobe targeting must not request heavy family snapshots');
  assert.equal(api.ownerForPlacement('interior', { key: 'desk', npcWardrobeFor: 'aliri_ginju' }), null, 'other furniture cannot masquerade as family storage');
  assert.equal(api.ownerForPlacement('farm', spouseChest1), null, 'family wardrobe assignment is house-only');
  assert.equal(api.ownerForPlacement('interior', { key: 'wardrobe', npcWardrobeFor: 'outsider' }), null, 'nonfamily wardrobe access is denied');

  vm.runInNewContext(furnitureSource, { window: w, performance: { now: () => 0 }, console });
  const tables = w.FurnitureTableSystem;
  let aimedX = 2.5, frame = 0; // Simulates the real ray selector choosing the model under the reticle.
  tables.init({
    getArea: () => 'interior',
    getPlayerPosition: () => ({ x: 5, z: 2.5 }),
    getWalkers: () => [],
    getAim: () => ({ c: aimedX, r: 2.5 }),
    frameId: () => frame,
    focusCandidates: candidates => {
      const candidate = candidates.find(item => item.box?.min.x <= aimedX && item.box?.max.x >= aimedX);
      return candidate ? { candidate, distanceWorld: 1 } : null;
    },
  });
  const mesh = x => ({ parent: {}, position: { x, y: 0, z: 2.5 }, scale: { x: 1, y: 1, z: 1 }, userData: {} }); // Real placement root is the anchor, not an NPC or synthetic tile.
  const mesh1 = mesh(2.5), mesh2 = mesh(8.5), mesh3 = mesh(5.5);
  tables.registerPlacement('interior', spouseChest1, mesh1, { fw: 1, fd: 1 });
  tables.registerPlacement('interior', spouseChest2, mesh2, { fw: 1, fd: 1 });
  tables.registerPlacement('interior', childChest, mesh3, { fw: 1, fd: 1 });
  let target = tables.objectAt('interior', 2, 2);
  assert.equal(target?.getButtons()[0].action, 'obj_open_wardrobe', 'wardrobe uses normal obj_* dispatch');
  assert.equal(target?.getButtons()[0].promptRoot, mesh1, 'the popup floats over the exact selected furniture root');
  assert.equal(target?.getButtons()[0].worldInteraction, true);
  assert.match(target?.getButtons()[0].label, /Aliri/);
  assert.equal(target.onAction('obj_open_wardrobe').ok, true);
  aimedX = 8.5; frame++;
  target = tables.objectAt('interior', 8, 2);
  assert.equal(target?.getButtons()[0].promptRoot, mesh2);
  target.onAction('obj_open_wardrobe');
  aimedX = 5.5; frame++;
  target = tables.objectAt('interior', 5, 2);
  assert.equal(target?.getButtons()[0].promptRoot, mesh3);
  target.onAction('obj_open_wardrobe');
  assert.deepEqual(opened, ['aliri_ginju', 'aliri_ginju', 'child_tester'], 'two chests share spouse contents, while child inventory is distinct');
  assert.deepEqual(openedContexts.map(context => context?.source), ['family', 'family', 'family'], 'only furniture already validated as family storage is marked with family provenance');
  assert.ok(openedContexts.every(context => context?.area === 'interior'), 'wardrobe bridge preserves the physical furniture area for spouse override validation');

  aimedX = 20; frame++;
  assert.equal(tables.objectAt('interior', 20, 2), null, 'no floating prompt or wardrobe action for an unaimed object');
  spouseId = null; aimedX = 2.5; frame++;
  assert.equal(tables.objectAt('interior', 2, 2), null, 'assignment cannot open a former spouse after household changes');
  assert.equal(api.debugSnapshot().lastOpened.furnitureId, 'family-child', 'mobile diagnostics identify the physical opened piece');

  console.log('NPC wardrobe v5 regression passed: authored/placeholder map bindings, real target+prompt, duplicate family access, and persistence seams.');
})().catch(error => { console.error(error); process.exitCode = 1; });
