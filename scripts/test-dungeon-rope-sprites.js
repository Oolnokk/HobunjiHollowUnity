#!/usr/bin/env node
'use strict';
// Source-level integration regression: confirms the actual game/editor paths keep the
// PNG plane and surface-material contracts reachable after future refactors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8'); // Reads live files instead of duplicating production implementations.
const html = source('docs/index.html'); // Validates the actual game script load order.
const bootstrap = source('docs/js/dev-random-ruin-bootstrap.js'); // Nested ruin scripts run at parser time.
const editor = source('docs/tools/furniture-avatar-author/index.html'); // Mobile surface-texture panel.
const art = source('docs/js/dungeon-rope-art.js'); // Shared sprite geometry and net texture.
const runtime = source('docs/js/furniture-surface-png-runtime.js'); // Opted-in gameplay surface material mapping.
const png = fs.readFileSync(path.join(root, 'docs/assets/objectsprites/rope_long.png')); // Checks source art dimensions.
assert.equal(png.toString('ascii', 1, 4), 'PNG');
assert.equal(png.readUInt32BE(16), 152);
assert.equal(png.readUInt32BE(20), 2164);
assert(html.includes('js/dungeon-rope-art.js?'), 'shared rope art loaded by game');
assert(html.includes('js/furniture-surface-png-runtime.js?'), 'authored surface material adapter loaded by game');
assert(html.indexOf('js/furniture-surface-png-runtime.js?') < html.indexOf('js/authored-furniture-runtime.js?'), 'surface adapter before authored furniture');
assert(bootstrap.includes('js/dev-random-ruin-simple-puzzles.js?'));
assert(bootstrap.includes('js/dev-random-ruin-dungeon-fire.js?'));
assert(source('docs/js/dev-random-ruin-simple-puzzles.js').includes('DungeonRopeArt.updateRopePlane'), 'ruin rope uses PNG plane');
assert(source('docs/js/hanging-ropes.js').includes('DungeonRopeArt.updateRopePlane'), 'burden rope uses PNG plane');
assert(source('docs/js/dev-random-ruin-dungeon-fire.js').includes('createNetFrustum'), 'net uses tapered skin');
assert(source('docs/js/authored-furniture-runtime.js').includes('FurnitureSurfacePngRuntime?.applyToPart'), 'game applies new per-face settings');
for (const id of ['surfaceTexturePadX','surfaceTexturePadY','surfaceMaterialOpacity']) assert(editor.includes('id="'+id+'"'), 'editor exposes '+id);
for (const mode of ['tile-x','tile-y']) assert(editor.includes('value="'+mode+'"'), 'editor exposes '+mode);
assert(editor.includes('texture.version=2'), 'editor marks newly edited surfaces for gameplay');
assert(art.includes('ClampToEdgeWrapping') && art.includes('DoubleSide'), 'net atlas clamps and rope planes show both sides');
assert(runtime.includes("settings.mapping === 'tile-x'") && runtime.includes("settings.mapping === 'tile-y'"), 'independent runtime wrapping');
assert(runtime.includes('geometry.addGroup'), 'authored texture changes only selected faces');
assert(runtime.includes('Number(settings?.version) >= 2'), 'legacy furniture remains isolated');
console.log('Dungeon PNG rope/net and editor-to-game surface material wiring: OK');
