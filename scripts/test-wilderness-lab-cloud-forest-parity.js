'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = path.join(__dirname, '../docs/tools/wilderness-generation-lab');
const bootstrap = fs.readFileSync(path.join(rootPath, 'lab-markers.js'), 'utf8');
const previewRepair = fs.readFileSync(path.join(rootPath, 'lab-entry-repair.js'), 'utf8');

// The exact Cloud Forest preview needs the SAME former-cliff reforestation
// used by gameplay, then the shared wide-path restoration at normal density.
const northModule = bootstrap.indexOf('../../js/cloud-forest-runtime.js');
const roadModule = bootstrap.indexOf('../../js/wilderness-entry-corridor.js');
assert(northModule > 0 && roadModule > northModule,
  'Lab must load Cloud Forest north-wall repair before the causeway module');
assert(previewRepair.includes('CloudForestRuntimeV2.removeCloudForestNorthCliffs(workspace)'),
  'the Lab must actually invoke the game reforestation logic, not just load it');

let selectedRecipe = 'liveSouthernCloudForest';
const calls = [];
const ui = {
  WildernessLabPreview: { renderWorkspace(workspace) {
    calls.push('render');
    return workspace;
  } },
  CloudForestRuntimeV2: { removeCloudForestNorthCliffs(workspace) {
    calls.push('north');
    workspace.maps[0].generatedFrom.northBoundaryForestTrees = 7;
    return { removed:14, groups:1 };
  } },
  WildernessEntryCorridor: { applyWorkspace(workspace, {zoneId}) {
    calls.push('road');
    assert.equal(zoneId, selectedRecipe === 'liveSouthernCloudForest'
      ? 'map_southern_cloud_forest' : 'map_northern_cliffs');
    return {applied:true, cloudForestBackfillTrees:3};
  } },
};
const document = {getElementById:() => ({value:selectedRecipe})};
vm.runInNewContext(previewRepair, {window:ui, document, console}, {filename:'lab-entry-repair.js'});
const workspace = {maps:[{generatedFrom:{}}]};
ui.WildernessLabPreview.renderWorkspace(workspace);
assert.deepEqual(calls,['north','road','render'],
  'Cloud Forest north replanting and causeway cleanup must finish before preview draws');
assert.equal(workspace.wildernessLabCloudForestNorthRepair.backfilledTrees,7);
assert.equal(workspace.wildernessLabEntryRepairObserved.zoneId,'map_southern_cloud_forest');

selectedRecipe = 'liveNorthernCliffs';
calls.length=0;
ui.WildernessLabPreview.renderWorkspace({maps:[{generatedFrom:{}}]});
assert.deepEqual(calls,['road','render'],
  'Cloud Forest north-wall removal must never alter Northern Cliffs or other biomes');
console.log('PASS Wilderness Lab Cloud Forest entry/cliff reforestation preview parity');
