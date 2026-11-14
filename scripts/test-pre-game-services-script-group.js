#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js');

const root = path.resolve(__dirname, '..'); // Root of the actual shipped HTML and manifest sources.
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Parser insertion points are stable across feature changes.
const expanded = expandClassicScriptGroups(html); // Expands every existing group with the production manifest code.
const toolIcon = fs.readFileSync(path.join(root, 'docs/js/tool-icon-render.js'), 'utf8'); // HUD module must never own weapon shader boot.
const groups = {
  'pre-game-render': ['surface-occlusion-composer', 'held-object-render-order'],
  'pre-game-item-art': ['tool-icon-render', 'sprite-recolor', 'object-sprite-catalog'],
  'pre-game-services': ['mount-system', 'companion-movement-speed', 'audio-system', 'honeyfuzzle-audio',
    'scratchbones-emoji-reactions', 'animal-vocalizations', 'music-system', 'audio-track-gain-settings'],
  'pre-game-diagnostics': ['transform-dump-utils', 'rig-transform-dump', 'pixel-probe'],
}; // Four independent cache-token owners and the original required startup order.

let previous = -1; // Detects invalid cross-group ordering, not merely intra-group order.
for (const [group, required] of Object.entries(groups)) {
  assert.equal(html.split('data-classic-group="' + group + '"').length - 1, 1,
    group + ' has exactly one stable parser entry');
  const source = fs.readFileSync(path.join(root, 'docs/js/bootstrap/classic-groups', group + '.js'), 'utf8');
  const writes = []; // Real parser-time HTML emitted by the module owner.
  vm.runInNewContext(source, { document: { readyState: 'loading', write: text => writes.push(text) } },
    { filename: group + '.js' });
  assert.equal(writes.length, 1, group + ' emits one blocking parser write');
  const urls = writes[0].split('<script src="').slice(1).map(tag => tag.split('"')[0]);
  assert.deepEqual(urls.map(url => url.slice(3).split('.js?')[0]), required,
    group + ' contains the exact required modules in the original dependency order');
  assert(urls.every(url => url.includes('.js?v=') && url.split('.js?v=')[1].length > 0),
    group + ' versions every shipped child');
  for (const name of required) {
    const url = 'js/' + name + '.js?';
    const position = expanded.indexOf(url);
    assert(position > previous, name + ' must follow previous dependencies');
    assert.equal(expanded.split(url).length - 1, 1, name + ' loads exactly once');
    assert(!html.includes('<script src="' + url), name + ' cache version belongs to its group, not index');
    previous = position;
  }
}
assert(previous < expanded.indexOf('src="game.js?v='), 'all pre-game modules precede game boot');
assert(expanded.indexOf('js/pixel-probe.js?') < expanded.indexOf('js/cinematic-camera-runtime.js?'),
  'Pixel Probe remains before dialogue initialization');
assert(!toolIcon.includes('surface-occlusion-composer.js') && !toolIcon.includes('held-object-render-order.js'),
  'tool-icon-render must not reinstall held-overlay renderer or surface policy');
console.log('Pre-game group ownership: 4 isolated manifests, 16 modules, stable parser order, no duplicated shader bootstrap.');
