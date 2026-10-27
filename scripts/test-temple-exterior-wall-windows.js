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
const specs=[
 ['temple_east_window_potential',26,1/3,'fwall_mv77lbuqd1er','blessed_blossom_potential'],
 ['temple_east_window_windswept',26,2/3,'fwall_mv77wqry70qh','blessed_blossom_windswept'],
 ['temple_west_window_rebirth',17,1/3,'fwall_mv780vrmh7b9','blessed_blossom_rebirth'],
 ['temple_west_window_balance',17,2/3,'fwall_mv786wv4mgxi','blessed_blossom_balance']
];
assert.equal(candidates.filter(f=>f.key==='crossbarWindow').length,4,'exactly four exterior temple windows');
for(const [id,faceId,u,sourceId,overpass] of specs){
 const f=candidates.find(f=>f.id===id);
 assert(f,id+' missing');assert.equal(f.key,'crossbarWindow');assert.equal(f.faceId,faceId);
 assert(Math.abs(f.u-u)<1e-9,id+' uneven wall spacing');assert.equal(f.v,.52);
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
console.log('Temple exterior windows: all four source patterns, spacing and wall apertures pass');
