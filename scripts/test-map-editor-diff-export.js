// Run: node scripts/test-map-editor-diff-export.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('docs/js/map-editor-export-fixes.js', 'utf8'); // Actual browser diff/export controller under test.
const html = fs.readFileSync('docs/tools/map-editor/index.html', 'utf8'); // Ensures the controller is loaded by the shipped editor.
new vm.Script(script, { filename: 'map-editor-export-fixes.js' });
assert(html.includes('<script src="../../js/map-editor-export-fixes.js?'), 'Map Editor must load the diff controller');

const original = {
  schema: 'hobunji_map.v1', id: 'map_hobunji_town', name: 'Town', category: 'exterior',
  cols: 2, rows: 1, tiles: { '0,0': { type: 'grass', crop: '' } },
  buildings: [], npcStations: [], layouts: [], visualHeights: {}, puzzleWiring: [],
};
const workspace = { activeId: original.id, maps: [original], plateauGroups: [], ramps: [] }; // Mutable editor workspace fixture.
const handlers = {}; // Captured button handlers; allows testing the real UI export path without a browser.
const elements = Object.fromEntries(['exportDiffBtn', 'exportMapBtn', 'diffDownloadBtn', 'diffTextarea', 'diffTitle', 'diffSubtitle', 'diffModal', 'statusPill'].map(id => [id, {
  value: '', textContent: '', style: {}, addEventListener: (event, callback) => { handlers[id + ':' + event] = callback; },
}]));
const window = { _mapEditorBridge: { getWorkspace: () => workspace } }; // Existing Map Editor bridge contract.
const document = { readyState: 'complete', getElementById: id => elements[id] || null };
vm.runInNewContext(script, { window, document, location: { pathname: '/tools/map-editor/index.html' }, console, setTimeout: () => { throw Error('Unexpected delayed initialization'); } });
const api = window.MapEditorExportFixes;
assert(api, 'Diff controller failed to install');
assert.equal(api.buildDetailedDiff(original).summary.changed, false);

const edited = JSON.parse(JSON.stringify(original)); // Simulates replacing the same map ID after importing an edited workspace.
edited.tiles['0,0'] = { type: 'path', crop: '' };
edited.visualHeights['0,0'] = 0.5;
edited.buildings.push({ id: 'bldg_test', label: 'Imported building' });
edited.layouts.push({ id: 'festival_test', decor: [{ id: 'prop_test', key: 'bench' }] });
edited.puzzleWiring.push({ id: 'wire_test' });
workspace.maps[0] = edited;
const diff = api.buildDetailedDiff(edited);
assert.equal(diff.baselineAvailable, true);
assert.equal(diff.summary.changed, true, 'Replacing an existing map must not reset its baseline');
assert.equal(diff.summary.tileChanges, 1);
for (const field of ['visualHeights', 'buildings', 'layouts', 'puzzleWiring']) {
  assert(diff.summary.changedFields.includes(field), `Missing changed field: ${field}`);
}
assert.equal(diff.tiles.modified[0].after.type, 'path');

const imported = { ...JSON.parse(JSON.stringify(original)), id: 'map_imported', name: 'Imported' }; // A new map has no pre-import baseline.
workspace.maps.push(imported);
workspace.activeId = imported.id;
const fallback = api.buildDetailedDiff(imported);
assert.equal(fallback.baselineAvailable, false);
assert.equal(fallback.mode, 'full-map-fallback');
assert.equal(fallback.fullMap.id, 'map_imported');
assert.equal(fallback.fullMap.tiles[0].type, 'grass');

const bundle = api.buildWorkspaceDiffBundle();
assert.equal(bundle.summary.changed, true);
assert.equal(bundle.summary.addedMaps, 1);
assert.equal(bundle.maps.length, 1, 'Changed original map should appear in workspace bundle');

const event = { preventDefault() {}, stopImmediatePropagation() {} };
handlers['exportDiffBtn:click'](event); // Real capture-phase export handler must show complete fallback JSON.
assert.equal(JSON.parse(elements.diffTextarea.value).mode, 'full-map-fallback');
assert.equal(elements.diffModal.style.display, 'block');

api.captureWorkspaceBaselines(); // Explicit reset is the only operation that may redefine the baseline.
assert.equal(api.buildDetailedDiff(edited).summary.changed, false);
assert.equal(api.buildDetailedDiff(imported).summary.changed, false);
console.log('Map diff baselines, imported maps, authored fields, and modal export passed.');
