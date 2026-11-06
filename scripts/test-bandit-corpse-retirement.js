#!/usr/bin/env node
'use strict';

// Settled bandit corpses keep a full humanoid rig for the whole session (they
// cannot stream to data like wildlife corpses do), so a fight leaves a cost that
// never goes away. js/bandit-corpse-retirement.js swaps the rig of old, un-looted
// bodies for one flat marker. This runs the real module against fake corpses,
// and runs the real disposeCreaturePresentation out of game.js on a retired body
// to prove looting/despawning one still works.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const moduleSource = read('docs/js/bandit-corpse-retirement.js');
const game = read('docs/game.js');
const indexHtml = read('docs/index.html');

// Just enough THREE for the marker: a tree of named groups with parents.
class Obj {
  constructor() { this.children = []; this.parent = null; this.name = ''; this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.rotation = { x: 0, y: 0, z: 0 }; }
  add(child) { child.parent = this; this.children.push(child); return this; }
  remove(child) { const at = this.children.indexOf(child); if (at >= 0) { this.children.splice(at, 1); child.parent = null; } return this; }
}
const THREE = { Group: class extends Obj {}, Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
  CircleGeometry: class { constructor() { THREE.created.geometry++; } rotateX() {} }, MeshBasicMaterial: class { constructor() { THREE.created.material++; } }, created: { geometry: 0, material: 0 } };

const TILE = 32;
function makeWorld(config) {
  THREE.created.geometry = 0; THREE.created.material = 0;
  const scene = new Obj(); scene.name = 'zone';
  const corpseObjects = new Set();
  const disposed = [];
  const player = { x: 0, y: 0 };
  const sandbox = { window: { THREE, SCRATCHBONES_CONFIG: config }, performance: { now: () => 0 } };
  vm.runInNewContext(moduleSource, sandbox);
  const mod = sandbox.window.BanditCorpseRetirement;
  const ctx = { scene, corpseObjects, disposed, player, area: 'map_a', mod };
  mod.init({
    corpseObjects, getPlayer: () => player, getTile: () => TILE, getCurrentArea: () => ctx.area, getDefaultScene: () => scene,
    disposeCreaturePresentation: c => { disposed.push(c.id); c.scene.remove(c.avatarRef.group); c.avatarRef.dispose(); }, // Same calls as the real one.
    tileSurfaceYInArea: () => 1.5,
  });
  ctx.corpse = (id, extra = {}) => {
    const group = new Obj(); group.name = 'rig_' + id; scene.add(group);
    const rigDisposed = { n: 0 };
    const c = { id, isBandit: true, state: 'corpse', health: 0, areaId: 'map_a', scene, areaGrid: [[{}, {}], [{}, {}]], x: 100 * TILE, y: 100 * TILE, def: { modelWidth: 1 },
      avatarRef: { group, dispose() { rigDisposed.n++; } }, groundShadow: { shadow: true }, rigDisposed, _corpseSettledAt: 0, ...extra };
    c.areaGrid = Array.from({ length: 200 }, () => Array.from({ length: 200 }, () => ({})));
    corpseObjects.add(c);
    return c;
  };
  return ctx;
}
const NOW = 60_000; // Well past minSettledS for corpses that settled at 0.

// 1. The newest keepFull bodies keep their rigs; older, distant ones are swapped, a few per run.
{
  const w = makeWorld();
  const bodies = Array.from({ length: 12 }, (_, i) => w.corpse('b' + i, { _corpseSettledAt: i * 1000 })); // b11 is newest.
  const first = w.mod.tick(NOW);
  assert.equal(first, 3, 'perTick caps the swaps in one run');
  assert.deepEqual(w.disposed, ['b0', 'b1', 'b2'], 'oldest bodies go first');
  assert.equal(bodies[0].avatarRef.isCorpseMarker, true);
  assert.equal(bodies[0].avatarRef.group.name, 'bandit_corpse_marker');
  assert.equal(bodies[0].groundShadow, null, 'rig shadow released');
  assert.equal(bodies[0]._banditCorpseRetired, true);
  assert.ok(w.scene.children.includes(bodies[0].avatarRef.group), 'marker was added to the body\'s scene');
  assert.equal(bodies[0].rigDisposed.n, 1, 'the real rig is disposed once, by the shared owner');
  assert.equal(w.mod.tick(NOW + 100), 0, 'throttled between runs');
  let total = first;
  for (let t = 1; t < 10; t++) total += w.mod.tick(NOW + t * 2000);
  assert.equal(total, 6, '12 bodies - 6 kept = 6 swapped, then it stops');
  for (let i = 6; i < 12; i++) assert.equal(bodies[i]._banditCorpseRetired, undefined, 'newest ' + i + ' keep their rigs');
  assert.equal(THREE.created.geometry, 1, 'one shared marker geometry');
  assert.equal(THREE.created.material, 1, 'one shared marker material');
}

