// Node: node scripts/test-general-store-wall-sign.js
// Store sign migrates from town decor to the actual house piece: no duplicates,
// no generic substitute, and no shift in door-relative position or rotation.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'../',p),'utf8');
const town=JSON.parse(read('docs/config/maps/hobunji_hollow_town.map.json'));
const piece=JSON.parse(read('docs/config/pieces/general-store.json'));
const sign=JSON.parse(read('docs/config/furniture-authored/generalStoreSign.json'));
const source=read('docs/js/house-wall-fixtures.js');
const sandbox={window:{}};vm.runInNewContext(source,sandbox,{filename:'house-wall-fixtures.js'});
const api=sandbox.window.HouseWallFixtures;
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} vs ${b}`);

assert.equal((town.decor||[]).filter(r=>r.key==='generalStoreSign'||r.id==='town_general_store_sign').length,0);
for(const [i,layout] of (town.layouts||[]).entries()){
  assert.equal((layout.decor||[]).filter(r=>r.key==='generalStoreSign'||r.id==='town_general_store_sign').length,0,
    'layout '+i+' must not resurrect old decor');
}
assert.equal((town.decor||[]).filter(r=>r.key==='innSign').length,0,'Inn sign is now house-mounted too');
const building=town.buildings.find(r=>r.pieceFile==='config/pieces/general-store.json');
assert.ok(building);
const matches=(piece.wallFixtures||[]).filter(r=>r.id==='town_general_store_sign'||r.authoredFurnitureKey==='generalStoreSign');
assert.equal(matches.length,1,'one store sign, owned by the house piece');
const fixture=matches[0];
assert.equal(fixture.key,'generalStoreSign');
assert.equal(fixture.authoredFurnitureKey,sign.key);
assert.deepEqual(fixture.authoredAnchor,sign.wallOrnament.anchor);
assert.deepEqual(fixture.authoredScale,[.575,.8,1.5]);
assert.equal(fixture.u,.79);
assert.equal(fixture.v,1);
assert.equal(fixture.bodyOutset,.362);
assert.equal(fixture.pattern.patternId,'diamond-ring');
assert.deepEqual(fixture.authoredAttachmentNormal,[1,0,0]);
const face=piece.base.faces.find(f=>f.id===fixture.faceId);
assert.ok(face&&face.tag==='wall'&&!face.gableEnd,'must mount to the front wall, not a roof/gable');

const minC=Math.min(...piece.footprint.cells.map(c=>c.x));
const minR=Math.min(...piece.footprint.cells.map(c=>c.y));
const gridCenter=Math.floor(piece.gridSize/2);
const originX=building.gridX+gridCenter-minC,originZ=building.gridZ+gridCenter-minR;
assert.equal(building.rotationDeg,0,'this migration assumes the authored town placement is unrotated');
// A +90° yaw rotates the authored beam's local +X end into negative Z.
// The mounting frame remains upright (no undesired taper wall tilt).
const wall=api.point(face,fixture.u,fixture.v);
const beam=[wall[0],wall[1],wall[2]+fixture.depth];
const recoveredRoot=[beam[0],beam[1]-fixture.authoredAnchor[1]*fixture.authoredScale[1],
  beam[2]+fixture.bodyOutset+fixture.authoredAnchor[0]*fixture.authoredScale[0]];
// The user explicitly re-authored the wall fixture on 2026-10-27; its
// sourceTownPlacement is history, NOT a current position invariant.
const doorCenter=building.gridX+piece.footprint.door.x-minC+.5;
near(recoveredRoot[0]+originX-doorCenter,-.979,'door-relative sign X');
near(beam[1],1.4,'sign beam mount height');
near(fixture.depth,0,'beam anchored flush to host wall');
near(fixture.bodyOutset,.362,'new authored furniture outward reach');
near(recoveredRoot[1],1.4-1.376*.8,'re-authored sign model origin Y');
near(recoveredRoot[2],1.7+.362+.5*.575,'re-authored sign model origin Z');

// A sign must never cut a window aperture: only windows subtract wall geometry.
const result=api.cutFaces([face],[fixture]);
assert.equal(result.openingQuads.length,0);
assert.equal(result.faces.length,1);
assert.equal(result.faces[0],face);
assert.ok(/authored\.buildGroup\(data/.test(source),'actual authored model must be rebuilt, not replaced with placeholder');
assert.ok(read('docs/tools/house-piece-author/house-wall-fixture-editor.js').includes('generalStoreSign'),
  'the House Editor must expose the fixture');
console.log('General Store sign migration: placement and no-duplicate checks passed');
