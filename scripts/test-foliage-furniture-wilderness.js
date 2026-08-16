#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative));
const json = relative => JSON.parse(read(relative).toString('utf8'));
const gitBlobSha = relative => {
  const body = read(relative);
  return crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
};

function checkAuthoredDefault(relative, expected) {
  const data = json(relative);
  assert.equal(data.key, expected.key);
  assert.deepEqual(data.footprint, expected.footprint);
  assert.equal(data.seatAnchors.length, expected.seats);
  assert.equal(data.parts.length, 1);
  assert.equal(data.parts[0].foliageSeatProxy, true);
  assert.equal(data.parts[0].surfaceOpacity, 0);
  assert.equal(data.foliageFurniture.defaultSeatNormalOffset, 0.01);
  assert.equal(data.foliageFurniture.sourceSha, gitBlobSha(data.foliageFurniture.sourcePath));
  const proxy = data.parts[0].transform;
  const expectedAnchorY = proxy.y + proxy.sy / 2 + 0.012 + 0.01;
  for (const anchor of data.seatAnchors) {
    assert.equal(anchor.normalOffset, 0.01);
    assert(Math.abs(anchor.position.y - expectedAnchorY) < 1e-9, `${data.key} anchor must resolve from proxy top + clearance + normal offset`);
  }
}

checkAuthoredDefault('docs/config/furniture-authored/chairstump.json', {
  key: 'chairstump', footprint: { w: 1, d: 1 }, seats: 1,
});
checkAuthoredDefault('docs/config/furniture-authored/benchlog.json', {
  key: 'benchlog', footprint: { w: 2, d: 1 }, seats: 2,
});

const editor = read('docs/tools/furniture-avatar-author/index.html').toString('utf8');
assert(editor.includes('const DEFAULT_SEAT_NORMAL_OFFSET = 0.01'));
assert(editor.includes('<label>Normal offset</label>'));
assert(!editor.includes('SEAT_ANCHOR_LOCAL_Y'));
assert(!/id="seatAnchorY"[^>]*readonly/.test(editor));
assert(editor.includes('<script src="foliage-furniture-mode.js?v=20260816a"></script>'));
const renderer = read('docs/js/foliage-furniture-renderer.js').toString('utf8');
assert(renderer.includes('opacity<=.001){mesh.visible=false'));

const generator = require(path.join(repoRoot, 'docs/js/wilderness-map-generator.js'));
const workspace = generator.generateWorkspace('foliage-furniture-test', {
  width: 48,
  height: 48,
  logs: 30,
  copses: 0,
  bushes: 0,
  fruitBushes: 0,
  mushrooms: 0,
  beehives: 0,
  ponds: 0,
  rivers: 0,
  plateaus: 0,
  caves: 0,
  structures: 0,
  animalDens: 0,
});
const generated = workspace.wildernessFoliageFurniture || [];
assert(generated.some(record => record.sourceObjectType === 'stump'));
assert(generated.some(record => record.sourceObjectType === 'fallenLog'));
for (const record of generated) {
  if (record.sourceObjectType === 'stump') {
    assert.equal(record.furnitureKey, 'chairstump');
    assert.deepEqual([record.footprintW, record.footprintD, record.yawDeg], [1, 1, 0]);
  } else {
    assert.equal(record.furnitureKey, 'benchlog');
    assert([[2, 1, 0], [1, 2, 90]].some(shape => shape.every((value, index) => value === [record.footprintW, record.footprintD, record.yawDeg][index])));
  }
  assert.equal(record.centerX, record.col + record.footprintW / 2);
  assert.equal(record.centerZ, record.row + record.footprintD / 2);
}

const builtByKey = {
  chairstump: json('docs/config/furniture-authored/chairstump.json'),
  benchlog: json('docs/config/furniture-authored/benchlog.json'),
};
global.FoliageFurnitureRenderer = {
  async buildInstance(record) {
    return { instance: { id: record.id }, data: builtByKey[record.furnitureKey] };
  },
};
const runtime = require(path.join(repoRoot, 'docs/js/foliage-furniture-runtime.js'));
assert.equal(runtime.DEFAULT_SEAT_NORMAL_OFFSET, 0.01);
assert.equal(runtime.furnitureKeyForGeneratedKind('stump'), 'chairstump');
assert.equal(runtime.furnitureKeyForGeneratedKind('fallenLog'), 'benchlog');

