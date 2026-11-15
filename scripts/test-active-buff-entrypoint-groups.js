#!/usr/bin/env node
'use strict';

// Guard the entrypoint split so future buff/house/romance cache refreshes never edit index.html.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js');

const root = path.resolve(__dirname, '..'); // Used to read the actual shipped page and manifest files.
const index = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Stable parser positions, with no per-feature cache tokens.
const expanded = expandClassicScriptGroups(index); // Effective browser script order after the parser-time manifest expansion.
const required = [
  ['combat-config', 'js/combat/combat-config-loader.js', 'js/bounty-board.js', 'js/effect-buff-bar.js'],
  ['cooking-runtime', 'js/cooking-system.js', 'js/food-processing.js', 'js/key-item-system.js'],
  ['alchemy-runtime', 'js/alchemy-system.js', 'js/key-item-system.js', 'js/tea-grinder.js'],
  ['house-runtime', 'js/house-pieces.js', 'js/farm-troughs.js', 'js/creature-death.js'],
  ['romance-runtime', 'js/romance-system.js', 'js/spouse-kiss-motion.js', 'js/npc-command-wheel.js'],
]; // Each independent owner stays between its original evaluation-time dependencies.

for (const [group, child, before, after] of required) {
  const tag = 'data-classic-group="' + group + '"'; // Ensures there is exactly one stable entry, with no child version in index.
  assert.equal(index.split(tag).length - 1, 1, group + ' must have exactly one stable parser position');
  assert(!index.includes('src="' + child + '?v='), child + ' cache token must belong to its manifest');
  const manifestPath = path.join(root, 'docs/js/bootstrap/classic-groups', group + '.js'); // The feature-owned cache version is changed here rather than index.
  const source = fs.readFileSync(manifestPath, 'utf8');
  const writes = []; // Captures exactly what the shipped browser would receive through document.write.
  vm.runInNewContext(source, { document: { readyState: 'loading', write: html => writes.push(html) } });
  assert.equal(writes.length, 1, group + ' must synchronously write its child script');
  assert.match(writes[0], /<\/script>/, group + ' child must have a real closing script tag');
  assert.equal([...writes[0].matchAll(/<script src="([^"]+)"><\/script>/g)].length, 1, group + ' owns exactly one child');
  const childAt = expanded.indexOf('src="' + child + '?v=');
  const beforeAt = expanded.indexOf('src="' + before + '?v=');
  const afterAt = expanded.indexOf('src="' + after + '?v=');
  assert(beforeAt >= 0 && beforeAt < childAt && childAt < afterAt,
    group + ' must retain the original parser execution order');
  assert.equal(expanded.split('src="' + child + '?v=').length - 1, 1, child + ' must not load twice');
  assert.throws(() => vm.runInNewContext(source, { document: { readyState: 'complete', write() {} } }),
    /must run during parsing/, group + ' must never async-inject an initialization dependency');
}
const uv = expanded.match(/js\/house-pieces\.js\?v=([A-Za-z0-9_-]+)&amp;surfaceUv=([A-Za-z0-9_-]+)/); // House still has independently authored natural-surface and bootstrap generations.
assert(uv, 'house manifest must preserve the separate natural-surface UV query key');
assert.match(uv[1], /^[A-Za-z0-9_-]+$/, 'house bootstrap has its own valid cache key; the UV generation is verified separately');

console.log('Active buff entrypoint manifests preserve load order, cache ownership, and house UV generation.');
