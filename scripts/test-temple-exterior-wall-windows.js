// node scripts/test-temple-exterior-wall-windows.js
// The south-facing fifth temple window has no exterior analogue.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const house=JSON.parse(read('docs/config/pieces/temple.json'));
const interior=JSON.parse(read('docs/config/maps/map_i_temple.json'));
const globals={};vm.runInNewContext(read('docs/js/house-wall-fixtures.js'),{window:globals});
const api=globals.HouseWallFixtures;
const candidates=house.wallFixtures||[];
// Positions from the revised Temple export; manual placement supersedes equal spacing.
const specs=[
 ['temple_east_window_potential',14,0.2863266874518197,'fwall_mv77lbuqd1er','blessed_blossom_potential',0.5884987745250742,0.82,1.1],
 ['temple_east_window_windswept',14,0.7295747095622925,'fwall_mv77wqry70qh','blessed_blossom_windswept',0.610964352346699,0.8082558551104738,1.0842456592945382],
 ['temple_west_window_rebirth',16,0.28617338721249175,'fwall_mv780vrmh7b9','blessed_blossom_rebirth',0.608256740112092,0.8141067504882812,1.0920944213867188],
 ['temple_west_window_balance',16,0.7138266127875084,'fwall_mv786wv4mgxi','blessed_blossom_balance',0.608256740112092,0.8141067504882812,1.0920944213867188]
];
assert.equal(candidates.filter(f=>f.key==='crossbarWindow').length,4,'exactly four exterior temple windows');
for(const [id,faceId,u,sourceId,overpass,v,width,height] of specs){
 const f=candidates.find(f=>f.id===id);
 assert(f,id+' missing');assert.equal(f.key,'crossbarWindow');assert.equal(f.faceId,faceId);
 assert(Math.abs(f.u-u)<1e-9,id+' must retain the revised authored wall position');
 assert.equal(f.v,v);assert.equal(f.width,width);assert.equal(f.height,height);
 const face=house.base.faces.find(f=>f.id===faceId);
 assert(face&&face.tag==='wall'&&!face.gableEnd,'must use actual outer wall');
 const source=interior.furniture.find(x=>x.id===sourceId);
 assert(source&&source.itemKey==='crossbarWindowFurniture','original interior window must be preserved');
 assert.deepEqual(f.pattern,source.patternOverrides.crossbar_window_pane[0],
   id+' must use the exact interior stained-glass/overpass palette and transforms');
 assert.equal(f.pattern.overpassPatternId,overpass);
 assert.deepEqual(f.pattern.palette,source.patternOverrides.crossbar_window_pane[0].palette);
 assert.equal(f.interiorWindowId,sourceId);
 const corners=api.paneCornersUV(face,api.fitToFace(face,f));
 assert(corners.length===4 && corners.every(c=>
   c.u>.0149&&c.u<.9851&&c.v>.0149&&c.v<.9851),
   id+' aperture exceeds its exterior wall');
}
assert(!candidates.some(f=>f.interiorWindowId==='fwall_mv74tcm0luv6'),
  'the fifth south-side window has no exterior and must be omitted');
const cut=api.cutFaces(house.base.faces,candidates);
assert.equal(cut.openingQuads.length,4,'four real wall openings are expected');
assert(cut.faces.length>house.base.faces.length,
 'wall surfaces must be partitioned around the transparent stained glass');
const engine=read('docs/js/HousePieceGen.js');
assert(engine.includes('HouseWallFixtures?.cutFaces')&&engine.includes('HouseWallFixtures.createGroup'),
 'the gameplay renderer must use identical cutting and wall-fixture meshes');
const gameHtml=read('docs/index.html');
assert(gameHtml.indexOf('src="js/house-wall-fixtures.js')<gameHtml.indexOf('src="js/HousePieceGen.js'),
 'the fixture module must load before the house geometry generator');
console.log('Temple exterior windows: all four source patterns, revised placements and wall apertures pass');