const testRecords = [
  { id: 'stump_1', sourceObjectType: 'stump', furnitureKey: 'chairstump', col: 4, row: 5, footprintW: 1, footprintD: 1, centerX: 4.5, centerZ: 5.5, yawDeg: 0, elevTier: 0 },
  { id: 'log_1', sourceObjectType: 'fallenLog', furnitureKey: 'benchlog', col: 8, row: 9, footprintW: 1, footprintD: 2, centerX: 8.5, centerZ: 10, yawDeg: 90, elevTier: 1 },
];
const scenes = new Map([['map_test', { scene: { added: [], add(instance) { this.added.push(instance); } } }]]);
const layouts = new Map([['map_test', { wildernessFoliageFurniture: testRecords }]]);
const tracked = new Map();
const sitCalls = [];
runtime.init({
  zoneLayouts: layouts,
  zoneScenes: scenes,
  zoneDecorFurnitureGroups: tracked,
  sit: (...args) => { sitCalls.push(args); return { ok: true }; },
  debugLog() {},
});

(async () => {
  const built = await runtime.spawnForMap('map_test');
  assert.equal(built.length, 2);
  assert.equal(scenes.get('map_test').scene.added.length, 2);
  assert.equal(tracked.get('map_test').length, 2);
  assert(runtime.blocksPoint('map_test', 4.5, 5.5));
  assert(runtime.blocksPoint('map_test', 8.5, 10.5));
  assert(!runtime.blocksPoint('map_test', 7.5, 10.5));
  const logObject = runtime.objectAt('map_test', 8, 10);
  assert(logObject?.foliageFurniture);
  assert.equal(logObject.getButtons().length, 2);
  assert.deepEqual(logObject.onAction('obj_foliage_sit_1'), { ok: true });
  assert.equal(sitCalls.length, 1);
  assert.deepEqual(runtime.debugState('map_test')[0], {
    mapId: 'map_test', recordCount: 2, interactionTileCount: 3, instanceCount: 2, status: 'ready', error: null,
  });
  runtime.disposeMap('map_test');
  assert.equal(runtime.objectAt('map_test', 8, 10), null);

  const game = read('docs/game.js').toString('utf8');
  assert(game.includes('window.FoliageFurnitureRuntime?.init({'));
  assert(game.includes('window.FoliageFurnitureRuntime?.spawnForMap(mapId);'));
  assert(game.includes('window.FoliageFurnitureRuntime?.disposeMap(mapId);'));
  assert(game.includes('window.FoliageFurnitureRuntime?.objectAt(currentArea, col, row)'));
  assert(game.includes('window.FoliageFurnitureRuntime?.blocksPoint(area, x, z)'));
  assert(game.includes('wildernessFoliageFurniture: workspace.wildernessFoliageFurniture || []'));
  assert.match(game, /const seatSurfaceY = activeSurfaceYAtWorld\(seat\.x, seat\.z\);[\s\S]{0,300}const seatAbsoluteWorldY = seatSurfaceY \+ seat\.y;/);
  assert.match(game, /activeCameraTarget = \{ position: new THREE\.Vector3\(seat\.x, seatAbsoluteWorldY \+ 0\.15, seat\.z\) \};/);
  assert.match(game, /seatWorldY: seat\.y,[\s\S]{0,100}seatSurfaceY,[\s\S]{0,100}seatAbsoluteWorldY,/);
  const pixelProbe = read('docs/js/pixel-probe.js').toString('utf8');
  assert(pixelProbe.includes('localHeight=${localSeatY.toFixed(5)} surfaceY=${surfaceSeatY.toFixed(5)} absoluteY=${absoluteSeatY.toFixed(5)}'));

  console.log(`foliage furniture wilderness checks passed (${generated.length} generated records)`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
