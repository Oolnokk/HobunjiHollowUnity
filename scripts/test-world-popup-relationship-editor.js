#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const helper = read('docs/js/world-popup-relationship-editor.js');
const bridge = read('docs/js/favor-popup-points-bridge.js');
const settings = JSON.parse(read('docs/config/ui/world-popup-settings.json'));

assert.doesNotThrow(() => new vm.Script(helper), 'world popup relationship editor helper parses');
assert.doesNotThrow(() => new vm.Script(bridge), 'relationship popup bridge parses');

assert.equal(settings.floatPlus.worldHeight, 0.19);
assert.equal(settings.floatPlus.xOffsetPercent, 43);
assert.equal(settings.floatPlus.yOffsetPercent, 17);
assert.equal(settings.floatPlus.lifetimeMs, 1150);
assert.deepEqual(settings.relationshipHeart, { opacity: 0.8, glowPx: 20 });
assert.equal(settings.colors.currency, '#76a58e');
assert.equal(settings.colors.conditionReady, '#fff4e2');

assert.match(bridge, /version: 8/, 'relationship bridge is v8');
assert.match(bridge, /function captureSettings\(value\)/, 'bridge captures normalized live popup settings');
assert.match(bridge, /api\.applySettings = function favorPopupV8ApplySettings/, 'bridge observes every editor applySettings call');
assert.match(bridge, /const cfg = currentFloatPlus\(\)/, 'Float+ anchor reads current settings instead of copied constants');
assert.match(bridge, /width \* cfg\.xOffsetPercent \/ 100/, 'relationship X offset follows live Float+ X');
assert.match(bridge, /combinedHeight \* cfg\.yOffsetPercent \/ 100/, 'relationship Y offset follows live Float+ Y');
assert.match(bridge, /source: 'float-plus-live-settings'/, 'diagnostics identify live Float+ anchoring');
assert.match(bridge, /Math\.sin\(progress \* Math\.PI\) \* eventHeight \* FLOAT_PLUS_MOTION\.swayHeightRatio/, 'relationship popup keeps Float+ sway');
assert.match(bridge, /FLOAT_PLUS_MOTION\.riseWorld \* \(1 - Math\.pow\(1 - progress, 2\)\)/, 'relationship popup keeps Float+ rise');
assert.match(bridge, /progress < FLOAT_PLUS_MOTION\.fadeStart/, 'relationship popup keeps Float+ late fade');

assert.match(bridge, /relationshipHeartStyleControls/, 'Popup Text Editor receives relationship-heart style controls');
assert.match(bridge, /Heart opacity \/ transparency/, 'editor exposes heart opacity/transparency slider');
assert.match(bridge, /data-heart-opacity type="range" min="0" max="100"/, 'heart opacity is adjustable from 0–100%');
assert.match(bridge, /Heart glow/, 'editor exposes heart glow slider');
assert.match(bridge, /data-heart-glow type="range" min="0" max="40"/, 'heart glow is adjustable from 0–40 px');
assert.match(bridge, /editorSettings\.relationshipHeart =/, 'heart sliders write back into the editor settings object');
assert.match(bridge, /window\.WorldPopupText\?\.applySettings\?\.\(editorSettings\)/, 'heart slider changes flow through the normal settings application path');

assert.match(bridge, /image\.crossOrigin = 'anonymous'/, 'heart remains CORS-safe for canvas/WebGL');
assert.match(bridge, /HobunjiSpritePngSurface/, 'heart remains on canonical PNG-plane surface path');
assert.match(bridge, /opacity: style\.opacity/, 'heart material uses the tunable opacity');
assert.match(bridge, /context\.shadowBlur = style\.glowPx/, 'heart canvas uses the tunable glow');
assert.match(bridge, /event\.heartPart\.material\.opacity = frame\.opacity \* style\.opacity/, 'Float+ fade composes with heart opacity');
assert.doesNotMatch(bridge, /POP_RIGHT_RATIO|POP_UP_RATIO|START_GROUP_SCALE|END_GROUP_SCALE/, 'old bespoke diagonal grow animation remains removed');

console.log('Relationship popups follow live Float+ settings; heart opacity/glow editor controls are wired and persistent.');
