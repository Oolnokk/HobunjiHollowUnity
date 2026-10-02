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
assert.deepEqual(clearing.placement.allowedZones,['map_opening_cloud_forest']);
const context = {window:{},document:{addEventListener(){}},console}; // Builds the shipping scene without booting gameplay.
vm.runInNewContext(fs.readFileSync('docs/js/opening-story-cutscene.js','utf8'),context);
const rescue = context.window.OpeningStoryCutscene.buildRescueScene(new Map(),{});
for (const point of [...rescue.actors,...rescue.stages.filter(stage=>stage.targetLocal).map(stage=>stage.targetLocal)]) {
  assert(clearing.tiles[point.lc+','+point.lr],'every entrance, actor and flee destination belongs to the authored clearing');
}
const terrain = require('../docs/js/terrain-preview.js'); // Execute the same exported terrain fold used by the real lab and cinematic map.
const game = fs.readFileSync('docs/game.js','utf8'); // Extract the existing mini-map owner rather than mirror its implementation.
const layouts = new Map([['map_southern_cloud_forest',{ sentinel:true }]]); // Real world terrain must remain independent of the rescue map.
const disposed = []; // Observe the existing cleanup owner called during regeneration.
const lab = { WildernessMapGenerator:generator, TerrainPreview:terrain, window:{WildernessChunks:{constants:{CHUNK_TILES:16}}}, _zoneLayouts:layouts, EXTERIOR_ZONES:{map_opening_cloud_forest:{}}, currentArea:'farm', _disposeZoneScene:id=>disposed.push(id), debugLog(){}, console };
vm.runInNewContext(game.slice(game.indexOf('      function regenerateWildernessLab('),game.indexOf('      window.__regenerateWildernessLab'))+'\nregenerate=regenerateWildernessLab;',lab);
for(let i=0;i<5;i++) {
  assert.equal(lab.regenerate(rescue.miniWilderness.chunksPerSide,'opening_mini_'+i,{mapId:rescue.mapId,sourceZoneId:rescue.miniWilderness.sourceZoneId,locales:[clearing],requiredLocaleId:clearing.id}),true);
  const layout = layouts.get(rescue.mapId); // Runtime consumes this exact merged grid, not the generator's pre-export working tiles.
  assert.equal(layout.cols,64);assert.equal(layout.rows,64);
  const placed = layout.localeInstances.find(instance=>instance.localeId===clearing.id);
  assert(placed,'small Cloud Forest always stamps the required clearing');
  const tiles = new Map(layout.tiles.map(tile=>[tile.c+','+tile.r,tile]));
  for(let r=0;r<rescue.footprint.h;r++) for(let c=0;c<rescue.footprint.w;c++) {
    const tile = tiles.get((placed.x+c)+','+(placed.y+r));
    assert(tile,'every local actor/path tile exists');if(c > 1 || r > 1) assert.equal(tile.type,'grass');assert.equal(tile.elevTier,0);assert(!tile.skipFloor && !tile.incline,'carved stage has no folded cliff cells');
  }
  assert(layout.tiles.some(tile=>tile.floraKind==='copse'),'the generated Cloud Forest remains around the clearing');
}
assert.equal(layouts.get('map_southern_cloud_forest').sentinel,true,'mini generation cannot replace the world Cloud Forest');
assert.equal(disposed.length,5);
assert.equal(generator.zoneSettings('map_southern_cloud_forest').preset,'greatBasin');
assert.equal(generator.generationTileScale,2);
const cleanup = { temporaryWildernessArea:rescue.mapId, liveMode:true, releaseCinematicRegion(){}, liveLock:null, _disposeZoneScene:id=>disposed.push(id), _zoneLayouts:layouts, document:{body:{classList:{remove(){}}}}, _arcContainerEl:null, clearPovShot(){}, cutsceneLeaveButton:null }; // Execute the exact finish/failure cleanup used by the cinematic runtime.
vm.runInNewContext(game.slice(game.indexOf('        const releaseLiveLock ='),game.indexOf('        const restoreLiveGameplay ='))+'\nreleaseLiveLock();releaseLiveLock();',cleanup);
assert(!layouts.has(rescue.mapId),'cleanup releases temporary terrain data');
assert.equal(disposed.length,6,'temporary scene disposal is idempotent');
assert.equal(layouts.get('map_southern_cloud_forest').sentinel,true,'cleanup preserves the normal world zone');

console.log('Five generated Cloud Forest mini-maps: required locale, clear folded stage, surrounding trees, shared scale and world isolation passed.');
