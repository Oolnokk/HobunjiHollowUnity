'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8');
const start = source.indexOf('  function queueBenchLogMesh(');
const end = source.indexOf('  function ensureCurrentCampMeshes(', start);
let now = 0, builds = 0, warnings = 0, rejectBuild;
const zone = { scene: { add(mesh) { mesh.parent = this; } } };
const context = {
  Promise, Math, performance: { now: () => now }, buildGeneration: 1, BENCHLOG_KEY: 'benchlog',
  currentArea: () => 'slope', combatDeps: { zoneScenes: new Map([['slope', zone]]) },
  benchRecordForProp: () => ({ centerX: 1, centerZ: 2 }), registerCampBenchStations() {},
  disposeObject3D() {}, markOutline() {}, num: (v, fallback) => v ?? fallback,
  window: { __farmLog() { warnings++; }, FoliageFurnitureRenderer: {
    buildInstance() { builds++; return new Promise((resolve, reject) => { rejectBuild = reject; }); },
  } },
};
vm.runInNewContext(source.slice(start, end) + '\nthis.ensure = ensureCampMeshes;', context);
const camp = { zoneId: 'slope', props: [{ id: 'log', key: 'benchlog', x: 0, y: 0 }], propMeshes: new Map() };
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  context.ensure(camp); await flush();
  assert.equal(builds, 1);
  for (let i = 0; i < 30; i++) context.ensure(camp);
  assert.equal(builds, 1, 'pending work is deduplicated');
  rejectBuild(new Error('Could not load benchlog.')); await flush();
  for (now = 0; now < 2000; now += 200) context.ensure(camp);
  await flush();
  assert.equal(builds, 1, 'failure does not retry on every 5 Hz camp update');
  assert.equal(warnings, 1);
  context.ensure(camp); await flush();
  assert.equal(builds, 2);
  rejectBuild(new Error('still unavailable')); await flush();
  assert.equal(camp.propMeshes.get('log').retryAtMs, 6000, 'second failure doubles the delay');
  now = 6000; context.ensure(camp); await flush();
  const replacement = { pending: true, marker: 'new generation' };
  camp.propMeshes.set('log', replacement);
  rejectBuild(new Error('stale request')); await flush();
  assert.equal(camp.propMeshes.get('log'), replacement, 'old failure cannot mutate a replacement');
  assert.equal(warnings, 2);
  context.window.FoliageFurnitureRenderer.buildInstance = () => { throw new Error('sync failure'); };
  camp.propMeshes.clear(); context.ensure(camp); await flush();
  assert.equal(camp.propMeshes.get('log').pending, false, 'synchronous failure also enters backoff');

  const game = fs.readFileSync('docs/game.js', 'utf8');
  const a = game.indexOf('      function playerMovementDebugSnapshot()');
  const b = game.indexOf('      async function copyDebugLog()', a);
  const player = { footing: NaN, maxFooting: 100, prone: true, somersaultRecovering: true, staggered: { active: true, endsAt: 12 } };
  const lock = { owner: 'drink', participants: [{ id: 'player', channels: ['movement'] }] };
  const reportContext = {
    window: { CharacterActionLocks: { getDebug: () => [lock, { participants: [{ id: 'npc' }] }] }, Combat: { getMovementSpeedMul: () => 0 } },
    player, input: { x: 1, y: 0 }, getKeyboardVector: () => ({ x: 0, y: 0, active: false }),
    PLAYER_ACTION_LOCK_ID: 'player', proneRecoveryFootingTarget: () => 100, currentArea: 'slope', paused: false, dialogueOpen: false, sitInteraction: null,
  };
  vm.runInNewContext(game.slice(a, b), reportContext);
  const snapshot = reportContext.window.__playerMovementDebugSnapshot();
  assert.equal(snapshot.combat.footingFinite, false);
  assert.equal(snapshot.combat.speedMul, 0);
  assert.equal(snapshot.combat.recovering, true);
  assert.equal(snapshot.movementLocks.length, 1);
  assert.equal(snapshot.input.x, 1);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.equal(player.prone, true, 'reporting cannot clear legitimate combat state');
  console.log('combat freeze diagnostics and camp retry backoff passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
