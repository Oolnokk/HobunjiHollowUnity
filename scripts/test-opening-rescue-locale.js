'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const generator = require('../docs/js/wilderness-map-generator.js');
require('../docs/js/locale-terrain-placement.js').install(generator);
const index = require('../docs/config/locales/index.json'); // Loads the same eligible locale set as the Tothal Shift.
const locales = index.locales.filter(entry=>['story_poi','great_fey_shrine','ruin_entrance'].includes(entry.category)).map(entry=>JSON.parse(fs.readFileSync('docs/'+entry.file,'utf8')));
const clearing = locales.find(locale=>locale.id==='locale_opening_rescue'); // Rescue site must remain authorable and discoverable through the Locale Editor index.
assert(clearing);
assert.deepEqual(clearing.placement.allowedZones,['map_southern_cloud_forest']);
const context = {window:{},document:{addEventListener(){}},console}; // Builds the shipping scene without booting gameplay.
vm.runInNewContext(fs.readFileSync('docs/js/opening-story-cutscene.js','utf8'),context);
const rescue = context.window.OpeningStoryCutscene.buildRescueScene(new Map(),{});
for (const point of [...rescue.actors,...rescue.stages.filter(stage=>stage.targetLocal).map(stage=>stage.targetLocal)]) {
  assert(clearing.tiles[point.lc+','+point.lr],'every entrance, actor and flee destination belongs to the authored clearing');
}
const workspace = generator.generateZoneWorkspace('map_southern_cloud_forest','opening-a',locales); // Real terrain, density scaling and competing locales must preserve the reserved site.
const placed = workspace.localeInstances.find(instance=>instance.localeId===clearing.id);
assert(placed,'actual Cloud Forest generation reserves the rescue locale');
assert(placed.w>=rescue.footprint.w&&placed.h>=rescue.footprint.h);
console.log('Authored Cloud Forest rescue footprint and full-generation reservation passed.');
