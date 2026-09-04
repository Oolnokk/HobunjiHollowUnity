#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const npcDatabase = readJson('docs/config/npcs/hobunji-starter-npc-database.json');
const scheduleOverrides = readJson('docs/config/npcs/schedule-overrides.json');
const registry = readJson('docs/config/npcs/placeholder-wardrobes.json');
const removedNpcIds = new Set(scheduleOverrides.removeNpcIds || []); // Mirrors LocalDBOverrides.applyNpcScheduleOverrides runtime removal policy.
const activeNpcIds = new Set((npcDatabase.npcs || []).filter(rec => rec?.id && !removedNpcIds.has(rec.id)).map(rec => rec.id));
const assignments = registry.assignments || {};
const assignedNpcIds = new Set(Object.keys(assignments));

assert.equal(registry.schema, 'hobunji_npc_placeholder_wardrobes.v1', 'placeholder registry schema must be recognized');
assert.equal(assignedNpcIds.size, activeNpcIds.size, 'registry must contain exactly one entry for every runtime-effective NPC');
for (const npcId of activeNpcIds) assert(assignedNpcIds.has(npcId), `${npcId} must have a placeholder wardrobe`);
for (const npcId of assignedNpcIds) assert(activeNpcIds.has(npcId), `${npcId} must still exist in the runtime-effective NPC database`);
for (const npcId of removedNpcIds) assert(!assignedNpcIds.has(npcId), `${npcId} is runtime-removed and must not receive a placeholder wardrobe`);

const occupiedFurniture = new Map(); // Proves the registry never makes one physical furniture instance represent two NPC wardrobes.
for (const [npcId, assignment] of Object.entries(assignments)) {
  assert.match(String(assignment.area || ''), /^map_i_/, `${npcId} placeholder area must be a runtime interior filename id`);
  assert(assignment.furnitureId, `${npcId} must reference a concrete furniture instance id`);
  const mapPath = path.join(root, 'docs/config/maps', `${assignment.area}.json`);
  assert(fs.existsSync(mapPath), `${npcId} placeholder area ${assignment.area} must exist`);
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const piece = (map.furniture || []).find(entry => String(entry?.id || '') === String(assignment.furnitureId));
  assert(piece, `${npcId} placeholder furniture ${assignment.furnitureId} must exist in ${assignment.area}`);
  const key = `${assignment.area}|${assignment.furnitureId}`;
  assert(!occupiedFurniture.has(key), `${npcId} and ${occupiedFurniture.get(key)} cannot share placeholder furniture ${key}`);
  occupiedFurniture.set(key, npcId);
}

assert.deepEqual(assignments.hreesh, {
  area: 'map_i_inn',
  furnitureId: 'fmss04iltqngq',
  itemKey: 'tableLongFurniture',
  reason: 'home:home',
}, 'Hreesh keeps the selected inn placeholder');

console.log(`Placeholder wardrobe registry audit passed: ${assignedNpcIds.size}/${activeNpcIds.size} runtime-effective NPCs, ${occupiedFurniture.size} unique furniture targets.`);
