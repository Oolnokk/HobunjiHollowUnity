'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const config = JSON.parse(read('docs/config/harlyao-night-march.json'));
const runtimeSource = read('docs/js/harlyao-night-march-runtime.js');
const beaconSource = read('docs/js/harlyao-night-march-beacon.js');
const probeSource = read('docs/js/harlyao-night-march-pixel-probe.js');

assert.match(runtimeSource, /hide\(c\); \/\/ A partially built army must never wake\/march before all async portrait builds finish\./,
  'new Harlyao entities stay dormant while the async formation is incomplete');
assert.match(runtimeSource, /if \(buildPromise\) return; \/\/ Critical: never wake a partially built async formation on the next frame\./,
  'the next game tick cannot wake a partial formation');
assert.match(runtimeSource, /wake\(s, targetChunk\); \/\/ First visibility uses the exact same terrain-aware placement path as every later wake\./,
  'first materialization and later cache wakes share one placement path');
assert.match(runtimeSource, /const targetChunk = \{ cx: chunk\.cx, cz: chunk\.cz/,
  'materialization keeps an immutable target chunk instead of using a leader-mutated live chunk as its abort gate');
assert.match(runtimeSource, /const liveGrid = deps\.getActiveGrid\?\.\(\)/,
  'terrain placement refreshes from the current live wilderness grid before sampling elevation');
assert.match(runtimeSource, /groundErrorY/,
  'runtime exports a mobile-visible rendered-feet versus terrain-elevation diagnostic');
assert.match(runtimeSource, /updateTicks/,
  'runtime exports a mobile-visible tick counter so a dead game-loop seam is distinguishable from a spawn failure');
assert.match(beaconSource, /march\?\.visible && march\?\.liveAnchor/,
  'visible beacon follows the actual formation centroid rather than only the chunk center');
assert.match(beaconSource, /centerSource = liveCenter \? 'formation-centroid' : 'chunk-center'/,
  'beacon diagnostics identify whether the locator is following live formation or hidden coarse state');
assert.match(probeSource, /build=\$\{buildText\}/,
  'Pixel Probe exposes async formation build progress without requiring devtools');
assert.match(probeSource, /groundErr=\$\{groundErr\}/,
  'Pixel Probe exposes vertical placement error without requiring devtools');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function makePosition() {
  return {
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const TILE = 64;
  const rows = 200;
  const cols = 200;
  const grid = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({ surfaceY: 2 + ((row + col) % 7) * 0.5 }))
  );
  const pendingBuilds = [];
  const created = [];
  let movementCalls = 0;

  const BanditCombat = {
    init() {},
    async loadGangConfig() { return {}; },
    makeEntity(_cfg, _rank, _tier, x, y, opts) {
      const gate = deferred(); // Each entity build is manually released so the test can inspect partial-build frames.
      pendingBuilds.push({ gate, x, y, opts });
      return gate.promise.then(() => {
        const col = Math.floor(x / TILE);
        const row = Math.floor(y / TILE);
        const surfaceY = grid[row][col].surfaceY;
        const group = {
          visible: true,
          position: makePosition(),
          parent: { remove() {} },
          traverse() {},
        };
        group.position.set(x / TILE, surfaceY + 0.5, y / TILE);
        const groundShadow = {
          visible: true,
          position: makePosition(),
          parent: { remove() {} },
          material: { opacity: 0.3, clone() { return { ...this, clone: this.clone }; }, dispose() {} },
          geometry: { dispose() {} },
        };
        groundShadow.position.set(x / TILE, surfaceY + 0.01, y / TILE);
        const tool = { visible: true, parent: { remove() {} } };
        const c = {
          id: `test_${created.length}`,
          def: { aggroRangePx: TILE * 6 },
          avatarRef: { group, dispose() {} },
          groundShadow,
          _banditToolHolder: tool,
          _banditRangedToolHolder: null,
          x, y, homeX: x, homeY: y,
          halfHeight: 0.5,
          health: 40, maxHealth: 40,
          areaGrid: grid, areaCols: cols, areaRows: rows,
          areaId: 'map_northern_cliffs',
          state: 'idle',
          vx: 0, vy: 0,
          ...opts.extra,
        };
        created.push(c);
        return c;
      });
    },
  };

  const BanditCamps = { updateCampBanners() {} };
  const context = {
    console,
    Date,
    setImmediate,
    performance: { now: () => 1234 },
    fetch: async () => ({ ok: true, json: async () => config }),
    window: {
      WildernessChunks: { constants: { CHUNK_TILES: 16 } },
      CalendarSystem: {
        getHour: () => 1,
        timeDebugSnapshot: () => ({ rawDay: 1 }),
      },
      Ghostify: {
        apply() {},
        restore() {},
        registerGlowSource: () => () => {},
      },
      BanditCombat,
      BanditCamps,
      requestAnimationFrame: callback => { callback(); return 1; },
      __farmLog() {},
    },
  };
  context.globalThis = context;

  vm.runInNewContext(runtimeSource, context, { filename: 'harlyao-night-march-runtime.js' });

  const armyChunk = context.window.HarlyaoNightMarch.__test.coarseStateFor(1, 1, config, { cols, rows });
  const player = {
    x: (armyChunk.cx * 16 + 7.5) * TILE,
    y: (armyChunk.cz * 16 + 7.5) * TILE,
  };
  const deps = {
    TILE,
    player,
    calendar: { day: 1 },
    EXTERIOR_ZONES: { map_northern_cliffs: { cols, rows } },
    getCurrentArea: () => 'map_northern_cliffs',
    getActiveGrid: () => grid,
    getActiveCols: () => cols,
    getActiveRows: () => rows,
    tileSurfaceYInArea: tile => tile.surfaceY,
    characterGroundShadowSurfaceOffset: () => 0.01,
    HELD_SHAPE_DEFS: {
      daggerSword: { dmgType: 'sharp' },
      hatchet: { dmgType: 'sharp' },
      fishingspear: { dmgType: 'sharp' },
    },
    craftedToolItemKey: (shape, metal) => `${shape}_${metal}`,
    hostileObjects: [],
    moveCreatureToward(c) {
      movementCalls++;
      c.x += 1; // Any pre-completion march would mutate the leader and make the race visible to this test.
      return true;
    },
  };

  context.window.BanditCombat.init(deps);
  await flush(); // Lets loadConfig finish.
  context.window.BanditCamps.updateCampBanners(1 / 60);
  await flush();

  assert.equal(pendingBuilds.length, 1, 'first materialization begins with one awaited portrait');
  pendingBuilds.shift().gate.resolve();
  await flush();
  assert.equal(context.window.HarlyaoNightMarch.debugSnapshot().membersCached, 1, 'first marcher can finish while the rest remain pending');
  assert.equal(context.window.HarlyaoNightMarch.debugSnapshot().visible, false, 'one finished marcher remains dormant');
  assert.equal(created[0].avatarRef.group.visible, false, 'partial marcher is hidden from the world');

  context.window.BanditCamps.updateCampBanners(1 / 60);
  assert.equal(movementCalls, 0, 'a frame arriving mid-build cannot march the partial formation');
  assert.equal(context.window.HarlyaoNightMarch.debugSnapshot().visible, false, 'mid-build update cannot wake partial members');

  while (context.window.HarlyaoNightMarch.debugSnapshot().membersCached < config.memberCount) {
    await flush();
    assert(pendingBuilds.length > 0, 'materialization should request the next portrait while the player stays in the beacon chunk');
    pendingBuilds.shift().gate.resolve();
    await flush();
  }
  await flush();

  const complete = context.window.HarlyaoNightMarch.debugSnapshot();
  assert.equal(complete.membersCached, config.memberCount, 'all authored Harlyao members finish before first visibility');
  assert.equal(complete.visible, true, 'complete army wakes immediately when construction finishes in the shared chunk');
  assert.equal(complete.wakes, 1, 'first spawn uses one unified wake/placement pass');
  assert(complete.liveAnchor, 'visible army exports an exact centroid for the locator');
  assert(Math.abs(complete.placement.groundErrorY) < 1e-9, 'rendered feet sit exactly on the sampled terrain surface');
  assert.equal(movementCalls, 0, 'no marching occurs until after the complete formation has become visible');

  for (const c of created) {
    assert.equal(c.areaId, 'map_northern_cliffs', 'every completed member is reactivated into the current zone');
    assert.equal(c.avatarRef.group.visible, true, 'every completed member becomes visible together');
    const tile = grid[Math.floor(c.y / TILE)][Math.floor(c.x / TILE)];
    const feetY = c.avatarRef.group.position.y - c.halfHeight;
    assert(Math.abs(feetY - tile.surfaceY) < 1e-9, 'each member samples elevation from the tile under its final formation slot');
  }

  context.window.BanditCamps.updateCampBanners(1 / 60);
  assert.equal(movementCalls, config.memberCount, 'normal marching begins on the next visible update after the complete spawn');

  console.log('Harlyao night march spawn/placement regression passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
