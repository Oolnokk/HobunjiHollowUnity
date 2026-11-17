'use strict';

// Boot-time regression for optional Stable/Gear storage. Extracts and executes
// the real game.js initialization branches, including legacy-save fallbacks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js', 'utf8'); // Production character boot is authoritative.

function between(start, end) {
  const from = game.indexOf(start); // Start of the actual block being exercised.
  assert(from >= 0, 'game.js block not found: ' + start);
  const until = game.indexOf(end, from + start.length); // End marker deliberately excludes the following unrelated boot block.
  assert(until > from, 'game.js block boundary not found: ' + end);
  return game.slice(from, until);
}

const stableBoot = between(
  'stable = Array.isArray(playerData.stable) ? playerData.stable.map(s => ({ ...s })) : [];',
  '// Backfill genotype-less stable entries from older saves',
); // Restores saved role assignments without forcing available or stowed creatures into empty slots.

function restoredStable(playerData) {
  const context = {
    playerData, stable: [], activeCompanionId: null, activeMountId: null, activeShoulderPetId: null,
    window: { CreatureGenetics: { makeDefaultGenotype: () => ({ sizeClass: 'medium' }) } },
    companionAiTypeForKind: () => 'companion',
    Date,
  }; // Exactly the free identifiers in the Stable startup block.
  vm.runInNewContext(stableBoot, context);
  return context;
}

const stored = [{ id: 'sleeping_hound', kind: 'dabinggi-hound', name: 'Sleeping Hound', stowed: true },
  { id: 'mount_one', kind: 'gar-wolf', name: 'Mount One', stowed: false }]; // A character has stored their companion and left every role unequipped.
const emptyRoles = restoredStable({ stable: stored, activeCompanionId: null, activeMountId: null, activeShoulderPetId: null });
assert.equal(emptyRoles.activeCompanionId, null, 'reload must not automatically equip the first Stable animal');
assert.equal(emptyRoles.activeMountId, null, 'reload must not auto-equip a mount');
assert.equal(emptyRoles.stable[0].stowed, true, 'the saved companion must remain stowed');
assert.equal(emptyRoles.stable[0].id, stored[0].id, 'stowing preserves creature identity');
assert.notEqual(emptyRoles.stable[0], stored[0], 'boot creates a separate character snapshot');
const chosen = restoredStable({ stable: stored, activeCompanionId: 'sleeping_hound', activeMountId: 'mount_one' });
assert.equal(chosen.activeCompanionId, 'sleeping_hound', 'valid explicitly saved assignment remains readable');
assert.equal(chosen.activeMountId, 'mount_one', 'valid mount selection is preserved');
// Existing first-character starter granting remains intentionally separate from restoring an already-owned Stable.

const gearBoot = between(
  "const savedEquipmentSlots = playerData.equipmentSlots && typeof playerData.equipmentSlots === 'object'",
  "// A cutscene preview's ephemeral profile",
); // Executes equipment restore, explicit empty slots, and legacy starter defaults as shipped.

function restoredGear(savedSlots, gearOverrides = {}) {
  const slots = { hoe: null, shovel: null, axe: null, pick: null, weapon: null,
    ranged: null, instrument: null, whistle: null, adventuring: null }; // Nulls reproduce the live slot map before character hydration.
  const gearInventory = {
    tools: { hoe_nativeCopper: true, bronzehoe: true, pickshovel_nativeCopper: true,
      hatchet_nativeCopper: true, hatchet: true, crossbow: true },
    whistles: [{ id: 'whistle_bingo' }],
    ...gearOverrides,
  }; // Starter-equipment ownership deliberately includes available alternatives to archived tools.
  const context = { playerData: { equipmentSlots: savedSlots }, equipmentSlots: slots, gearInventory };
  vm.runInNewContext(gearBoot, context);
  return context;
}

