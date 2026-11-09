#!/usr/bin/env node
'use strict';

// Uses the real wardrobe/furniture modules with only their external game seams stubbed.
// This keeps lockpicking, ownership and saved permissions under their original owners.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = name => fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', name), 'utf8');

const world = {}; // Shared window object through both real runtimes.
const opened = []; // Records only calls that actually reached the existing wardrobe inventory.
const games = []; // Ring-tumbler start requests and their success/cancel callbacks.
let saves = 0; // Existing per-character save callback invoked only after success.
let activeArea = 'map_i_test'; // Active room for validity checks.
let targetX = 2.5; // Camera ray's intended piece in the focus stub.
let playerX = 2.5; // Reach check must pass for the aimed piece.
let frame = 1; // Invalidates cached ray selection between test targets.
const room = (area, record) => record.npcWardrobeFor
  ? { npcId: record.npcWardrobeFor, furnitureId: record.id, source: area === 'interior' ? 'family' : 'authored' }
  : null;
world.NpcFurnitureWardrobes = {
  ownerForPlacement: room,
  isFamilyOwner: id => id === 'spouse' || id === 'child',
  nameForOwner: id => id,
  openWardrobe: (id, area, furnitureId) => { opened.push({ id, area, furnitureId }); return true; },
};
world.ChestLockpicking = { open: options => { games.push(options); return true; } };
const context = { window: world, performance: { now: () => 100 }, console };
vm.runInNewContext(load('npc-wardrobe.js'), context, { filename: 'npc-wardrobe.js' });
const wardrobes = world.NpcWardrobe;
wardrobes.init({ npcWalkers: [], saveMemberWorldData: () => { saves++; } });
vm.runInNewContext(load('furniture-table-system.js'), context, { filename: 'furniture-table-system.js' });
const furniture = world.FurnitureTableSystem;
furniture.init({
  getArea: () => activeArea,
  getPlayerPosition: () => ({ x: playerX, z: 2.5 }),
  getWalkers: () => [],
  frameId: () => frame,
  focusCandidates: candidates => {
    const candidate = candidates.find(item => item.box?.min.x <= targetX && item.box?.max.x >= targetX);
    return candidate ? { candidate, distanceWorld: 1 } : null;
  },
});
const mesh = x => ({
  parent: {}, position: { x, y: 0, z: 2.5 }, scale: { x: 1, y: 1, z: 1 },
  userData: {}, updateWorldMatrix() {},
}); // The real furniture mesh anchors the prompt and is removed when parent is null.
const targeted = () => {
  frame++;
  return furniture.objectAt(activeArea, Math.floor(targetX), 2);
}; // The normal camera-focused world interaction, not a special lockpick targeting path.

const outsiderChest = { id: 'outsider-chest', key: 'chest', npcWardrobeFor: 'outsider', col: 2, row: 2 };
furniture.registerPlacement(activeArea, outsiderChest, mesh(2.5), { fw: 1, fd: 1 });
let interaction = targeted();
assert.match(interaction.getButtons()[0].label, /Pick.*Chest Lock/, 'outsider chest requires a pick');
assert.equal(interaction.getButtons()[0].action, 'obj_open_wardrobe', 'world-action dispatch stays unchanged');
assert.equal(interaction.onAction('obj_open_wardrobe').ok, false, 'the first interaction only starts the minigame');
assert.equal(games.length, 1);
assert.equal(games[0].tier, 1, 'ordinary NPC chests use two rings');
assert.equal(games[0].valid(), true);
assert.equal(opened.length, 0, 'the original inventory cannot open early');
games[0].onCancel('cancelled');
assert.equal(opened.length, 0, 'cancel never opens an NPC container');
assert.equal(saves, 0, 'cancel never persists an unlock');
interaction.onAction('obj_open_wardrobe');
games[1].onSuccess();
assert.equal(opened.length, 1, 'success opens the original NPC inventory once');
assert.equal(saves, 1, 'success saves using member world data');
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'outsider-chest'), true);
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'other-chest'), false);
assert.equal(wardrobes.hasPickedStorageLock('other-npc', activeArea, 'outsider-chest'), false);
interaction = targeted();
assert.doesNotMatch(interaction.getButtons()[0].label, /Pick/, 'reopening a picked lock is immediate');
assert.equal(interaction.onAction('obj_open_wardrobe').ok, true);
assert.equal(games.length, 2, 'reopening an unlocked chest never creates a second minigame');

