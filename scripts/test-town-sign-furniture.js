const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));

function checkSign(relative, key, textureName) {
  const data = json(relative); // Authored runtime record checked for editable sign geometry and decals.
  assert.equal(data.key, key);
  assert.equal(data.schema, 'hobunji_furniture_authored_runtime.v1');
  assert.deepEqual(data.footprint, { w: 1, d: 1 });
  assert.equal(data.tileBase?.footprintW, 1);
  assert.equal(data.tileBase?.footprintD, 1);
  assert.equal(data.repoFurniture?.uniformScaleFromOriginal, 0.8);

  const parts = new Map(data.parts.map(part => [part.id, part])); // Stable part ids used to compare beam, board, and support geometry.
  const beam = parts.get('hanging_sign_post')?.transform;
  const board = parts.get('hanging_sign_board')?.transform;
  const post = parts.get('hanging_sign_support_post')?.transform;
  assert(beam && board && post, `${key}: beam, board, and support post must all exist`);

  const beamMin = beam.x - beam.sx / 2;
  const beamMax = beam.x + beam.sx / 2;
  const boardMin = board.x - board.sx / 2;
  const boardMax = board.x + board.sx / 2;
  const negativeOverhang = boardMin - beamMin; // Beam length beyond the hanging board on local -X.
  const positiveOverhang = beamMax - boardMax; // Beam length beyond the hanging board on local +X.
  assert(positiveOverhang > negativeOverhang, `${key}: +X must remain the longer beam overhang`);
  assert(post.x > 0, `${key}: support post must stay on the longer +X side`);
  assert(Math.abs((post.y + post.sy / 2) - (beam.y - beam.sy / 2)) < 1e-9, `${key}: post top must meet beam underside`);
  assert(beamMin >= -0.5 - 1e-9 && beamMax <= 0.5 + 1e-9, `${key}: horizontal beam must fit within one tile`);
  assert(Math.abs(beam.sx - 1) < 1e-9, `${key}: scaled beam should span exactly one tile`);

  assert.equal(data.decals.length, 2, `${key}: both board faces need decals`);
  assert.deepEqual(new Set(data.decals.map(decal => decal.surfaceId)), new Set([
    'hanging_sign_board:surface:4',
    'hanging_sign_board:surface:8',
  ]));
  for (const decal of data.decals) {
    assert.equal(decal.width, 0.75);
    assert.equal(decal.height, 0.8);
    assert.equal(decal.opacity, 0.7);
    assert.equal(decal.normalOffset, 0.003);
    assert(decal.imageName.endsWith(textureName), `${key}: wrong decal texture`);
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

checkSign('docs/config/furniture-authored/generalStoreSign.json', 'generalStoreSign', 'general_store_sign_text.png');
checkSign('docs/config/furniture-authored/innSign.json', 'innSign', 'inn_sign_text.png');

// The two business signs are ordinary town decor now (see docs/game.js's
// DECORATIVE_FURNITURE_DEFS and the Map Editor's DECOR catalog) rather than
// the old hardcoded town-sign-furniture-config.js/-runtime.js placements —
// that system has been retired so the signs are visible, selectable, and
// editable through the same Map Editor + in-game click-to-select pipeline
// as every other decor piece.
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
const generalStore = decorByKey.get('generalStoreSign');
const inn = decorByKey.get('innSign');
assert(generalStore, 'map_hobunji_town must place a generalStoreSign decor entry');
assert(inn, 'map_hobunji_town must place an innSign decor entry');
assert.equal(generalStore.rotY, 90, 'generalStoreSign must rotate its +X support side toward north');
assert.equal(inn.rotY, 90, 'innSign must rotate its +X support side toward north');

// The retired hardcoded system must actually be gone, not left as dead
// weight alongside the new decor entries (which would double-render).
assert(!fs.existsSync(path.join(root, 'docs/config/town-sign-furniture-config.js')), 'town-sign-furniture-config.js should be removed now the signs are workspace decor');
assert(!fs.existsSync(path.join(root, 'docs/js/town-sign-furniture-runtime.js')), 'town-sign-furniture-runtime.js should be removed now the signs are workspace decor');
const zoneLoader = read('docs/js/zone-den-totem-features.js');
assert(!zoneLoader.includes('TownSignFurnitureRuntime'), 'zone-den-totem-features.js must no longer load the retired town sign runtime');
assert(!zoneLoader.includes('HOBUNJI_TOWN_SIGN_FURNITURE_CONFIG'), 'zone-den-totem-features.js must no longer load the retired town sign config');
assert(zoneLoader.includes("ensureCompanionScript('FurnitureDecalRuntime', 'furniture-decal-runtime.js')"), 'FurnitureDecalRuntime (unrelated to the retired sign system) must still load');

console.log('town sign furniture checks passed');
