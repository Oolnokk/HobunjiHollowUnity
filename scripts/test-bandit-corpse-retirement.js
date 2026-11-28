#!/usr/bin/env node
'use strict';

// Settled humanoid and wildlife corpses keep expensive rigs unless retired.
// This tests the new immediate, depth-correct static presentation policy, and
// legacy configuration overrides used by older games. The module replaces
// a rig with a marker while preserving the original corpse data and loot.
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
  CircleGeometry: class { constructor() { THREE.created.geometry++; } rotateX() {} },
  PlaneGeometry: class { constructor(width, height) { this.parameters = { width, height }; THREE.created.geometry++; } rotateX() {} dispose() { this.disposed = true; } },
  CanvasTexture: class { constructor(image) { this.image = image; this.repeat = { x: 1, y: 1 }; this.offset = { x: 0, y: 0 }; } dispose() { this.disposed = true; } },
  MeshBasicMaterial: class { constructor(options = {}) { Object.assign(this, options); THREE.created.material++; } dispose() { this.disposed = true; } },
  SRGBColorSpace: 'srgb', RepeatWrapping: 'repeat', DoubleSide: 2, NearestFilter: 'nearest', LinearFilter: 'linear',
  created: { geometry: 0, material: 0 } };

const TILE = 32;
function makeWorld(config, { farRule = false, productionDefaults = false, useCanvas = false, failPantsCapture = false, portraitFlip = false } = {}) {
  const legacyPolicy = { keepFull: 6, nearTiles: 5, farTiles: farRule ? 24 : 0, minSettledS: 12, perTick: 3, intervalMs: 1000 }; // Exercises unchanged backwards-compatible overrides in tests 1-7.
  if (!productionDefaults) config = { ...(config || {}), game: { ...(config?.game || {}), banditCorpseRetire: { ...legacyPolicy, ...(config?.game?.banditCorpseRetire || {}) } } };
  THREE.created.geometry = 0; THREE.created.material = 0;
  const scene = new Obj(); scene.name = 'zone';
  const corpseObjects = new Set();
  const disposed = [];
  const player = { x: 0, y: 0 };
  const flameEvents = []; // Verifies that fire presenter ownership follows a retired corpse's replacement root.
  const captures = []; // Tracks the composed portrait image copied before the expensive rig is released.
  const pantsCaptures = []; // Confirms final cloth painting occurs while the original pose and texture still exist.
  const fakeDocument = useCanvas ? { createElement(type) {
    assert.equal(type, 'canvas');
    return { width: 0, height: 0, getContext(kind) { assert.equal(kind, '2d'); return { drawImage(source) { captures.push(source); } }; } };
  } } : null; // Opt-in canvas stub tests the actual single-plane path without a browser.
  const sandbox = { ...(fakeDocument ? { document: fakeDocument } : {}), window: { THREE, SCRATCHBONES_CONFIG: config,
    PNGPlaneAvatar: { getPortraitsFlipped: () => portraitFlip }, // Tests both persisted portrait orientation settings.
    BurningAfflictionVfx: { disposeEntity: c => flameEvents.push('dispose:' + c.id), syncEntity: (c, root) => flameEvents.push('sync:' + c.id + ':' + root.name) },
    CorpsePosedPantsSnapshot: { capture: (canvas, rig) => {
      pantsCaptures.push({ canvas, rig, attachedWhenCaptured: !!rig.group.parent });
      return failPantsCapture ? { ok: false, reason: 'texture-pending' } : { ok: true, triangles: 392, segments: 14 };
    } },
  }, performance: { now: () => 0 } };
  vm.runInNewContext(moduleSource, sandbox);
  const mod = sandbox.window.BanditCorpseRetirement;
  const ctx = { scene, corpseObjects, disposed, flameEvents, captures, pantsCaptures, player, area: 'map_a', mod };
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
    w.corpse('companion', { isBandit: false, isCompanion: true }), w.corpse('dying', { state: 'dying' }), w.corpse('alive', { health: 5 }),
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

// 7. Distance rule: a settled body past farTiles is swapped even inside the newest keepFull, a nearer one is not.
{
  const w = makeWorld(undefined, { farRule: true });
  assert.equal(w.mod.config().farTiles, 24, 'default far distance matches the Porakaneki release radius');
  const far = w.corpse('far', { x: 30 * TILE, y: 0, _corpseSettledAt: 0 }); // Settled long ago.
  const mid = w.corpse('mid', { x: 20 * TILE, y: 0, _corpseSettledAt: 0 });
  const fresh = w.corpse('fresh', { x: 40 * TILE, y: 0, _corpseSettledAt: NOW + 1500 }); // Settled a moment before the tick: protected by minSettledS.
  assert.equal(w.mod.tick(NOW + 2000), 1, 'one body is far enough and settled enough');
  assert.equal(far._banditCorpseRetired, true, 'a far body goes to a flat marker although only 3 bodies exist (< keepFull)');
  assert.equal(mid._banditCorpseRetired, undefined, 'a body inside farTiles keeps its rig while under the keepFull cap');
  assert.equal(fresh._banditCorpseRetired, undefined, 'a just-settled body is never swapped');
  w.player.x = 35 * TILE; // Walk toward the far body: retired markers stay, the rest keep their rigs.
  assert.equal(w.mod.tick(NOW + 4000), 0);
  w.player.x = -30 * TILE; // Now 50 tiles from mid.
  assert.equal(w.mod.tick(NOW + 6000), 1);
  assert.equal(mid._banditCorpseRetired, true);
  const looted = makeWorld(undefined, { farRule: true });
  const lootedBody = looted.corpse('looted', { x: 90 * TILE, y: 0, corpseLooted: true, _corpseSettledAt: 0 });
  assert.equal(looted.mod.tick(NOW), 0, 'looted and revivable bodies are still excluded');
  const off = makeWorld({ game: { banditCorpseRetire: { farTiles: 0 } } }, { farRule: true });
  off.corpse('off', { x: 90 * TILE, y: 0, _corpseSettledAt: 0 });
  assert.equal(off.mod.tick(NOW), 0, 'farTiles: 0 disables the distance rule');
}


// 8. Production defaults: wildlife and bandits retire together, even right next
// to the player, in bounded batches immediately after the death animation.
{
  const w = makeWorld(undefined, { productionDefaults: true });
  assert.equal(w.mod.config().keepFull, 0);
  assert.equal(w.mod.config().nearTiles, 0);
  assert.equal(w.mod.config().minSettledS, 0);
  assert.ok(w.mod.config().intervalMs <= 100);
  w.player.x = 100 * TILE; w.player.y = 100 * TILE;
  const bandit = w.corpse('bandit');
  const animal = w.corpse('animal', { isBandit: false, streamVisuals: true, _wildlifeVisualLodHidden: true, _wildlifeDormantSinceMs: 5000 });
  const additional = [w.corpse('a2', { isBandit: false }), w.corpse('b2'), w.corpse('b3')];
  const protectedBodies = [
    w.corpse('companion', { isBandit: false, isCompanion: true }),
    w.corpse('revivable', { keepCorpseAfterLoot: true }),
    w.corpse('timed-search', { lootHoldSeconds: 3 }),
    w.corpse('amphibious', { isBandit: false, isAmphibiousFishCorpse: true }),
    w.corpse('still-falling', { state: 'dying' }),
  ];
  assert.equal(w.mod.tick(NOW), 4, 'only four heavy rigs may be disposed in one batch');
  assert.equal(w.mod.tick(NOW + 20), 0, 'same batch is not repeated on every frame');
  assert.equal(w.mod.tick(NOW + 100), 1, 'remaining ordinary corpse is retired in the next batch');
  assert.equal(bandit.avatarRef.isCorpseMarker, true);
  assert.equal(animal.avatarRef.isCorpseMarker, true, 'wildlife uses the same settled policy');
  assert.equal(animal.avatarRef.group.name, 'wildlife_corpse_marker');
  assert.equal(animal.avatarRef.group.userData.corpseNoSecondaryPasses, true);
  assert.equal(animal.avatarRef.group.children[0].userData.noOutline, true);
  assert.equal(animal._corpseVisualRetired, true);
  assert.equal(animal._wildlifeVisualLodHidden, false, 'old wildlife hidden flag is cleared');
  assert.equal(animal._wildlifeDormantSinceMs, null, 'old stream timer is cleared');
  assert.equal(w.mod.stats.wildlifeRetired, 2);
  assert.ok(w.flameEvents.includes('dispose:animal'), 'old flame presenter removed with rig');
  assert.ok(w.flameEvents.includes('sync:animal:wildlife_corpse_marker'), 'corpse flame reattached to static root');
  for (const body of protectedBodies) assert.equal(body.avatarRef.isCorpseMarker, undefined, body.id + ' remains intact');
  for (const body of [bandit, animal, ...additional]) assert.equal(body.rigDisposed.n, 1, body.id + ' owns one rig teardown');
  assert.equal(w.corpseObjects.size, 10, 'retirement retains all loot-bearing entity records');
}

// 9. Retired wildlife is never streamed back into an animated actor.
// Likewise the exterior-score depth replay skips flat corpse art.
{
  const wildlife = read('docs/js/wildlife-visual-lod.js');
  const outlines = read('docs/js/outline-render-performance.js');
  assert.match(wildlife, /if \(c\?\.avatarRef\?\.isCorpseMarker\) return false/, 'wildlife streamer cannot rehydrate a marker');
  assert.match(outlines, /root\.userData\?\.corpseNoSecondaryPasses/, 'retired corpse does not join puzzle score actor mask');
}


// 10. Normal humanoid portraits become exactly one image-backed plane,
// preserving the composed portrait rather than selecting an eye or limb map.
{
  const w = makeWorld(undefined, { productionDefaults: true, useCanvas: true });
  const body = w.corpse('portrait-bandit');
  const composedPortrait = { width: 400, height: 600, authoredAppearance: 'dyed clothing, face and eyes' };
  body.avatarRef.frontCanvas = composedPortrait;
  body.avatarRef.frontPlane = new Obj();
  body.avatarRef.modelWidth = 1;
  body.avatarRef.modelHeight = 1.5;
  assert.equal(w.mod.tick(NOW), 1);
  assert.equal(w.captures.length, 1, 'portrait artwork copied exactly once');
  assert.equal(w.captures[0], composedPortrait, 'the canonical composed canvas is used');
  assert.equal(body.avatarRef.group.children.length, 1, 'retired corpse has only one visible mesh');
  const plane = body.avatarRef.group.children[0];
  assert(plane.geometry instanceof THREE.PlaneGeometry, 'the corpse uses a single textured plane');
  assert(plane.material.map instanceof THREE.CanvasTexture, 'its appearance has one independent texture');
  assert.equal(plane.material.depthTest, true, 'corpse obeys normal terrain depth');
  assert.equal(plane.material.depthWrite, true, 'corpse participates in world depth');
  assert.equal(w.mod.stats.portraitPlanes, 1, 'diagnostics differentiate real portraits from fallback art');
  assert.equal(w.mod.stats.fallbackMarkers, 0);
  const ownedTexture = plane.material.map;
  body.avatarRef.dispose();
  assert.equal(ownedTexture.disposed, true, 'looting disposes the independent portrait texture');
}

// 11. A final-pose pants bake runs before the entire character rig is disposed.
// The raw authoring art is not a valid replacement for already-skinned legs.
{
  const w = makeWorld(undefined, { productionDefaults: true, useCanvas: true });
  const body = w.corpse('posed-pants');
  body.avatarRef.frontCanvas = { width: 256, height: 256 };
  body.avatarRef.frontPlane = new Obj();
  body.avatarRef.legs = { pants: { ready: true } };
  const priorRig = body.avatarRef;
  assert.equal(w.mod.tick(NOW), 1);
  assert.equal(w.pantsCaptures.length, 1, 'finished pants are baked once per corpse');
  assert.equal(w.pantsCaptures[0].rig, priorRig, 'the original rig is sampled, not its static replacement');
  assert.equal(w.pantsCaptures[0].attachedWhenCaptured, true, 'the final skinned rig is still attached during capture');
  assert.equal(w.disposed.length, 1, 'the old rig is disposed after baking');
  assert.equal(body.avatarRef.group.children.length, 1, 'the result is still a single plane');
  assert.equal(w.mod.stats.posedPantsBaked, 1, 'mobile diagnostics count baked pants');
}

// 12. When the final pants canvas is unavailable, keep the actual rig and
// throttle retries rather than silently flattening a trouserless corpse.
{
  const w = makeWorld(undefined, { productionDefaults: true, useCanvas: true, failPantsCapture: true });
  const body = w.corpse('not-ready-pants');
  body.avatarRef.frontCanvas = { width: 256, height: 256 };
  body.avatarRef.frontPlane = new Obj();
  body.avatarRef.legs = { pants: { ready: false } };
  const originalRig = body.avatarRef;
  assert.equal(w.mod.tick(NOW), 0, 'failed pants bake does not retire an incomplete humanoid');
  assert.equal(body.avatarRef, originalRig, 'the original fully rigged corpse remains visible');
  assert.equal(w.disposed.length, 0, 'failed capture never destroys cloth textures');
  assert.equal(w.mod.stats.posedPantsDeferred, 1, 'mobile diagnostics expose delayed baking');
  assert.equal(w.pantsCaptures.length, 1);
  assert.equal(w.mod.isRetirable(body, w.area), false, 'an unsuccessful cloth bake is throttled');
  assert.equal(w.mod.tick(NOW + 200), 0);
  assert.equal(w.pantsCaptures.length, 1, 'no expensive repeated capture before retry');
}

// 13. Rendering four complicated pants rigs in a single 80ms batch would
// create a new spike. Budget one heavy corpse bake and keep pantless wildlife fast.
{
  const w = makeWorld(undefined, { productionDefaults: true, useCanvas: true });
  for (const id of ['pants-a', 'pants-b']) {
    const c = w.corpse(id);
    c.avatarRef.frontCanvas = { width: 200, height: 200 };
    c.avatarRef.frontPlane = new Obj();
    c.avatarRef.legs = { pants: { ready: true } };
  }
  w.corpse('ordinary-animal', { isBandit: false });
  assert.equal(w.mod.tick(NOW), 2, 'one posed humanoid and one ordinary wildlife corpse retire together');
  assert.equal(w.mod.stats.posedPantsBaked, 1);
  assert.equal(w.pantsCaptures.length, 1);
  assert.equal(w.mod.tick(NOW + 100), 1, 'second heavy pants bake runs on the following pass');
  assert.equal(w.pantsCaptures.length, 2);
  assert.equal(w.disposed.length, 3);
}

// 14. The normal portrait-mirror setting must survive flattening, and a
// lying sprite must follow the old rig's body axis and species height.
for (const portraitFlip of [false, true]) {
  const w = makeWorld(undefined, { productionDefaults: true, useCanvas: true, portraitFlip });
  const body = w.corpse('mirrored-bandit');
  body.avatarRef.frontCanvas = { width: 256, height: 256 };
  body.avatarRef.frontPlane = new Obj();
  body.avatarRef.modelWidth = 1;
  body.avatarRef.modelHeight = 1.5;
  body.avatarRef.group.scale.y = 1.6;
  body.avatarRef.group.scale.z = 1.35; // Width of the sideways front card before death.
  body.avatarRef.group.scale.x = 2.5; // Depth-only scaling must not enlarge the flattened portrait.
  assert.equal(w.mod.tick(NOW), 1);
  const flat = body.avatarRef.group.children[0];
  assert.equal(body.avatarRef.group.rotation.y, Math.PI / 2, 'fallback death heading lays the original +Y body axis along -X');
  assert.equal(flat.scale.z, 1.6, 'the authored species vertical scale follows the laid-down body axis');
  assert.equal(flat.scale.x, 1.35, 'width uses the original card-normal axis correctly, not the root depth axis');
  assert.equal(flat.material.map.repeat.x, portraitFlip ? -1 : 1, 'corpse image keeps the live front UV orientation');
  assert.equal(flat.material.map.offset.x, portraitFlip ? 1 : 0, 'mirroring samples the same source canvas');
  if (portraitFlip) assert.equal(flat.material.map.wrapS, THREE.RepeatWrapping);
}

// 15. Unloaded animal art is not irreversibly replaced with an anonymous
// silhouette. The real rig survives while its source texture loads.
{
  const w = makeWorld(undefined, { productionDefaults: true, useCanvas: true });
  const body = w.corpse('patterned-animal', { isBandit: false });
  body.avatarRef.frontPlane = new Obj(); // Present card, missing material/map.image.
  const originalRig = body.avatarRef;
  assert.equal(w.mod.tick(NOW), 0, 'missing image defers animal retirement');
  assert.equal(body.avatarRef, originalRig, 'appearance stays on its old rig');
  assert.equal(body.rigDisposed.n, 0, 'no texture or genotype materials are disposed');
  assert.equal(w.mod.stats.imagesDeferred, 1);
  assert.equal(w.mod.isRetirable(body, w.area), false, 'retry is throttled');
}

// 16. Recorded authored falls own their final impact-pivot heading instead of
// always receiving the generic +90-degree orientation.
{
  const w = makeWorld(undefined, { productionDefaults: true, useCanvas: true });
  const body = w.corpse('recorded-throw', { deathRestRotY: 1.2, deathRecorded: true });
  body.avatarRef.frontCanvas = { width: 256, height: 256 };
  body.avatarRef.frontPlane = new Obj();
  body.avatarRef.frontPlane.matrixWorld = { elements: [1, 0, 0, 0, 0.8, 0.1, 0.6, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  assert.equal(w.mod.tick(NOW), 1);
  assert(Math.abs(body.avatarRef.group.rotation.y - Math.atan2(-0.8, -0.6)) < 1e-7,
    'one-plane body follows the final recorded portrait Y axis rather than deathRestRotY + PI/2');
}

// 17. A compound rider/mount is not flattened to only the humanoid torso.
{
  const w = makeWorld(undefined, { productionDefaults: true });
  const mounted = w.corpse('mounted-rider');
  mounted.avatarRef.riderMount = { root: {}, upper: {} };
  assert.equal(w.mod.tick(NOW), 0, 'compound mounted corpse needs a dedicated full-appearance snapshot');
  assert.equal(mounted.rigDisposed.n, 0, 'mount and rider are both preserved');
  assert.equal(mounted.avatarRef.isCorpseMarker, undefined);
}

console.log('bandit corpse retirement: ok');

// Retirement keeps a corpse's actual story instead of the flat tile elevation.
{
  const w=makeWorld({game:{banditCorpseRetire:{keepFull:0}}});
  w.area='map_i_dev_random_ruin';
  const c=w.corpse('upper-story',{areaId:w.area,deathSurfaceY:12});
  assert.equal(w.mod.tick(NOW),1);
  assert.equal(c.avatarRef.group.position.y,12.03);
}
