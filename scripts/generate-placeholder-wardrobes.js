#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mapsDir = path.join(root, 'docs/config/maps');
const npcDbPath = path.join(root, 'docs/config/npcs/hobunji-starter-npc-database.json');
const scheduleOverridesPath = path.join(root, 'docs/config/npcs/schedule-overrides.json');
const db = JSON.parse(fs.readFileSync(npcDbPath, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(scheduleOverridesPath, 'utf8'));
const removed = new Set(overrides.removeNpcIds || []); // Mirrors LocalDBOverrides.applyNpcScheduleOverrides living/dead filtering for placeholder generation.
const npcs = (db.npcs || []).filter(rec => rec?.id && !removed.has(rec.id));

const PRIORITY = [
  'wardrobeFurniture', 'cabinetFurniture', 'chestFurniture', 'nightstandFurniture', 'dresserFurniture',
  'basicBedFurniture', 'tableSmallFurniture', 'tableLongFurniture', 'tableRoundFurniture',
  'chairFurniture', 'stoolFurniture',
];
const HOMEISH = /sleep|rest|home|bed|dorm|residen/i;
const WORKISH = /work|shop|bar|smith|carpent|temple|guard|research|tend|counter|keg/i;

const maps = new Map(); // Existing interior map id -> parsed document; used to guarantee every generated target is real.
for (const name of fs.readdirSync(mapsDir).filter(name => /^map_i_.*\.json$/i.test(name)).sort()) {
  const file = path.join(mapsDir, name);
  try {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (map?.id && Array.isArray(map.furniture)) maps.set(map.id, map);
  } catch (_) {}
}

function canonical(buildingId) {
  const id = String(buildingId || '').trim();
  if (!id || /^<suggestion:/i.test(id)) return null;
  return id.startsWith('map_i_') ? id : `map_i_${id}`;
}
function priority(piece) {
  const index = PRIORITY.indexOf(String(piece?.itemKey || ''));
  return index >= 0 ? index : PRIORITY.length;
}
function sortedFurniture(map) {
  return (map?.furniture || [])
    .filter(piece => piece?.id && Number.isFinite(Number(piece.col)) && Number.isFinite(Number(piece.row)))
    .sort((a, b) => priority(a) - priority(b)
      || Number(a.row) - Number(b.row)
      || Number(a.col) - Number(b.col)
      || String(a.id).localeCompare(String(b.id)));
}
function mapCandidateScore(rec, area, source, activity = '') {
  let score = 50;
  if (source === 'home') score = 0;
  else if (HOMEISH.test(activity)) score = 5;
  else if (source === 'work') score = 10;
  else if (WORKISH.test(activity)) score = 15;
  else if (source === 'schedule') score = 20;
  else if (source === 'agenda') score = 25;
  else if (source === 'default') score = 30;
  if (/_F2$/.test(area) && HOMEISH.test(activity)) score -= 2;
  return score;
}
function existingCandidates(rec) {
  const candidates = [];
  const add = (rawArea, source, activity = '') => {
    const area = canonical(rawArea);
    if (!area || !maps.has(area)) return;
    candidates.push({ area, source, activity: String(activity || ''), score: mapCandidateScore(rec, area, source, activity) });
  };
  add(rec.homeId, 'home', 'home');
  add(rec.workBuildingId, 'work', 'work');
  add(rec.scheduleHooks?.workBuildingId, 'work', 'work');
  add(rec.scheduleHooks?.defaultMapId, 'default', rec.scheduleHooks?.defaultStationId || '');
  for (const rule of rec.scheduleHooks?.rules || []) add(rule.mapId || rule.area, 'schedule', `${rule.activity || ''} ${rule.stationId || ''}`);
  for (const beat of rec.agenda || []) add(beat.destinationArea || beat.mapId || beat.area, 'agenda', `${beat.activity || ''} ${beat.activityLabel || ''} ${beat.destinationStationId || ''}`);
  const best = new Map();
  for (const candidate of candidates) {
    const prior = best.get(candidate.area);
    if (!prior || candidate.score < prior.score) best.set(candidate.area, candidate);
  }
  return [...best.values()].sort((a, b) => a.score - b.score || a.area.localeCompare(b.area));
}

const usedFurniture = new Set(); // Enforces one placeholder NPC per specific furniture instance globally.
const assignments = {};
const unresolved = [];

function claimInArea(npcId, area, reason) {
  const map = maps.get(area);
  if (!map) return null;
  const piece = sortedFurniture(map).find(candidate => !usedFurniture.has(`${area}|${candidate.id}`) && !candidate.npcWardrobeFor);
  if (!piece) return null;
  usedFurniture.add(`${area}|${piece.id}`);
  assignments[npcId] = {
    area,
    furnitureId: piece.id,
    itemKey: piece.itemKey || null,
    reason,
  };
  return assignments[npcId];
}

// Pass 1: keep placeholders near the NPC's actual authored life whenever a real interior exists.
for (const rec of [...npcs].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
  const candidates = existingCandidates(rec);
  let assigned = null;
  for (const candidate of candidates) {
    assigned = claimInArea(rec.id, candidate.area, `${candidate.source}${candidate.activity ? `:${candidate.activity}` : ''}`);
    if (assigned) break;
  }
  if (!assigned) unresolved.push(rec);
}

// Pass 2: NPCs whose homes/camps/shrines do not exist yet get an unused real furniture target elsewhere.
// Prefer interiors with the most spare furniture so these temporary assignments do not crowd out small homes.
function globalAreaOrder() {
  return [...maps.entries()]
    .map(([area, map]) => ({
      area,
      spare: sortedFurniture(map).filter(piece => !usedFurniture.has(`${area}|${piece.id}`) && !piece.npcWardrobeFor).length,
    }))
    .filter(entry => entry.spare > 0)
    .sort((a, b) => b.spare - a.spare || a.area.localeCompare(b.area));
}
for (const rec of unresolved) {
  let assigned = null;
  for (const entry of globalAreaOrder()) {
    assigned = claimInArea(rec.id, entry.area, 'temporary-catch-all:authored home/work interior unavailable');
    if (assigned) break;
  }
  if (!assigned) {
    console.error(`No unused furniture remains for ${rec.id}.`);
    process.exitCode = 1;
  }
}

const activeIds = new Set(npcs.map(rec => rec.id));
const assignedIds = new Set(Object.keys(assignments));
const missing = [...activeIds].filter(id => !assignedIds.has(id));
if (missing.length) {
  console.error(`Missing placeholder assignments: ${missing.join(', ')}`);
  process.exitCode = 1;
}

const registry = {
  schema: 'hobunji_npc_placeholder_wardrobes.v1',
  note: 'Temporary generated wardrobe targets. Explicit npcWardrobeFor metadata in an interior always overrides these. Regenerate/remove entries as proper wardrobes are authored.',
  generatedFrom: {
    npcDatabase: 'config/npcs/hobunji-starter-npc-database.json',
    scheduleOverrides: 'config/npcs/schedule-overrides.json',
    maps: 'config/maps/map_i_*.json',
  },
  assignments,
};

console.log(`PLACEHOLDER_WARDROBE_COVERAGE ${Object.keys(assignments).length}/${npcs.length}`);
console.log(`PLACEHOLDER_WARDROBE_JSON ${JSON.stringify(registry)}`);
if (process.argv.includes('--write')) {
  const output = path.join(root, 'docs/config/npcs/placeholder-wardrobes.json');
  fs.writeFileSync(output, JSON.stringify(registry, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, output)}`);
}
