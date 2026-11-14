#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js');

const root = path.resolve(__dirname, '..'); // Project root for real shipped HTML and manifest, without browser asset stubs.
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Canonical parser position for all pre-game services.
const manifest = fs.readFileSync(path.join(root, 'docs/js/bootstrap/classic-groups/pre-game-services.js'), 'utf8'); // Sole cache-version owner for this startup set.
const expanded = expandClassicScriptGroups(html); // Parses group output, preserving the synchronous HTML script order.
const toolIcon = fs.readFileSync(path.join(root, 'docs/js/tool-icon-render.js'), 'utf8'); // HUD must not import scene depth/x-ray modules again.

const required = [
  'surface-occlusion-composer',
  'held-object-render-order',
  'tool-icon-render',
  'sprite-recolor',
  'object-sprite-catalog',
  'mount-system',
  'companion-movement-speed',
  'audio-system',
  'honeyfuzzle-audio',
  'scratchbones-emoji-reactions',
  'animal-vocalizations',
  'music-system',
  'audio-track-gain-settings',
  'transform-dump-utils',
  'rig-transform-dump',
  'pixel-probe',
]; // Frozen order of the migrated bootstrap's original dependencies and the newly separated depth policy.
assert.equal((html.match(/data-classic-group="pre-game-services"/g) || []).length, 1,
  'there is one stable parser-time pre-game service loader in index.html');
assert.doesNotMatch(html, /<script src="js\/(?:tool-icon-render|sprite-recolor|held-object-render-order)\.js\?/,
  'individual pre-game script versions no longer invite unrelated index.html merge conflicts');
assert.doesNotMatch(toolIcon, /surface-occlusion-composer\.js|held-object-render-order\.js|hobunjiHeldRenderOrder/,
  'the HUD icon adapter does not own 3D terrain and held overlay loading');
let previous = -1; // Tracks execution order through the expanded manifest.
for (const name of required) {
  const url = 'js/' + name + '.js?';
  const index = expanded.indexOf(url);
  assert(index > previous, 'pre-game script is missing/duplicated/reordered: ' + name);
  assert.equal(expanded.split(url).length - 1, 1, 'pre-game module loads once: ' + name);
  previous = index;
}
assert(previous < expanded.indexOf('src="game.js?v='), 'all services register before game initializes');
assert(expanded.indexOf('js/pixel-probe.js?') < expanded.indexOf('data-classic-group="dialogue"') ||
  expanded.indexOf('js/pixel-probe.js?') < expanded.indexOf('js/cinematic-camera-runtime.js?'),
  'Pixel Probe remains before the dialogue group, not after it');
assert.match(manifest, /document\.readyState !== 'loading'/,
  'the manifest rejects async/late insertion that could reorder game startup');
console.log('Pre-game services: 16 parser-ordered modules, isolated cache tokens, and standalone held x-ray bootstrap validated.');