const intentionallyEmpty = restoredGear({
  hoe: null, shovel: null, weapon: null, ranged: null, whistle: null, instrument: null,
});
for (const slot of ['hoe', 'shovel', 'weapon', 'ranged', 'whistle', 'instrument']) {
  assert.equal(intentionallyEmpty.equipmentSlots[slot], null, slot + ' explicitly empty remains empty after reload');
}
assert.equal(intentionallyEmpty.equipmentSlots.adventuring, 'torch', 'separate authored torch gateway default remains');

const archived = restoredGear({ weapon: 'hatchet_nativeCopper', ranged: 'crossbow', hoe: null },
  { tools: { hoe_nativeCopper: true, hatchet_nativeCopper: true, hatchet: true, crossbow: true },
    archivedTools: { hatchet_nativeCopper: true, crossbow: true }, whistles: [] });
assert.equal(archived.equipmentSlots.weapon, null, 'restored archived weapon never reaches a slot');
assert.equal(archived.equipmentSlots.ranged, null, 'restored archived ranged item never reaches a slot');
assert.equal(archived.equipmentSlots.hoe, null, 'separately saved empty hoe slot stays empty');

const legacy = restoredGear(undefined, {
  tools: { hoe_nativeCopper: true, pickshovel_nativeCopper: true,
    hatchet_nativeCopper: true, hatchet: true, crossbow: true },
  archivedTools: { hatchet_nativeCopper: true, crossbow: true },
});
assert.equal(legacy.equipmentSlots.hoe, 'hoe_nativeCopper', 'old saves without slots still receive the accessible starter hoe');
assert.equal(legacy.equipmentSlots.shovel, 'pickshovel_nativeCopper', 'old saves without slots still receive the starter shovel');
assert.equal(legacy.equipmentSlots.weapon, 'hatchet', 'legacy fallback skips the archived hatchet and uses an available alternative');
assert.equal(legacy.equipmentSlots.ranged, null, 'legacy starter assignments skip archived ranged weapons');
assert.equal(legacy.equipmentSlots.whistle, 'whistle_bingo', 'legacy uninitialized whistle slot still gets its starter');

const preserved = restoredGear({ weapon: 'hatchet', whistle: 'whistle_bingo' });
assert.equal(preserved.equipmentSlots.weapon, 'hatchet', 'explicit assigned accessible weapon survives reload');
assert.equal(preserved.equipmentSlots.whistle, 'whistle_bingo', 'explicit assigned whistle survives reload');

const clothingBoot = between(
  'window.EquipmentPanel.ensureGearClothingCollection();',
  'window.DyeSystem.ensureCollection();',
); // Boot sanitization runs after canonical physical clothing migration, before avatar rendering.
function restoreClothing(gear) {
  let saves = 0; // Verifies repaired worn records are immediately persisted.
  const context = {
    gearInventory: gear,
    window: { EquipmentPanel: { ensureGearClothingCollection() {} } },
    saveGearInventory: () => { saves++; },
  };
  vm.runInNewContext(clothingBoot, context);
  return saves;
}
const oldHat = { uid: 'hat_old', slot: 'hat', archived: true, colorA: { h: 55 } };
const visibleTorso = { uid: 'tunic', slot: 'torso', archived: false };
const clothingGear = { clothing: { hat: oldHat, torso: visibleTorso }, clothingItems: [oldHat, visibleTorso] };
assert.equal(restoreClothing(clothingGear), 1, 'repairing a worn archived garment performs one save');
assert.equal(clothingGear.clothing.hat, null, 'stored garment is no longer worn after reload');
assert.equal(clothingGear.clothing.torso, visibleTorso, 'unrelated worn clothing stays equipped');
assert.equal(clothingGear.clothingItems[0].colorA.h, 55, 'archive keeps the original garment and its dyes');
assert.equal(restoreClothing(clothingGear), 0, 'a repaired save does not cause repeated writes');

console.log('Optional Stable/Gear boot: saved nulls, archived equipment, legacy defaults, worn-clothing repair passed');
