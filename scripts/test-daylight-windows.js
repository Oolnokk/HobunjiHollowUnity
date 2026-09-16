#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used for deterministic static regression checks without a browser harness.
const fs = require('node:fs'); // Used to read the shipped runtime/editor/config source files.
const path = require('node:path'); // Used to resolve repository-relative fixture paths consistently.

const root = path.resolve(__dirname, '..'); // Repository root for every source/config assertion below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Small helper keeps each assertion readable.
const json = relative => JSON.parse(read(relative)); // Validates JSON syntax while loading each window preset.

const presets = [
  ['simpleWindow', 'docs/config/furniture-authored/simpleWindow.json', 2.6],
  ['crossbarWindow', 'docs/config/furniture-authored/crossbarWindow.json', 3.0],
  ['wideWindow', 'docs/config/furniture-authored/wideWindow.json', 3.6],
]; // Canonical first three daylight-window furniture presets and their expected authored radii.

for (const [key, file, expectedRadius] of presets) {
  const data = json(file); // Complete authored furniture record exercises schema + surface metadata together.
  assert.equal(data.schema, 'hobunji_furniture_authored_runtime.v1', `${key}: runtime schema must remain authored-furniture v1`);
  assert.equal(data.key, key, `${key}: config key must match filename/catalog key`);
  assert(data.wallOrnament?.attachmentSurfaceId, `${key}: window must remain wall-placeable through the wall-ornament system`);
  const daylight = (data.recognizedSurfaces || []).filter(surface => surface.role === 'daylightWindow'); // Generic role rather than furniture-key special casing.
  assert.equal(daylight.length, 1, `${key}: starter preset should have one daylight aperture surface`);
  assert.equal(daylight[0].daylightRadiusTiles, expectedRadius, `${key}: authored daylight radius changed unexpectedly`);
  assert.equal(daylight[0].daylightStrength, 1, `${key}: starter preset should expose full outdoor light at its center`);
  assert.equal(daylight[0].materialTexture, 'wavy_surface.png', `${key}: pane should use the lightweight shared textured surface`);
  assert.equal(daylight[0].materialFillEnabled, true, `${key}: pane must use the editor's shade-preserving fill model`);
  assert.notEqual(data.wallOrnament.attachmentSurfaceId, daylight[0].id, `${key}: wall-contact and visible daylight faces must remain distinct`);
}

const runtime = read('docs/js/daylight-window-runtime.js'); // Static source guards the integration strategy requested for interiors.
assert.match(runtime, /const ROLE = 'daylightWindow'/, 'runtime must consume the generic daylight-window surface role');
assert.match(runtime, /globalCompositeOperation = 'destination-out'/, 'windows must uncover the existing interior darkness overlay instead of starting a second lighting engine');
assert.match(runtime, /state\.a < 0\.09 \? 'screen' : 'multiply'/, 'window tint must mirror outdoor overlay compositing');
assert.match(runtime, /pixels\.data\[i\] \+ pixels\.data\[i \+ 1\] \+ pixels\.data\[i \+ 2\]/, 'runtime pane texture must neutralize RGB with the existing shade-preserving fill algorithm');
assert.match(runtime, /area === 'interior' \|\| !!lightingDeps\?\._isBuildingArea/, 'daylight apertures must apply to ordinary interiors/buildings');
assert.doesNotMatch(runtime, /isMineArea|isDenArea/, 'daylight-window runtime should not opt mines/dens into window lighting');
assert.match(runtime, /window\.__daylightWindowDebug = debugSnapshot/, 'mobile/runtime diagnostics must be available without browser console inspection');

const author = read('docs/tools/furniture-avatar-author/furniture-daylight-windows.js'); // Guards editor controls and export metadata.
assert.match(author, /Use Selected Surface as Window/, 'Furniture Author must expose a selected-surface daylight action');
assert.match(author, /daylightWindowRadius/, 'Furniture Author must expose per-window radius control');
assert.match(author, /daylightWindowStrength/, 'Furniture Author must expose per-window strength control');
assert.match(author, /materialFillEnabled = true/, 'marking a window must reuse the existing material-fill path');
assert.match(author, /attachmentSurfaceId === surface\.id/, 'editor must reject one surface serving as both wall-contact and visible daylight face');

const authorLoader = read('docs/tools/furniture-avatar-author/foliage-furniture-mode.js'); // Extension loader must actually make the UI feature reachable.
assert.match(authorLoader, /furniture-daylight-windows\.js\?v=20260916window1/, 'Furniture Author must load the daylight-window extension');
const mapTransport = read('docs/js/map-live-preview.js'); // Shared game/Map Editor transport loads both wall placement and window runtime.
assert.match(mapTransport, /daylight-window-runtime\.js\?v=20260916window1/, 'game and Map Editor must load the daylight-window runtime');
assert.match(runtime, /wallOrnamentMapPreset/, 'Map Editor wall-placement preset list must receive window choices');
assert.match(runtime, /simpleWindowFurniture/, 'player furniture registry must receive Simple Window');
assert.match(runtime, /crossbarWindowFurniture/, 'player furniture registry must receive Crossbar Window');
assert.match(runtime, /wideWindowFurniture/, 'player furniture registry must receive Wide Window');

console.log('daylight window authoring/runtime regression checks passed');
