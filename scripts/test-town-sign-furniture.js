const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));

function checkSign(relative, key, textureName) {
  const data = json(relative); // Authored runtime record checked for editable sign geometry and decals.
  assert.equal(data.key, key);
  assert.equal(data.schema, 'hobunji_furniture_authored_runtime.v1');
  assert.deepEqual(data.footprint, { w: 2, d: 1 });

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
}

checkSign('docs/config/furniture-authored/generalStoreSign.json', 'generalStoreSign', 'general_store_sign_text.png');
checkSign('docs/config/furniture-authored/innSign.json', 'innSign', 'inn_sign_text.png');

const configContext = { window: {} }; // Isolated browser-like global used to read the editable placement config without booting the game.
vm.runInNewContext(read('docs/config/town-sign-furniture-config.js'), configContext);
const placements = configContext.window.HOBUNJI_TOWN_SIGN_FURNITURE_CONFIG?.placements || [];
assert.equal(placements.length, 2);
for (const placement of placements) {
  const distance = Math.abs(placement.col - placement.entrance.col) + Math.abs(placement.row - placement.entrance.row); // Exact tile distance from the associated entrance.
  assert.equal(distance, 2, `${placement.id}: sign must remain two tiles from its entrance`);
  assert.equal(placement.rotYDeg, 90, `${placement.id}: +X support side must rotate toward north`);
  assert.equal(placement.localPostAxis, '+X');
  assert.equal(placement.postAim, 'north');
}

const zoneLoader = read('docs/js/zone-den-totem-features.js'); // Boot wiring must load all three sign/decal companions before furniture builds.
assert(zoneLoader.includes("ensureCompanionScript('FurnitureDecalRuntime', 'furniture-decal-runtime.js')"));
assert(zoneLoader.includes("ensureCompanionScript('HOBUNJI_TOWN_SIGN_FURNITURE_CONFIG', '../config/town-sign-furniture-config.js')"));
assert(zoneLoader.includes("ensureCompanionScript('TownSignFurnitureRuntime', 'town-sign-furniture-runtime.js')"));

console.log('town sign furniture checks passed');
