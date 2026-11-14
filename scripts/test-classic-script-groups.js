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
const baseline = { // Relative order anchors from the first migration, not an exhaustive registry.
  qol: ['toast-notifications', 'location-arrival', 'qol-hotkeys', 'inventory-search'],
  guild: ['delvers-guild-story', 'town-magic-checkpoint', 'delvers-vault-signal'],
  render: ['npc-view-frustum-cull', 'instanced-mesh-view-cull', 'grass-billboard-render-chunks', 'scissor-depth-snapshot', 'actor-render-occlusion'],
};
const groups = [...html.matchAll(/data-classic-group="([a-z][a-z0-9-]*)"/g)].map(m => m[1]); // Discovers future groups without changing this file.
assert(groups.length > 0, 'the game page defines at least one classic group');
assert.equal(new Set(groups).size, groups.length, 'each group loads at exactly one parser position');

new vm.Script(loader, { filename: 'classic-script-group-loader.js' });
for (const group of groups) {
  const manifestWrites = []; // Captures the manifest's parser-time child scripts.
  const loaderWrites = []; // Captures the loader's fresh per-navigation manifest request.
  vm.runInNewContext(loader, {
    document: { readyState: 'loading', currentScript: { getAttribute: () => group }, write: v => loaderWrites.push(v) },
    Date: { now: () => 123456 },
  });
  assert.equal(loaderWrites.length, 1);
  assert.match(loaderWrites[0], new RegExp('classic-groups/' + group + '\\.js\\?load=123456'));
  assert.match(loaderWrites[0], /<\/script>/, 'parser receives a properly closed manifest script');

  const manifestPath = path.join(root, 'docs/js/bootstrap/classic-groups', group + '.js'); // Group-specific script URLs.
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  new vm.Script(manifest, { filename: manifestPath });
  vm.runInNewContext(manifest, { document: { readyState: 'loading', write: v => manifestWrites.push(v) } });
  assert.equal(manifestWrites.length, 1);
  const urls = [...manifestWrites[0].matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert(urls.length > 0, group + ' must contain at least one script');
  assert.equal(new Set(urls.map(u => u.split('?')[0])).size, urls.length, group + ' must not duplicate module paths');
  assert(urls.every(url => /\?v=[a-zA-Z0-9_-]+$/.test(url)), group + ' modules need versioned URLs');
  const names = urls.map(url => url.replace(/^js\/|\.js\?.*$/g, '')); // Module names used for baseline ordering checks.
  let previous = -1; // Tracks each baseline member's position as new modules are inserted.
  for (const anchor of baseline[group] || []) {
    const position = names.indexOf(anchor);
    assert(position > previous, group + ' baseline ordering changed at ' + anchor);
    previous = position;
  }
}
const expanded = expandClassicScriptGroups(html); // Effective script tags in their original parser positions.
const urls = [...expanded.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
for (const anchor of Object.values(baseline).flat()) {
  assert.equal(urls.filter(url => url.startsWith('js/' + anchor + '.js?v=')).length, 1, anchor + ' loads exactly once');
}
assert(expanded.indexOf('js/toast-notifications.js') < expanded.indexOf('js/delvers-guild-story.js'));
assert(expanded.indexOf('js/delvers-vault-signal.js') < expanded.indexOf('js/bed-lie-pose.js'));
assert(expanded.indexOf('js/actor-render-occlusion.js') < expanded.indexOf('src="game.js?v='));
assert(!expanded.includes('data-classic-group='), 'the test view expands all registered groups');
assert.throws(() => vm.runInNewContext(loader, {
  document: { readyState: 'complete', currentScript: { getAttribute: () => 'qol' }, write() {} },
  Date,
}), /must load while HTML is parsing/);
console.log('Parser-ordered script groups preserve baseline order; new group modules need no shared test edits.');
