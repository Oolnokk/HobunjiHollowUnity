#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/wild-treasure.js', 'utf8'); // Runtime source exercised by this regression harness.
const context = { window: {}, console, Math };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'wild-treasure.js' });

const TILE = 100; // Pixel scale used to verify placement-to-world coordinate conversion.
const mapId = 'zone_test'; // Test-zone key shared by persistence, scene, and interaction maps.
const TileType = { GRASS: 'grass', TRENCH: 'trench' }; // Tile states used to distinguish hidden from exposed treasure.
const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: TileType.GRASS, elevTier: 0 })));
const buried = { col: 1, row: 1, found: false, _mesh: {} }; // Nearest hidden placement used by detection and sparkle checks.
const farther = { col: 4, row: 4, found: false, _mesh: {} }; // Second hidden placement proving nearest selection.
const found = { col: 0, row: 0, found: true, _mesh: {} }; // Colocated placement that must be ignored once opened.
const persisted = new Map([[mapId, { week: 0, placements: [found, farther, buried] }]]);
const objects = new Map([[mapId, new Map()]]);
const particles = [];

context.window.WildTreasure.init({
  _zoneTreasurePersist: persisted,
  _zoneTreasureObjects: objects,
  _zoneScenes: new Map([[mapId, { grid }]]),
  TileType,
  TILE,
  player: { x: 1.5 * TILE, y: 1.5 * TILE },
  getCurrentArea: () => mapId,
  isZoneArea: area => area === mapId,
  actionParticles: particles,
  ACTION_FX_LIMIT: 100,
  NORMAL_TOP: 0.2,
  PLATEAU_UNIT: 0.25,
});

const hint = context.window.WildTreasure.nearestBuriedPixelPos(mapId, 0, 0);
assert.deepEqual({ x: hint.x, y: hint.y }, { x: 1.5 * TILE, y: 1.5 * TILE },
  'still-buried persisted placements are discoverable before becoming world objects');
assert.equal(objects.get(mapId).size, 0,
  'discovering hidden treasure does not register it early or steal the Dig interaction');

context.window.WildTreasure.updateSparkles(1);
assert.equal(particles.length, 1,
  'a nearby still-buried persisted placement emits a sparkle without an interaction object');

grid[buried.row][buried.col].type = TileType.TRENCH;
const nextHint = context.window.WildTreasure.nearestBuriedPixelPos(mapId, buried.col * TILE, buried.row * TILE);
assert.deepEqual({ x: nextHint.x, y: nextHint.y }, { x: 4.5 * TILE, y: 4.5 * TILE },
  'dug placements stop advertising themselves as buried treasure');

console.log('Wild treasure buried-hint regression checks passed.');
