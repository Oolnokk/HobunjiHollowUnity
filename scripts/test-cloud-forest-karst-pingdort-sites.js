'use strict';
// Run: node scripts/test-cloud-forest-karst-pingdort-sites.js
const assert=require('node:assert/strict');
require('../docs/js/cloud-forest-runtime.js');
const TerrainPreview=require('../docs/js/terrain-preview.js');
const karst=globalThis.CloudForestRuntimeV2.addCloudForestKarstPlateaus;
assert.equal(typeof karst,'function','karst generator is exposed for repeatable tests');
const size=140; // Enough map area to test irregularly spaced multi-pillar pockets.
const root={
  schema:'hobunji_map.v1',id:'map_cloud_test',cols:size,rows:size,
  tiles:{},generatedFrom:{seed:'cloud-karst-fixture'},
}; // Parent root owns a real, full-sized existing Cloud Forest plateau mask.
const base={
  schema:'hobunji_map.v1',id:'map_cloud_base',isSubmap:true,parentMapId:root.id,
  plateauGroupId:'existing',elevation:2,anchorC:1,anchorR:1,
  cols:size-2,rows:size-2,tiles:{},
}; // An existing level-2 submap is required: pillars must never flatten this terrace.
for(let r=0;r<size;r++)for(let c=0;c<size;c++){
  const road=c===size/2&&r>=18&&r<size-18;
  root.tiles[c+','+r]={type:road?'path':'grass',crop:'',plateau:'existing'};
  if(c>0&&r>0&&c<size-1&&r<size-1)
    base.tiles[(c-1)+','+(r-1)]={type:road?'path':'grass',crop:''};
}
const ws={maps:[root,base],plateauGroups:[{id:'existing',number:1,elevation:2,color:'#888888'}],
  generatorPreset:{id:'cloud'}};
const report=karst(ws);
assert(report.towers>=2,'multiple genuine karst pillars must be created in free terrain');
const towers=ws.maps.filter(m=>String(m.plateauGroupId).startsWith('cloud_karst_'));
assert.equal(towers.length,report.towers);
assert.equal(ws.plateauGroups.length,1+report.towers);
const elevations=new Map(ws.plateauGroups.map(g=>[g.id,g.elevation]));
for(const tower of towers){
  assert.equal(tower.parentMapId,base.id,'pillar must be nested on the old plateau, not stamped over root masks');
  assert(tower.elevation>2&&Object.keys(tower.tiles).length>8,'pillar contains real raised, walkable upper ground');
  const parentCells=Object.entries(base.tiles).filter(([,t])=>t.plateau===tower.plateauGroupId);
  assert(parentCells.length>25,'real parent-painted perimeter supplies the sheer cliff faces');
  assert.equal(elevations.get(tower.plateauGroupId),tower.elevation);
}
for(let r=18;r<size-18;r++){
  assert.equal(root.tiles[size/2+','+r].type,'path','original road cannot be bulldozed');
  assert.equal(base.tiles[(size/2-1)+','+(r-1)].type,'path','original terrace road remains passable');
}
const merged=TerrainPreview.buildMergedZoneGrid(ws,root.id);
const grid=TerrainPreview.buildZGrid(merged.cols,merged.rows,merged.tiles);
for(const tower of towers){
  const tile=Object.keys(tower.tiles).find(k=>tower.tiles[k]?.type==='grass');
  assert(tile,'raised plateau must contain walkable grass');
  const [c,r]=tile.split(',').map(Number);
  const worldC=base.anchorC+tower.anchorC+c,worldR=base.anchorR+tower.anchorR+r;
  assert.equal(grid[worldR][worldC].elevTier,tower.elevation,'nested tier reaches canonical runtime collision grid');
}
assert.equal(karst(ws).towers,report.towers,'running the wrapper twice is idempotent');
assert.equal(ws.maps.length,2+towers.length,'idempotency adds no extra submaps');
console.log('Cloud Forest nested karst plateau masks, preserved roads, elevation and repeatability PASS');
