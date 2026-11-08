#!/usr/bin/env node
'use strict';
// Executes docs/js/hronal-witch-bombs.js with stubbed engine pieces and checks the three
// variants: a bomb's tradition follows its ruin, Tothal = frost + enormous knockback + icy
// effect, Kanthic = plasm puddle + explodeables dissolve instead of detonating + reversed
// recording, Hronal unchanged (fire, burning, chain detonation).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/hronal-witch-bombs.js'), 'utf8');

function makeAny() { // Generic chainable stand-in for every THREE constructor the effect code touches.
  const store = {};
  const target = function () {};
  return new Proxy(target, {
    construct: () => makeAny(),
    apply: () => makeAny(),
    get: (_, key) => {
      if (key === 'then') return undefined;
      if (key === 'x' || key === 'y' || key === 'z') return store[key] ?? 0;
      if (key in store) return store[key];
      if (key === 'position' || key === 'scale' || key === 'quaternion' || key === 'material' || key === 'geometry') return (store[key] = makeAny());
      return makeAny();
    },
    set: (_, key, value) => { store[key] = value; return true; },
  });
}
const THREE = new Proxy({}, { get: () => makeAny() });
THREE.Vector3 = class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } clone() { return new THREE.Vector3(this.x, this.y, this.z); } copy(v) { return this.set(v.x, v.y, v.z); } multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; } };

function world({ theme, mapId = 'map_i_dev_random_ruin' }) {
  const calls = { blast: [], chain: [], puddle: [], discard: [], afflictions: [], sfx: [], factories: [], reversed: 0 };
  const player = { x: 10 * 64, y: 10 * 64, health: 100 };
  const scene = { isScene: true, add() {}, traverse() {} };
  const group = { parent: scene, userData: {}, position: { x: 10.5, y: .5, z: 10.5 }, updateWorldMatrix() {}, getWorldPosition() { return { x: 10.5, y: .5, z: 10.5 }; } };
  let burdens = [];
  const win = {
    THREE,
    Shattercasks: {
      registerBurdenFactory: kind => calls.factories.push(kind),
      applyBlast: (map, x, z, options) => calls.blast.push({ map, x, z, ...options }),
      triggerBurdenBlastAt: () => calls.chain.push(1),
      discardBurden: burden => { calls.discard.push(burden.id); burden.exploded = true; },
      activeBurdenRecords: () => burdens,
      backCarrierPosition: () => null,
      createHangingBurden: async options => { const bomb = { ...options, group, exploded: false }; burdens = [bomb]; return bomb; },
    },
    GridTileAccessors: { getCurrentArea: () => mapId, getActiveScene: () => scene, getActiveGrid: () => null },
    Combat: { deps: { TILE: 64, player, hostileObjects: [], getGroundYAtWorld: () => 0 } },
    DevRandomRuin: { getRuntimeContext: () => ({ theme }) },
    DevRandomRuinLichThemes: { createPlasmPuddle: (x, z, options) => { calls.puddle.push({ x, z, ...options }); return {}; }, plasmTexture: () => null },
    ResourceSystem: { addAffliction: (actor, id, amount) => calls.afflictions.push({ id, amount }) },
    AudioSystem: { playObjectSfxKey: key => calls.sfx.push(key), objectSfxConfig: () => ({}), gameAudioConfig: () => ({}) },
    AuthoredFurniture: {}, FurniturePatternSurfaces: { setGlowState() {} },
    console, performance: { now: () => now }, Math, Number, Object, Array, Set, Map, String, Promise, JSON,
  };
  win.window = win;
  let now = 100000;
  vm.createContext(win);
  vm.runInContext(source, win);
  return { win, calls, player, group, advance: ms => { now += ms; }, bombs: () => burdens };
}

(async () => {
  for (const [theme, kind] of [['tothal', 'tothalWitchBomb'], ['kanthic', 'kanthicWitchBomb'], ['hronal', 'hronalWitchBomb']]) {
    const ctx = world({ theme });
    assert.deepEqual([...ctx.calls.factories].sort(), ['hronalWitchBomb', 'kanthicWitchBomb', 'tothalWitchBomb'], 'every variant registers a burden factory');
    const B = ctx.win.HronalWitchBombs;
    assert.equal(B.variantFor('map_i_dev_random_ruin'), theme, 'a ruin of this tradition throws this tradition\'s bombs');
    assert.equal(B.variantFor('map_dev_arena'), 'hronal', 'everywhere else stays Hronal');
    const bomb = await B.spawn({ mapId: 'map_i_dev_random_ruin', scene: { isScene: true }, fuseSeconds: 1 });
    assert.equal(bomb.kind, kind);
    ctx.advance(2000);
    B.tick(.05);
    assert.equal(ctx.calls.blast.length, 1, theme + ' bomb exploded once');
    const blast = ctx.calls.blast[0];
    assert.ok(ctx.calls.sfx.includes('witchBombBlast') || theme === 'kanthic', 'same bomb recording is played');
    if (theme === 'tothal') {
      assert.equal(blast.tag, 'ice');
      assert.ok(blast.knockbackPxS >= 4000, 'insane knockback');
      assert.ok(!blast.burningHealth, 'no fire');
      assert.ok(ctx.calls.afflictions.some(a => a.id === 'frostbittenStamina' && a.amount > 0), 'the existing frost affliction is applied');
      assert.equal(ctx.calls.chain.length, 1, 'still sets off nearby explodeables');
      assert.equal(ctx.calls.puddle.length, 0);
    }
    if (theme === 'kanthic') {
      assert.equal(blast.tag, 'plasm');
      assert.equal(ctx.calls.puddle.length, 1, 'leaves a plasm puddle');
      assert.equal(ctx.calls.puddle[0].ttl, 5, 'that lasts about five seconds');
      assert.equal(ctx.calls.chain.length, 0, 'explodeables are dissolved, not detonated');
      assert.ok(!ctx.calls.afflictions.some(a => a.id === 'frostbittenStamina'));
    }
    if (theme === 'hronal') {
      assert.equal(blast.tag, 'fire');
      assert.ok(blast.burningHealth > 0);
      assert.equal(ctx.calls.chain.length, 1);
    }
  }

  // Kanthic: a registered breakable is covered and shrunk first, and only then removed.
  {
    const ctx = world({ theme: 'kanthic' });
    const B = ctx.win.HronalWitchBombs;
    const scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, copy(o) { return this.set(o.x, o.y, o.z); }, clone() { return { ...scale }; }, multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; } };
    let removed = false, broke = false;
    const prop = { isObject3D: true, userData: {}, scale: { ...scale, clone() { return { ...this }; }, copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; } },
      parent: { remove: () => { removed = true; } }, updateWorldMatrix() {}, getWorldPosition: () => ({ x: 11, y: .5, z: 11 }) };
    B.registerBreakable(prop, { mapId: 'map_i_dev_random_ruin', radius: 4, onBreak: () => { broke = true; return true; } });
    const bomb = await B.spawn({ mapId: 'map_i_dev_random_ruin', scene: { isScene: true }, fuseSeconds: 1 });
    ctx.advance(2000); B.tick(.05);
    assert.equal(broke || removed, false, 'nothing is removed on the blast frame');
    for (let i = 0; i < 40 && !removed; i++) B.tick(.05);
    assert.ok(prop.scale.x < 1 || removed, 'the prop shrinks');
    for (let i = 0; i < 60 && !removed; i++) B.tick(.05);
    assert.ok(removed && broke, 'then it is removed through its normal break callback');
  }
  console.log('witch-bomb variants: ok');
})().catch(error => { console.error(error); process.exit(1); });
