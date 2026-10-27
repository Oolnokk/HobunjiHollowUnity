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

// The Inn sign remains ordinary editable town decor. The General Store sign
// is now a face-bound fixture in its actual house JSON; rendering still reuses
// the ORIGINAL authored furniture JSON, including both Tankan-script decals.
// Inventory-placeable sign definitions stay intact.
const gameJs = read('docs/game.js');
assert(/generalStoreSign:\s*\{[^}]*fixture:\s*true/.test(gameJs), 'generalStoreSign must be a DECORATIVE_FURNITURE_DEFS fixture entry');
assert(/innSign:\s*\{[^}]*fixture:\s*true/.test(gameJs), 'innSign must be a DECORATIVE_FURNITURE_DEFS fixture entry');
const authoredKeysMatch = gameJs.match(/const AUTHORED_FURNITURE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
assert(authoredKeysMatch, 'AUTHORED_FURNITURE_KEYS set must exist');
assert(authoredKeysMatch[1].includes("'generalStoreSign'"), 'generalStoreSign must be in AUTHORED_FURNITURE_KEYS or it silently falls back to an empty ProceduralFurniture group');
assert(authoredKeysMatch[1].includes("'innSign'"), 'innSign must be in AUTHORED_FURNITURE_KEYS or it silently falls back to an empty ProceduralFurniture group');

const mapEditorHtml = read('docs/tools/map-editor/index.html');
assert(/generalStoreSign:\{icon:/.test(mapEditorHtml), 'generalStoreSign must be placeable from the Map Editor Decor palette');
assert(/innSign:\{icon:/.test(mapEditorHtml), 'innSign must be placeable from the Map Editor Decor palette');

const townMap = json('docs/config/maps/hobunji_hollow_town.map.json');
const decorByKey = new Map((townMap.decor || []).map(d => [d.key, d]));
const inn = decorByKey.get('innSign');
assert(!decorByKey.has('generalStoreSign'), 'the General Store sign must no longer render as a duplicate town decor entry');
for(const [index,layout] of (townMap.layouts||[]).entries()){
  assert(!(layout.decor||[]).some(d=>d.key==='generalStoreSign'||d.id==='town_general_store_sign'),
    'town alternate layout '+index+' must not respawn a second General Store sign');
}
assert(inn, 'Inn sign must remain as ordinary town decor');
assert.equal(inn.rotY, 90, 'innSign must rotate its +X support side toward north');

const store = json('docs/config/pieces/general-store.json');
const sign = json('docs/config/furniture-authored/generalStoreSign.json');
const building = townMap.buildings.find(b => b.pieceFile === 'config/pieces/general-store.json');
assert(building, 'town building must use the actual General Store house JSON');
const mounted = (store.wallFixtures || []).filter(f => f.authoredFurnitureKey === 'generalStoreSign');
assert.equal(mounted.length, 1, 'the actual General Store sign must be stored once in its house piece');
const f = mounted[0];
assert.equal(f.faceId, 1303, 'attach to the front wall containing the authored door');
assert(store.base.faces.some(face => face.id === f.faceId && face.tag === 'wall'));
assert.deepEqual(f.authoredAnchor, sign.wallOrnament.anchor, 'keep the actual authored +X beam mounting face');
assert.deepEqual(f.authoredScale, [.393, .563, .557], 'keep the recent in-game nonuniform sign scale');
assert.equal(f.sourceTownPlacement.rotY, 90);
assert.equal(sign.repoFurniture.placementConfig, 'docs/config/pieces/general-store.json (wallFixtures; face 1303)');
assert(read('docs/js/HousePieceGen.js').includes('HouseWallFixtures.createGroup'),
  'the in-game building generator must instantiate authored wall fixtures');
const fixtureRuntime=read('docs/js/house-wall-fixtures.js');
assert(fixtureRuntime.includes('authored.buildGroup') && fixtureRuntime.includes('authored.load(key)'),
  'mounted signs must build from the real authored furniture recipe, including its existing decals');
const houseEditor=read('docs/tools/house-piece-author/house-wall-fixture-editor.js');
assert(houseEditor.includes('generalStoreSign') && houseEditor.includes('hwfSourceSX'),
  'House Editor must display/select the authored sign and preserve its nonuniform scaling');

const epsilon = (actual, expected, label, tol = 1e-6) =>
  assert(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}, got ${actual}`);
const face = store.base.faces.find(wall => wall.id === f.faceId);
const point = (u,v) => [0,1,2].map(i =>
  (1-v)*((1-u)*face.v[0][i]+u*face.v[3][i])
  +v*((1-u)*face.v[1][i]+u*face.v[2][i]));
const anchor = point(f.u,f.v);anchor[2] += f.depth; // south-facing front-wall horizontal normal +Z
const rootPosition = [
  anchor[0],anchor[1] - f.authoredAnchor[1]*f.authoredScale[1],
  anchor[2] + f.bodyOutset + f.authoredAnchor[0]*f.authoredScale[0], // body moves outward, beam end remains at anchor
];
const minX = Math.min(...store.footprint.cells.map(c => c.x));
const minZ = Math.min(...store.footprint.cells.map(c => c.y));
const gc = Math.floor(store.gridSize/2);
const offX = building.gridX + gc - minX, offZ = building.gridZ + gc - minZ;
const latest = f.sourceTownPlacement;
const originalRoot = [
  latest.col + .5 + latest.postX,
  latest.postY,
  latest.row + .5 + latest.postZ
];
epsilon(rootPosition[0] + offX, originalRoot[0], 'world sign X');
epsilon(rootPosition[1], originalRoot[1], 'world sign Y relative to building base');
epsilon(rootPosition[2] + offZ, originalRoot[2], 'world sign Z');
const doorWorldX = building.gridX + store.footprint.door.x - minX + .5;
epsilon(rootPosition[0] + offX - doorWorldX, .457, 'door-relative sign X');
epsilon(anchor[1], 1.365688, 'sign beam end height above door');
epsilon(f.depth, 0, 'fixed wall anchor clearance');
epsilon(f.bodyOutset, .38314742857, 'furniture moves while beam extends to wall');
assert(!store.assets.some(a => a.name === 'General Store Sign'), 'must not double-spawn a generic asset alongside wall fixture');


// The retired hardcoded system must actually be gone, not left as dead
// weight alongside the new decor entries (which would double-render).
assert(!fs.existsSync(path.join(root, 'docs/config/town-sign-furniture-config.js')), 'town-sign-furniture-config.js should be removed now the signs are workspace decor');
assert(!fs.existsSync(path.join(root, 'docs/js/town-sign-furniture-runtime.js')), 'town-sign-furniture-runtime.js should be removed now the signs are workspace decor');
const zoneLoader = read('docs/js/zone-den-totem-features.js');
assert(!zoneLoader.includes('TownSignFurnitureRuntime'), 'zone-den-totem-features.js must no longer load the retired town sign runtime');
assert(!zoneLoader.includes('HOBUNJI_TOWN_SIGN_FURNITURE_CONFIG'), 'zone-den-totem-features.js must no longer load the retired town sign config');
assert(zoneLoader.includes("ensureCompanionScript('FurnitureDecalRuntime', 'furniture-decal-runtime.js?v="), 'FurnitureDecalRuntime (unrelated to the retired sign system) must still load');

console.log('town sign furniture checks passed');