// 2. Bodies that must stay intact are never swapped.
{
  const w = makeWorld({ game: { banditCorpseRetire: { keepFull: 0 } } });
  const keep = [
    w.corpse('revivable', { keepCorpseAfterLoot: true }), w.corpse('timed', { lootHoldSeconds: 3 }), w.corpse('looted', { corpseLooted: true }),
    w.corpse('wildlife', { isBandit: false }), w.corpse('dying', { state: 'dying' }), w.corpse('alive', { health: 5 }),
    w.corpse('elsewhere', { areaId: 'map_b' }), w.corpse('norig', { avatarRef: null }),
  ];
  const plain = w.corpse('plain');
  w.mod.tick(NOW);
  for (const c of keep) assert.equal(c._banditCorpseRetired, undefined, c.id + ' keeps its rig');
  assert.equal(plain._banditCorpseRetired, true, 'an ordinary old bandit corpse is swapped');
  assert.deepEqual(w.disposed, ['plain']);
}

// 3. Nearby and very recent bodies are left alone; they are swapped once they qualify.
{
  const w = makeWorld({ game: { banditCorpseRetire: { keepFull: 0 } } });
  const near = w.corpse('near'); near.x = (100 + 2) * TILE; w.player.x = 100 * TILE; w.player.y = 100 * TILE; near.y = 100 * TILE;
  const far = w.corpse('far'); far.x = (100 + 20) * TILE; far.y = 100 * TILE;
  const fresh = w.corpse('fresh', { _corpseSettledAt: NOW - 1000 }); fresh.x = (100 + 20) * TILE;
  w.mod.tick(NOW);
  assert.equal(near._banditCorpseRetired, undefined, 'within nearTiles of the player');
  assert.equal(fresh._banditCorpseRetired, undefined, 'settled less than minSettledS ago');
  assert.equal(far._banditCorpseRetired, true);
  w.player.x = 200 * TILE; // The player walks away.
  w.mod.tick(NOW + 5000);
  assert.equal(near._banditCorpseRetired, true, 'swapped once the player is far enough away');
  assert.equal(fresh._banditCorpseRetired, undefined, 'still only 6s old, so not yet');
  w.mod.tick(NOW + 14_000);
  assert.equal(fresh._banditCorpseRetired, true, 'swapped once it has settled long enough');
}

// 4. It can be turned off, and a corpse first seen by the module is timestamped, not swapped instantly.
{
  const off = makeWorld({ game: { banditCorpseRetire: { enabled: false, keepFull: 0 } } });
  const c = off.corpse('x'); assert.equal(off.mod.tick(NOW), 0); assert.equal(c._banditCorpseRetired, undefined);
  const w = makeWorld({ game: { banditCorpseRetire: { keepFull: 0 } } });
  const fresh = w.corpse('fresh', { _corpseSettledAt: undefined }); delete fresh._corpseSettledAt;
  w.mod.tick(5000);
  assert.equal(fresh._banditCorpseRetired, undefined, 'a body first seen now has not lain still for minSettledS yet');
  assert.equal(fresh._corpseSettledAt, 5000);
  w.mod.tick(5000 + 13_000);
  assert.equal(fresh._banditCorpseRetired, true);
}

// 5. A retired body despawns through the real disposeCreaturePresentation (what looting calls via despawnCreature).
{
  const start = game.indexOf('function disposeCreaturePresentation(c) {'), end = game.indexOf('function disposeBanditWeaponHolder(holder)', start);
  assert.ok(start >= 0 && end > start, 'found disposeCreaturePresentation in game.js');
  const w = makeWorld({ game: { banditCorpseRetire: { keepFull: 0 } } });
  const holderCalls = [];
  const ctx = vm.createContext({ window: { ResourceRings: { disposeRingHud: c => holderCalls.push('ring:' + c.id) } }, scene: w.scene, disposeBanditWeaponHolder: h => holderCalls.push(h) });
  vm.runInContext(game.slice(start, end), ctx);
  const c = w.corpse('looted-later', { _banditToolHolder: null, _banditRangedToolHolder: null, _banditFlaskToolHolder: null, _banditTrailMesh: null });
  w.mod.tick(NOW);
  assert.equal(c._banditCorpseRetired, true);
  const marker = c.avatarRef.group;
  assert.ok(w.scene.children.includes(marker));
  ctx.disposeCreaturePresentation(c); // Looting: corpseObjects.delete(c); despawnCreature(c) -> this.
  assert.ok(!w.scene.children.includes(marker), 'the marker leaves the scene when the body is looted');
  assert.deepEqual(holderCalls, [null, null, 'ring:looted-later'], 'no weapon holders or shadow left to trip over');
}

// 6. Wired in: loaded before game.js, initialised and ticked by game.js.
{
  const tag = indexHtml.search(/<script src="js\/bandit-corpse-retirement\.js\?v=[A-Za-z0-9_-]+"><\/script>/);
  const gameTag = indexHtml.search(/<script src="game\.js(\?v=[A-Za-z0-9_-]+)?"/);
  assert.ok(tag >= 0, 'index.html loads the module');
  assert.ok(gameTag < 0 || tag < gameTag, 'and loads it before game.js');
  assert.match(game, /window\.BanditCorpseRetirement\.init\(\{/, 'game.js initialises it');
  assert.match(game, /window\.BanditCorpseRetirement\.tick\(/, 'game.js ticks it');
}

console.log('bandit corpse retirement: ok');
