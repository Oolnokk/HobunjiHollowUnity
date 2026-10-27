const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));

function checkSign(relative, key, tankanText) {
  const data = json(relative); // Authored runtime record checked for editable sign geometry and decals.
  assert.equal(data.key, key);
  assert.equal(data.schema, 'hobunji_furniture_authored_runtime.v1');
  assert.deepEqual(data.footprint, { w: 1, d: 1 });
  assert.equal(data.tileBase?.footprintW, 1);
  assert.equal(data.tileBase?.footprintD, 1);
  assert.equal(data.repoFurniture?.uniformScaleFromOriginal, 0.8);

  const parts = new Map(data.parts.map(part => [part.id, part])); // Stable part ids used to compare the wall-mounted beam and board geometry.
  const beam = parts.get('hanging_sign_post')?.transform;
  const board = parts.get('hanging_sign_board')?.transform;
  const post = parts.get('hanging_sign_support_post')?.transform;
  assert(beam && board, `${key}: beam and board must both exist`);
  assert(!post, `${key}: wall-mounted sign must not retain its old freestanding support post`);

  const beamMin = beam.x - beam.sx / 2;
  const beamMax = beam.x + beam.sx / 2;
  const boardMin = board.x - board.sx / 2;
  const boardMax = board.x + board.sx / 2;
  const negativeOverhang = boardMin - beamMin; // Beam length beyond the hanging board on local -X.
  const positiveOverhang = beamMax - boardMax; // Beam length beyond the hanging board on local +X.
  assert(positiveOverhang > negativeOverhang, `${key}: +X must remain the longer beam overhang`);
  assert(beamMin >= -0.5 - 1e-9 && beamMax <= 0.5 + 1e-9, `${key}: horizontal beam must fit within one tile`);
  assert(Math.abs(beam.sx - 1) < 1e-9, `${key}: scaled beam should span exactly one tile`);
  assert.equal(data.wallOrnament?.attachmentSurfaceId, 'hanging_sign_post:surface:6', `${key}: +X beam end must remain the authored wall attachment`);
  assert.equal(data.wallOrnament?.surfacePartId, 'hanging_sign_post', `${key}: wall attachment must belong to the beam`);
  assert.deepEqual(data.wallOrnament?.normal, [1, 0, 0], `${key}: attachment normal must point along local +X`);
  assert.equal(data.repoFurniture?.placementMode, 'wall-ornament', `${key}: repository metadata must identify wall placement`);

  assert.equal(data.decals.length, 2, `${key}: both board faces need decals`);
  assert.deepEqual(new Set(data.decals.map(decal => decal.surfaceId)), new Set([
    'hanging_sign_board:surface:4',
    'hanging_sign_board:surface:8',
  ]));
  for (const decal of data.decals) {
    assert.equal(decal.width, 0.75);
    assert.equal(decal.height, 0.8);
    assert.equal(decal.opacity, 0.7);
    assert.equal(decal.normalOffset, 0);
    assert.equal(decal.sourceType, 'tankanText', `${key}: sign must use editable Tankan text rather than a baked image`);
    assert.equal(decal.tankanText, tankanText, `${key}: wrong Tankan sign text`);
    assert.equal(decal.imageSource, null, `${key}: Tankan text must not retain a stale image source`);
    assert.equal(decal.imageName, '', `${key}: Tankan text must not retain a stale image name`);
  }

  const surfaceById = new Map((data.recognizedSurfaces || []).map(surface => [surface.id, surface])); // Scaled face frames must keep runtime decal geometry proportional to the resized board.
  for (const decal of data.decals) {
    const surface = surfaceById.get(decal.surfaceId);
    assert(surface, `${key}: decal surface ${decal.surfaceId} missing`);
    const spanU = surface.bounds.maxU - surface.bounds.minU;
    const spanV = surface.bounds.maxV - surface.bounds.minV;
    assert(spanU <= board.sx * 1.03, `${key}: decal surface width still looks pre-scale`);
    assert(spanV <= board.sy * 1.03, `${key}: decal surface height still looks pre-scale`);
  }
}

checkSign('docs/config/furniture-authored/generalStoreSign.json', 'generalStoreSign', 'General Store');
checkSign('docs/config/furniture-authored/innSign.json', 'innSign', 'Inn');

// Both signs are house-owned fixtures; their inventory sources stay available.
for(const key of ['generalStoreSign','innSign']) {
  assert(json('docs/config/furniture-authored/'+key+'.json').key===key,
    key+' must remain a valid authored furniture definition');
  assert(read('docs/tools/map-editor/index.html').includes(key),
    key+' must remain available in the editor catalog');
}
const townMap=json('docs/config/maps/hobunji_hollow_town.map.json');
for(const [name,decor] of [['base',townMap.decor],...(townMap.layouts||[]).map((l,i)=>['layout '+i,l.decor])])
  assert(!(decor||[]).some(d=>['generalStoreSign','innSign'].includes(d.key)),
    name+' must not spawn floating duplicate sign decor');
