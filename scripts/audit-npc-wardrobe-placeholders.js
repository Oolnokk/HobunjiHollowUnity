#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('docs/js/npc-furniture-wardrobe-bridge-v3.js');
const npcDatabase = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json'));

const windowStub = {
  SCRATCHBONES_CONFIG: { game: {} },
  NpcWardrobe: { openWardrobePanel() { return true; } },
  __hobunjiFurnitureDebug: { getCurrentArea: () => null },
  matchMedia: () => ({ matches: false }),
};
const documentStub = {
  readyState: 'complete', documentElement: { dataset: {} }, body: { dataset: {} },
  getElementById() { return null; }, addEventListener() {},
};
class MutationObserverStub { observe() {} }
vm.runInNewContext(source, {
  window: windowStub,
  document: documentStub,
  MutationObserver: MutationObserverStub,
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  queueMicrotask(fn) { fn(); },
  localStorage: { getItem: () => null },
  Math,
  console,
});
const api = windowStub.NpcFurnitureWardrobes;
assert.equal(api?.version, 3, 'wardrobe v3 installs for audit');

const mapDir = path.join(root, 'docs/config/maps');
const unresolved = [];
const covered = [];
const areaCache = new Map();

function canonicalArea(buildingId) {
  const id = String(buildingId || '').trim();
  if (!id) return null;
  return id.startsWith('map_i_') ? id : `map_i_${id}`;
}
function loadArea(area) {
  if (!area) return null;
  if (areaCache.has(area)) return areaCache.get(area);
  const file = path.join(mapDir, `${area}.json`);
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  areaCache.set(area, map);
  return map;
}
function workArea(rec) {
  return canonicalArea(rec?.workBuildingId || rec?.scheduleHooks?.workBuildingId);
}

for (const rec of npcDatabase.npcs.filter(entry => entry?.id)) {
  const homeArea = canonicalArea(rec.homeId) || (/^map_i_/.test(String(rec?.scheduleHooks?.defaultMapId || '')) ? rec.scheduleHooks.defaultMapId : null);
  const homeMap = loadArea(homeArea);
  if (homeMap) {
    const binding = api.wardrobeBindings(homeMap, homeArea, npcDatabase).find(entry => entry.npcId === String(rec.id));
    if (binding) {
      covered.push({ npcId: rec.id, area: homeArea, furnitureId: binding.id, source: binding.source });
      continue;
    }
    unresolved.push({ npcId: rec.id, reason: 'home interior has no available placeholder furniture', area: homeArea });
    continue;
  }

  const workplace = workArea(rec);
  const workMap = loadArea(workplace);
  if (workMap) {
    const binding = api.wardrobeBindings(workMap, workplace, npcDatabase).find(entry => entry.npcId === String(rec.id));
    if (binding) {
      covered.push({ npcId: rec.id, area: workplace, furnitureId: binding.id, source: binding.source });
      continue;
    }
    unresolved.push({ npcId: rec.id, reason: 'no home map; workplace did not assign a placeholder', area: workplace });
    continue;
  }

  unresolved.push({ npcId: rec.id, reason: 'no canonical home or workplace interior map', area: homeArea || workplace || null });
}

console.log(`Placeholder wardrobe audit: ${covered.length}/${covered.length + unresolved.length} NPCs covered.`);
if (unresolved.length) {
  console.error('Unresolved NPC wardrobes:');
  for (const item of unresolved) console.error(`- ${item.npcId}: ${item.reason}${item.area ? ` (${item.area})` : ''}`);
  process.exitCode = 1;
} else {
  console.log('Every NPC has an authored or deterministic placeholder wardrobe target.');
}
