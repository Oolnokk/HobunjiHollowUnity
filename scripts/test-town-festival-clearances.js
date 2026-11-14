#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function auditTownFestivalClearances(town, furnitureDefs) {
  const errors = []; // Records all invalid outdoor NPC positions and festival overlays without stopping at the first error.
  const occupied = new Map(); // World tiles occupied by rotated structural building footprints, including actual porch/rail tiles.
  const count = { buildings: 0, baseStations: 0, festivals: 0, festivalDecor: 0, festivalStations: 0, nestedFurniture: 0, nestedSlots: 0 }; // CI coverage summary.
  for (const building of town.buildings || []) {
    count.buildings++;
    const width = Number(building.footprintW) || 1, depth = Number(building.footprintD) || 1; // Width/depth used to rotate this authored sparse footprint.
    const cells = building.footprintShape?.cells?.length ? building.footprintShape.cells :
      Array.from({ length: width * depth }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));
    const rotation = ((Number(building.rotationDeg ?? building.rotation) || 0) % 360 + 360) % 360;
    for (const { x, y } of cells) {
      const [u, v] = rotation === 90 ? [y, width - 1 - x] : rotation === 180 ? [width - 1 - x, depth - 1 - y] :
        rotation === 270 ? [depth - 1 - y, x] : [x, y]; // Rotated cell, matching the town placement and collision rules.
      const key = `${building.gridX + u},${building.gridZ + v}`;
      occupied.set(key, [...(occupied.get(key) || []), building.id]);
    }
  }
  function collisions(left, top, right, bottom) {
    const matches = new Set(); // Reports every unique overlapped building for this positive-area rectangle.
    for (let x = Math.floor(left); x < Math.ceil(right); x++) for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      if (left >= x + 1 - 1e-6 || right <= x + 1e-6 || top >= y + 1 - 1e-6 || bottom <= y + 1e-6) continue;
      for (const id of occupied.get(`${x},${y}`) || []) matches.add(id);
    }
    return [...matches];
  }
  function checkRect(label, left, top, right, bottom) {
    if (![left, top, right, bottom].every(Number.isFinite) || left >= right || top >= bottom) {
      errors.push(`${label}: invalid placement bounds`); return;
    }
    const hits = collisions(left, top, right, bottom);
    if (hits.length) errors.push(`${label} overlaps ${hits.join(', ')} within (${left}, ${top})–(${right}, ${bottom})`);
  }
  function checkStation(label, col, row) {
    checkRect(label, Number(col), Number(row), Number(col) + 1, Number(row) + 1); // A station occupies its own outdoor tile.
  }
  function checkDecor(label, prop) {
    const def = furnitureDefs[prop.key] || null; // Real game.js footprint; col/row is the *tile origin*, not the visual centre.
    if (!def) { errors.push(`${label}: unknown game furniture ${prop.key}`); return; }
    const width = Number(def.fw) || 1, depth = Number(def.fd) || 1;
    const locale = prop.locale || prop.festivalLocale; // Runtime supports either festival-local child schema.
    const largeStage = ['bandstand', 'dance'].includes(locale?.kind);
    const spanX = (largeStage ? Number(locale.width) || width : width) * Math.abs(Number(prop.postSX ?? prop.postScale ?? 1));
    const spanZ = (largeStage ? Number(locale.depth) || depth : depth) * Math.abs(Number(prop.postSZ ?? prop.postScale ?? 1));
    const cx = Number(prop.col) + width / 2 + (Number(prop.postX) || 0);
    const cz = Number(prop.row) + depth / 2 + (Number(prop.postZ) || 0);
    const a = (Number(prop.rotY) || 0) * Math.PI / 180;
    const xSpan = Math.abs(Math.cos(a)) * spanX + Math.abs(Math.sin(a)) * spanZ;
    const zSpan = Math.abs(Math.sin(a)) * spanX + Math.abs(Math.cos(a)) * spanZ;
    checkRect(label, cx - xSpan / 2, cz - zSpan / 2, cx + xSpan / 2, cz + zSpan / 2);
  }
  const base = new Map((town.npcStations || []).map(station => [station.id, station])); // Festival copies of base stations must follow town-editor position changes.
  for (const station of base.values()) {
    count.baseStations++;
    checkStation(`Town NPC ${station.id}`, station.col, station.row);
  }
  for (const layout of town.layouts || []) {
    if (!Array.isArray(layout.decor) && !Array.isArray(layout.npcStations)) continue;
    count.festivals++;
    for (const prop of layout.decor || []) {
      count.festivalDecor++;
      checkDecor(`${layout.id} decor ${prop.id}`, prop);
      const locale = prop.locale || prop.festivalLocale;
      const angle = (Number(prop.rotY) || 0) * Math.PI / 180;
      const c = Math.cos(angle), s = Math.sin(angle); // Matches MapLayoutSystem.resolveFestivalLocales' root-relative rotation.
      const rootX = Number(prop.col) + (Number(prop.postX) || 0), rootZ = Number(prop.row) + (Number(prop.postZ) || 0);
      const location = (dx, dz) => ({
        col: rootX + (Number(dx) || 0) * c - (Number(dz) || 0) * s,
        row: rootZ + (Number(dx) || 0) * s + (Number(dz) || 0) * c,
      }); // Festival children share the root's tile origin and rotate with it.
      for (const part of locale?.parts || []) {
        count.nestedFurniture++;
        const p = location(part.dx, part.dz); // Child furniture's real tile origin.
        checkDecor(`${layout.id} ${prop.id} part ${part.id}`, {
          ...part, col: p.col, row: p.row, rotY: (Number(prop.rotY) || 0) + (Number(part.rotY) || 0),
        });
      }
      for (const slot of locale?.slots || []) {
        count.nestedSlots++;
        const p = location(slot.dx, slot.dz); // Festival NPC guest standing tile from the same root transform.
        checkStation(`${layout.id} ${prop.id} guest ${slot.id}`, p.col, p.row);
      }
    }
    for (const station of layout.npcStations || []) {
      count.festivalStations++;
      checkStation(`${layout.id} NPC ${station.id}`, station.col, station.row);
      const original = base.get(station.id); // Shared town station, distinct from a festival-only role or author-approved override.
      if (original && !station.festivalPositionOverride && (original.col !== station.col || original.row !== station.row))
        errors.push(`${layout.id} NPC ${station.id} has a stale position; festival=(${station.col},${station.row}), town=(${original.col},${original.row})`);
    }
  }
  return { errors, count };
}