const store=json('docs/config/pieces/general-store.json');
const innPiece=json('docs/config/pieces/inn.json');
const storeSrc=json('docs/config/furniture-authored/generalStoreSign.json');
const innSrc=json('docs/config/furniture-authored/innSign.json');
const mount=(piece,key)=>(piece.wallFixtures||[]).filter(f=>f.authoredFurnitureKey===key);
assert.equal(mount(store,'generalStoreSign').length,1);
assert.equal(mount(innPiece,'innSign').length,1);
const sf=mount(store,'generalStoreSign')[0],nf=mount(innPiece,'innSign')[0];
assert.equal(sf.faceId,1303);
assert.equal(nf.faceId,233);
assert.equal(sf.u,.79);
assert.equal(sf.v,1);
assert.equal(sf.bodyOutset,.362);
assert.equal(nf.bodyOutset,sf.bodyOutset);
assert.equal(sf.depth,0);
assert.equal(nf.depth,0);
assert.deepEqual(sf.authoredScale,[.575,.8,1.5]);
assert.deepEqual(nf.authoredScale,[.718,.86,1.872]);
assert.deepEqual(sf.authoredAnchor,storeSrc.wallOrnament.anchor);
assert.deepEqual(nf.authoredAnchor,innSrc.wallOrnament.anchor);
assert.equal(storeSrc.repoFurniture.placementConfig,'docs/config/pieces/general-store.json (wallFixtures; face 1303)');
assert.equal(innSrc.repoFurniture.placementConfig,'docs/config/pieces/inn.json (wallFixtures; face 233)');
const point=(f,u,v)=>[0,1,2].map(i=>
  (1-v)*((1-u)*f.v[0][i]+u*f.v[3][i])
  +v*((1-u)*f.v[1][i]+u*f.v[2][i]));
const st=store.base.faces.find(f=>f.id===sf.faceId);
const it=innPiece.base.faces.find(f=>f.id===nf.faceId);
const storeDoor=store.footprint.door.x-Math.floor(store.gridSize/2)+.5;
const innDoor=innPiece.footprint.door.x-Math.floor(innPiece.gridSize/2)+.5;
const stOffset=point(st,sf.u,sf.v)[0]-storeDoor;
const innOffset=point(it,nf.u,nf.v)[0]-innDoor;
assert(Math.abs(stOffset+.979)<1e-6);
assert(Math.abs(innOffset-stOffset)<1e-6,'door-relative offset drift');
assert(Math.abs(point(st,sf.u,sf.v)[1]-point(it,nf.u,nf.v)[1])<1e-6);
assert.deepEqual(townMap.buildings.find(b=>b.pieceFile==='config/pieces/inn.json').doorEntrance.cells,[{x:4,y:4}]);
assert.equal(innPiece.footprint.door.x,10);
assert.equal(innPiece.footprint.door.y,11);
assert(read('docs/js/HousePieceGen.js').includes('HouseWallFixtures.createGroup'));
const runtime=read('docs/js/house-wall-fixtures.js');
assert(runtime.includes('authored.buildGroup')&&runtime.includes('authored.load(key)'));
const editor=read('docs/tools/house-piece-author/house-wall-fixture-editor.js');
assert(editor.includes('hwfSourceSX')&&editor.includes('hwfNudgeLeft')&&editor.includes('hwfNudgeOut'));
assert(!store.assets.some(a=>a.name==='General Store Sign'));

// The retired hardcoded system must actually be gone, not left as dead
// weight alongside the new decor entries (which would double-render).
assert(!fs.existsSync(path.join(root, 'docs/config/town-sign-furniture-config.js')), 'town-sign-furniture-config.js should be removed now the signs are workspace decor');
assert(!fs.existsSync(path.join(root, 'docs/js/town-sign-furniture-runtime.js')), 'town-sign-furniture-runtime.js should be removed now the signs are workspace decor');
const zoneLoader = read('docs/js/zone-den-totem-features.js');
assert(!zoneLoader.includes('TownSignFurnitureRuntime'), 'zone-den-totem-features.js must no longer load the retired town sign runtime');
assert(!zoneLoader.includes('HOBUNJI_TOWN_SIGN_FURNITURE_CONFIG'), 'zone-den-totem-features.js must no longer load the retired town sign config');
assert(zoneLoader.includes("ensureCompanionScript('FurnitureDecalRuntime', 'furniture-decal-runtime.js?v="), 'FurnitureDecalRuntime (unrelated to the retired sign system) must still load');

console.log('town sign furniture checks passed');
