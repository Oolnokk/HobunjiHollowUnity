#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

function auditTownFestivalClearances(town) {
  const errors = []; // Used to report every obstructed festival placement rather than failing at the first one.
  const buildingCells = new Map(); // Indexes actual rotated occupied building tiles, including authored porches.
  const count = { buildings: 0, baseStations: 0, festivals: 0, festivalDecor: 0, festivalStations: 0, nestedFurniture: 0, nestedSlots: 0 }; // Summarized for the regression runner.
  for (const building of town.buildings || []) {
    count.buildings++;
    const width = Number(building.footprintW) || 1, depth = Number(building.footprintD) || 1; // Used to rotate the building's serialized footprint.
    const cells = building.footprintShape?.cells?.length ? building.footprintShape.cells :
      Array.from({ length: width * depth }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));
    const rotation = (((Number(building.rotationDeg ?? building.rotation) || 0) % 360) + 360) % 360;
    for (const { x, y } of cells) {
      const [u, v] = rotation === 90 ? [y, width - 1 - x] : rotation === 180 ? [width - 1 - x, depth - 1 - y] :
        rotation === 270 ? [depth - 1 - y, x] : [x, y]; // Maps authored tile coordinates to their actual world coordinates.
      const key = `${building.gridX + u},${building.gridZ + v}`;
      buildingCells.set(key, [...(buildingCells.get(key) || []), building.id]);
    }
  }
  function collisions(col, row, width = 1, depth = 1, rotation = 0) {
    if (!Number.isFinite(col) || !Number.isFinite(row)) return ['invalid-coordinate'];
    const angle = (Number(rotation) || 0) * Math.PI / 180; // Used for the rotated axis-aligned envelope of a festival fixture.
    const w = Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * depth;
    const d = Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * depth;
    const left = col + .5 - w / 2, right = col + .5 + w / 2, top = row + .5 - d / 2, bottom = row + .5 + d / 2; // World-space festival rectangle.
    const hits = new Set(); // Tracks distinct buildings under a piece's nonzero-area overlap.
    for (let x = Math.floor(left); x <= Math.floor(right); x++) for (let y = Math.floor(top); y <= Math.floor(bottom); y++) {
      if (left >= x + 1 - 1e-6 || right <= x + 1e-6 || top >= y + 1 - 1e-6 || bottom <= y + 1e-6) continue;
      for (const buildingId of buildingCells.get(`${x},${y}`) || []) hits.add(buildingId);
    }
    return [...hits];
  }
  function check(label, col, row, width = 1, depth = 1, rotation = 0) {
    const hits = collisions(col, row, width, depth, rotation);
    if (hits.length) errors.push(`${label} overlaps ${hits.join(', ')} at (${col}, ${row})`);
  }
  const baseline = new Map((town.npcStations || []).map(station => [station.id, station])); // Used to detect stale festival copies after editing normal town stations.
  for (const station of baseline.values()) {
    count.baseStations++;
    check(`Town NPC ${station.id}`, Number(station.col), Number(station.row));
  }
  for (const layout of town.layouts || []) {
    if (!Array.isArray(layout.decor) && !Array.isArray(layout.npcStations)) continue;
    count.festivals++;
    for (const prop of layout.decor || []) {
      count.festivalDecor++;
      const rootCol = Number(prop.col) + (Number(prop.postX) || 0), rootRow = Number(prop.row) + (Number(prop.postZ) || 0); // Uses the live festival root's actual post-placement offset.
      const rotation = Number(prop.rotY) || 0;
      const locale = prop.locale || prop.festivalLocale; // Both authored locale schema spellings are accepted at runtime.
      const width = Math.max(1, Number(locale?.width) || 1) * Math.abs(Number(prop.postSX ?? 1));
      const depth = Math.max(1, Number(locale?.depth) || 1) * Math.abs(Number(prop.postSZ ?? 1));
      check(`${layout.id} decor ${prop.id}`, rootCol, rootRow, width, depth, rotation);
      const theta = rotation * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta);
      const toWorld = (dx, dz) => ({
        col: rootCol + (Number(dx) || 0) * cos - (Number(dz) || 0) * sin,
        row: rootRow + (Number(dx) || 0) * sin + (Number(dz) || 0) * cos,
      }); // Matches MapLayoutSystem.resolveFestivalLocales for nested furniture and NPC anchors.
      for (const item of locale?.parts || []) {
        count.nestedFurniture++;
        const point = toWorld(item.dx, item.dz); // Expanded furniture position from its movable festival parent.
        check(`${layout.id} ${prop.id} furniture ${item.id}`, point.col, point.row,
          Math.abs(Number(item.postSX ?? 1)) || 1, Math.abs(Number(item.postSZ ?? 1)) || 1,
          rotation + (Number(item.rotY) || 0));
      }
      for (const slot of locale?.slots || []) {
        count.nestedSlots++;
        const point = toWorld(slot.dx, slot.dz); // Expanded festival NPC positions from their movable activity root.
        check(`${layout.id} ${prop.id} guest ${slot.id}`, point.col, point.row);
      }
    }
    for (const station of layout.npcStations || []) {
      count.festivalStations++;
      check(`${layout.id} NPC ${station.id}`, Number(station.col), Number(station.row));
      const original = baseline.get(station.id); // Shared normal-town station keeps its latest coordinates in festival layouts unless explicitly overridden.
      if (original && !station.festivalPositionOverride && (original.col !== station.col || original.row !== station.row))
        errors.push(`${layout.id} NPC ${station.id} has stale position (${station.col}, ${station.row}); base is (${original.col}, ${original.row})`);
    }
  }
  return { errors, count };
}

const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json', 'utf8')); // Canonical Town geometry/festival records, shared with the bundled Map Editor.
const audit = auditTownFestivalClearances(town); // Catches regressions when buildings or NPC stations move without rechecking festival layouts.
assert.deepEqual(audit.errors, [], audit.errors.join('\n'));
assert(audit.count.festivals >= 5 && audit.count.festivalDecor >= 100 && audit.count.festivalStations >= 150,
  'Town festival geometry audit must cover the full live editor layout, not an empty stub');
console.log('Town festival clearances passed:', JSON.stringify(audit.count));