const town = JSON.parse(fs.readFileSync('docs/config/maps/hobunji_hollow_town.map.json', 'utf8')); // Current bundled town and festival overlays.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Real runtime furniture dimensions, not guessed 1x1 festival sizes.
const start = game.indexOf('const DECORATIVE_FURNITURE_DEFS =');
const end = game.indexOf('\n      };', start) + '\n      };'.length;
assert(start >= 0 && end > start, 'Game decorative furniture catalog must be available');
const furnitureDefs = vm.runInNewContext(game.slice(start, end) + '; DECORATIVE_FURNITURE_DEFS;'); // Evaluate the shipped furniture footprint catalog, same as festival integration tests.
furnitureDefs.candleCluster = { fw: 1, fd: 1 }; // Registered later by InteriorFireFloorRuntime, outside the initial literal.
const audit = auditTownFestivalClearances(town, furnitureDefs); // Detects overlaps and stale shared NPC coordinates after future town-map edits.
assert.deepEqual(audit.errors, [], audit.errors.join('\n'));
assert(audit.count.festivals >= 5 && audit.count.festivalDecor >= 100 && audit.count.festivalStations >= 150,
  'Town festival audit must cover all shipped festival layouts, not an empty fixture');
console.log('Town festival clearances passed:', JSON.stringify(audit.count));
