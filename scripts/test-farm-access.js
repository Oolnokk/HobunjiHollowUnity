'use strict';

// Executes docs/js/farm-access.js (farm name, ownership and farmhand grants)
// against an in-memory localStorage save-meta record.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const store = new Map(); // Backing data for the localStorage stub.
const toasts = []; // Records debug-role toasts.
const context = {
  window: {},
  console,
  JSON,
  localStorage: {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/farm-access.js', 'utf8'), context);
const access = context.window.FarmAccess;
const meta = () => JSON.parse(store.get('hobunjiSaveMeta'));

let worldId = null; // Mutable session state the deps getters read.
let playerData = null;
access.init({ getWorldId: () => worldId, getPlayerData: () => playerData, showToast: (msg, ok) => toasts.push({ msg, ok }) });

// No world context: solo play is the owner and the label falls back.
assert.equal(access.getFarmName(), 'Hobunji Hollow');
assert.equal(access.isFarmOwner(), true);
assert.equal(access.hasFarmPermission('plant'), true);

store.set('hobunjiSaveMeta', JSON.stringify({
  worlds: [{ id: 'w1', label: 'Mossy Acre', ownerCharacterId: 'c-owner' }],
  characters: [{ id: 'c-owner', nickname: 'Ringo' }],
}));
worldId = 'w1';
playerData = { worldId: 'w1', isWorldOwner: false, farmhandPermissions: { plant: true } };
assert.equal(access.getFarmName(), 'Mossy Acre');
assert.equal(access.getFarmOwnerName(), 'Ringo');
assert.equal(access.isFarmOwner(), false);
assert.equal(access.hasFarmPermission('plant'), true);
assert.equal(access.hasFarmPermission('alterFarm'), false);
assert.equal(access.hasFarmPermission('missingKey'), false);

access.setFarmName(`  ${'x'.repeat(50)}  `);
assert.equal(meta().worlds[0].label, 'x'.repeat(40), 'labels are trimmed and capped at 40 characters');
assert.equal(playerData.worldLabel, 'x'.repeat(40), 'session copy follows the saved label');
access.setFarmName('   ');
assert.equal(meta().worlds[0].label, 'x'.repeat(40), 'blank labels are ignored');

context.window.__hobunjiAddFarmhand('c-hand', { storage: true });
const hand = meta().worlds[0].farmhands[0];
assert.equal(hand.characterId, 'c-hand');
assert.deepEqual({ ...hand.permissions }, { ...access.defaultFarmhandPermissions(), storage: true });
assert.equal(meta().worlds[0].members['c-hand'].npcFavorRescaleApplied, true, 'new members start already migrated');
context.window.__hobunjiAddFarmhand('c-owner', { storage: true });
assert.equal(meta().worlds[0].farmhands.length, 1, 'the owner is never added as a farmhand');
context.window.__hobunjiRemoveFarmhand('c-hand');
assert.equal(meta().worlds[0].farmhands.length, 0);

playerData.isWorldOwner = true;
context.window.__hobunjiSetFarmRole('farmhand', { harvest: true });
assert.equal(access.isFarmOwner(), false, 'debug farmhand role overrides real ownership');
assert.equal(access.hasFarmPermission('harvest'), true);
assert.equal(access.hasFarmPermission('plant'), false, 'debug role ignores the real session grants');
context.window.__hobunjiSetFarmRole('owner');
assert.equal(access.isFarmOwner(), true);
assert.equal(toasts.length, 2);

store.set('hobunjiSaveMeta', '{not json');
assert.equal(access.getFarmName(), 'Hobunji Hollow', 'corrupt save meta falls back instead of throwing');
assert.equal(access.getFarmOwnerName(), 'Unknown');

console.log('farm access: farm name, ownership, farmhand grants and debug role simulator passed');
