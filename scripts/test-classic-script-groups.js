#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js');

const root = path.resolve(__dirname, '..'); // Actual shipped scripts are the test inputs.
const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8'); // Original parser positions.
const loader = fs.readFileSync(path.join(root, 'docs/js/bootstrap/classic-script-group-loader.js'), 'utf8');
const expected = { // Original order in each migrated group, to catch accidental startup reordering.
  qol: ['toast-notifications', 'location-arrival', 'qol-hotkeys', 'inventory-search'],
  guild: ['delvers-guild-story', 'town-magic-checkpoint', 'delvers-vault-signal'],
  render: ['npc-view-frustum-cull', 'instanced-mesh-view-cull', 'grass-billboard-render-chunks', 'scissor-depth-snapshot', 'actor-render-occlusion'],
};

new vm.Script(loader, { filename: 'classic-script-group-loader.js' });
for (const group of Object.keys(expected)) {
  const tag = 'data-classic-group="' + group + '"';
  assert.equal(html.split(tag).length - 1, 1, group + ' appears once in the game page');
  const loaderWrites = []; // Verifies a fresh manifest is fetched at each parser insertion.
  vm.runInNewContext(loader, {
    document: { readyState: 'loading', currentScript: { getAttribute: () => group }, write: v => loaderWrites.push(v) },
    Date: { now: () => 123456 },
  });
  assert.equal(loaderWrites.length, 1);
  assert.match(loaderWrites[0], new RegExp('classic-groups/' + group + '\\.js\\?load=123456'));
  assert.match(loaderWrites[0], /<\/script>/, 'manifest tag closes normally for HTML parsing');

  const source = fs.readFileSync(path.join(root, 'docs/js/bootstrap/classic-groups', group + '.js'), 'utf8');
  new vm.Script(source);
  const manifestWrites = []; // Verifies classic module insertion without network or browser mocks.
  vm.runInNewContext(source, { document: { readyState: 'loading', write: v => manifestWrites.push(v) } });
  assert.equal(manifestWrites.length, 1);
  const actual = [...manifestWrites[0].matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(actual.map(url => url.replace(/^js\/|\.js\?.*$/g, '')), expected[group], group + ' module sequence changed');
  assert(actual.every(url => /\?v=[a-zA-Z0-9_-]+$/.test(url)), group + ' components need versioned URLs');
}
const expanded = expandClassicScriptGroups(html); // Effective script markup, with each group expanded in parser order.
const urls = [...expanded.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
for (const moduleName of Object.values(expected).flat()) {
  assert.equal(urls.filter(url => url.startsWith('js/' + moduleName + '.js?v=')).length, 1, moduleName + ' loads exactly once');
}
assert(expanded.indexOf('js/toast-notifications.js') < expanded.indexOf('js/delvers-guild-story.js'));
assert(expanded.indexOf('js/delvers-vault-signal.js') < expanded.indexOf('js/bed-lie-pose.js'));
assert(expanded.indexOf('js/actor-render-occlusion.js') < expanded.indexOf('src="game.js?v='));
assert(!expanded.includes('data-classic-group='), 'test view expands all registered groups');
assert.throws(() => vm.runInNewContext(loader, {
  document: { readyState: 'complete', currentScript: { getAttribute: () => 'qol' }, write() {} },
  Date,
}), /must load while HTML is parsing/);
console.log('Parser-ordered script groups preserve original URLs and load order.');