const saved = JSON.parse(JSON.stringify(wardrobes.serialize()));
assert.equal(saved.version, 4, 'wardrobe save adds optional storage lock records');
wardrobes.restore(null);
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'outsider-chest'), false, 'switching characters clears locks');
wardrobes.restore(saved);
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'outsider-chest'), true, 'unlock survives save/restore');
wardrobes.restore({ version: 3, stored: {}, outfits: {} });
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'outsider-chest'), false, 'legacy saves default locked');
wardrobes.restore({ version: 4, stored: {}, outfits: {}, storageLocks: { corrupted: true } });
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'outsider-chest'), false, 'malformed lock keys ignored');

const changing = { id: 'changing', key: 'chest', npcWardrobeFor: 'outsider', col: 4, row: 2 };
targetX = playerX = 4.5;
furniture.registerPlacement(activeArea, changing, mesh(4.5), { fw: 1, fd: 1 });
interaction = targeted();
interaction.onAction('obj_open_wardrobe');
const pending = games.at(-1); // Checks the saved closure against live owner updates.
changing.npcWardrobeFor = 'new-owner';
assert.equal(pending.valid(), false, 'changing the NPC owner invalidates the active challenge');
const before = opened.length;
pending.onSuccess();
assert.equal(opened.length, before, 'stale success cannot open the previous NPC inventory');
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'changing'), false, 'stale success cannot unlock');

activeArea = 'interior';
const spouseChest = { id: 'spouse-chest', key: 'chest', npcWardrobeFor: 'spouse', col: 6, row: 2 };
targetX = playerX = 6.5;
furniture.registerPlacement(activeArea, spouseChest, mesh(6.5), { fw: 1, fd: 1 });
interaction = targeted();
assert.doesNotMatch(interaction.getButtons()[0].label, /Pick/, 'spouse storage always bypasses lockpicking');
assert.equal(interaction.onAction('obj_open_wardrobe').ok, true);

const childWardrobe = { id: 'child-wardrobe', key: 'wardrobe', npcWardrobeFor: 'child', col: 8, row: 2 };
targetX = playerX = 8.5;
furniture.registerPlacement(activeArea, childWardrobe, mesh(8.5), { fw: 1, fd: 1 });
interaction = targeted();
assert.doesNotMatch(interaction.getButtons()[0].label, /Pick/, 'child wardrobes always bypass lockpicking');
assert.equal(interaction.onAction('obj_open_wardrobe').ok, true);
assert.equal(games.length, 3, 'neither family member starts a new minigame');

activeArea = 'map_i_test';
const outsiderWardrobe = { id: 'four-ring-wardrobe', key: 'wardrobe', npcWardrobeFor: 'outsider', lockpickTier: 4, col: 10, row: 2 };
targetX = playerX = 10.5;
furniture.registerPlacement(activeArea, outsiderWardrobe, mesh(10.5), { fw: 1, fd: 1 });
interaction = targeted();
assert.match(interaction.getButtons()[0].label, /Pick.*Wardrobe Lock/);
interaction.onAction('obj_open_wardrobe');
assert.equal(games.at(-1).tier, 4, 'authored difficult locks use all four rings');
games.at(-1).onCancel('cancelled');
assert.equal(wardrobes.hasPickedStorageLock('outsider', activeArea, 'four-ring-wardrobe'), false);
assert.ok(furniture.snapshot(activeArea).wardrobeLocks.attempts >= 4, 'mobile diagnostics expose the lock attempts');

console.log('NPC storage lockpicking regression passed: foreign storage, family bypass, cancellation, owner changes, exact-key persistence and 4-ring authored locks.');
