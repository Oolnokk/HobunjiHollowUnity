#!/usr/bin/env node
'use strict';
// The "rope swings" central-shaft puzzle (js/ruin-rope-shaft.js), an alternate to the jump-platform
// staircase that tiered ruins roll between (RuinLayerPlan.SHAFT_PUZZLES). Checked independently of the
// module's own proof:
//  * no slab overlaps another in plan, so no support pillar (pit floor -> its own slab) passes through a slab,
//    and every story uses fewer slabs than the staircase;
//  * each story has a rope, and RopeCore.reachAmplitude (the rope rooms' check) with a separate flight
//    simulation lands on its landing slab within a comfortable swing — no climbing;
//  * the whole swing, backswing included, up to RopeCore's swing limit, misses every slab;
//  * jump hops stay within PlayerJump's reach; the shaft hub composes with headroom; mounting hangs the
//    ruin's own rider ropes from stone brackets once the rope runtime is live, and removes them on dispose.
const assert = require('node:assert/strict');
const path = require('node:path');
const docs = rel => path.join(__dirname, '..', 'docs', rel);
const Plan = require(docs('js/ruin-layer-plan.js'));
const Hub = require(docs('js/shaft-hub.js'));
const Jump = require(docs('js/ruin-jump-shaft.js'));
const Rope = require(docs('js/ruin-rope-shaft.js'));
const RC = require(docs('js/rope-core.js'));

const SIDES = ['N', 'E', 'S', 'W'], BODY = [.15, .75, 1.3], R = .24, THICK = .45;
const bodyHits = (platforms, x, y, z) => platforms.some(p => Math.abs(x - p.x) <= p.w / 2 + R && Math.abs(z - p.z) <= p.d / 2 + R
  && y + BODY[0] < p.y && y + BODY[2] > p.y - THICK);
const footHalf = p => (Math.max(1, Math.round(p.w)) % 2 === 0 ? 2 : 3) * .75 / 2;

for (const tier of ['cave', 'hole', 'lich']) for (const theme of ['tothal', 'hronal', 'kanthic']) for (const entranceSide of SIDES) {
  const t = Plan.TIERS[tier], o = Plan.tierOptions(tier);
  const label = `${tier}/${theme}/${entranceSide}`;
  const plan = Rope.compose({ shaft: o.shaftSize, spacing: t.floorHeight, floors: t.floors, seed: 3, theme, entranceSide, originX: 60, originZ: 40 });
  assert(plan.ok, `${label}: ${plan.checks.filter(c => !c.ok).map(c => c.name + ':' + c.detail)}`);
  assert.equal(plan.method, 'ropeSwings');
  const staircase = Jump.compose({ shaft: o.shaftSize, spacing: t.floorHeight, floors: t.floors, seed: 3, theme, entranceSide, originX: 60, originZ: 40 });
  if (t.floors > 2) assert(plan.platforms.length < staircase.platforms.length, `${label}: fewer slabs than the staircase (${plan.platforms.length} vs ${staircase.platforms.length})`);
  // Pillars: each runs from the pit floor up to its own slab; nothing lower may stand in its footprint.
  for (const a of plan.platforms) for (const b of plan.platforms) {
    if (a === b || b.y >= a.y) continue;
    const h = footHalf(a);
    assert(!(Math.abs(a.x - b.x) < h + b.w / 2 && Math.abs(a.z - b.z) < h + b.d / 2), `${label}: ${a.id}'s pillar passes through ${b.id}`);
  }
  const byId = new Map(plan.platforms.map(p => [p.id, p]));
  for (const route of plan.routes) {
    const list = route.platformIds.map(id => byId.get(id));
    const ropes = plan.ropes.filter(r => route.ropes.includes(r.id));
    assert(ropes.length >= 1, `${label}: story ${route.story} has a rope`);
    assert(Math.abs(list[0].y - route.entryY - Jump.RISE) < 1e-6 && route.exitY - list.at(-1).y <= Jump.RISE + 1e-6, `${label}: both galleries one step away`);
    for (let i = 1; i < list.length; i++) {
      if (ropes.some(r => r.from === list[i - 1].id && r.to === list[i].id)) continue;
      const rise = list[i].y - list[i - 1].y;
      assert(rise <= Jump.RISE + 1e-6 && rise > 0, `${label}: hop rise`);
      assert(Jump.edgeGap(list[i - 1], list[i]) <= Jump.reach(rise) * .85 + 1e-6, `${label}: hop ${list[i].id} within jump reach`);
    }
    for (const r of ropes) {
      const pad = byId.get(r.from), landing = byId.get(r.to), dirX = Math.cos(r.yaw), dirZ = Math.sin(r.yaw);
      assert(Math.abs(r.anchor.y - r.length - (pad.y + Rope.GRIP_ABOVE_LAUNCH)) < 1e-3, `${label}: the resting grip hangs over the launch pad`);
      assert(landing.y - pad.y > 1.5, `${label}: ${r.id} gains real height (${(landing.y - pad.y).toFixed(2)})`);
      // Whole arc at the swing limit (backswing included) misses every slab.
      for (let i = 0; i <= 120; i++) {
        const a = -RC.MAX_ANGLE + 2 * RC.MAX_ANGLE * i / 120, sx = Math.sin(a) * r.length;
        assert(!bodyHits(plan.platforms, r.anchor.x + dirX * sx, r.anchor.y - Math.cos(a) * r.length, r.anchor.z + dirZ * sx), `${label}: ${r.id} swing clear at ${a.toFixed(2)} rad`);
      }
      // Independent release flight: RopeCore gravity and kick, landing on the slab's top from above.
      const amp = RC.reachAmplitude({ anchor: r.anchor, yaw: r.yaw, length: r.length }, start => {
        const f = { ...start }, dt = 1 / 60;
        for (let n = 0; n < 240; n++) {
          f.vy -= RC.GRAVITY * dt; f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt;
          if (f.vy <= 0 && f.y <= landing.y + .08 && f.y >= landing.y - .2 && Math.abs(f.x - landing.x) <= landing.w / 2 - .15 && Math.abs(f.z - landing.z) <= landing.d / 2 - .15) return true;
          if (bodyHits(plan.platforms, f.x, f.y, f.z) || f.y < landing.y - 2) return false;
        }
        return false;
      }, { maxAmp: Rope.PROOF_AMP + 1e-9 });
      assert(amp != null && amp <= Rope.PROOF_AMP + 1e-9, `${label}: ${r.id} is landable by swinging alone (amp ${amp})`);
    }
  }
}

// It is a central-shaft puzzle the tiers roll for, alongside the staircase; an explicit choice wins.
assert.deepEqual([...Plan.SHAFT_PUZZLES], ['jumpPlatforms', 'ropeSwings']);
assert(!Plan.TRAVERSAL_METHODS.includes('ropeSwings'), 'the untiered dev ruin keeps its own pool');
const rolled = new Set();
for (let seed = 1; seed <= 40; seed++) rolled.add(Plan.compose({ seed: seed * 7919, spacing: 64, anchorX: 256, anchorZ: 256, groundEntranceSide: 'S', ...Plan.tierOptions('hole') }).options.shaftTraversal);
assert.deepEqual([...rolled].sort(), ['jumpPlatforms', 'ropeSwings'], 'tier ruins roll both shaft puzzles');
assert.equal(Plan.compose({ seed: 5, spacing: 64, anchorX: 256, anchorZ: 256, groundEntranceSide: 'S', ...Plan.tierOptions('lich'), shaftTraversal: 'ropeSwings' }).options.shaftTraversal, 'ropeSwings');

// The real hub composes it (with the bomber headroom story) for every tier.
for (const tier of ['cave', 'hole', 'lich']) {
  const o = Plan.tierOptions(tier), t = Plan.TIERS[tier];
  const hub = Hub.compose({ seed: 5, floors: t.floors, chambers: false, wall: 8, shaft: o.shaftSize, spacing: o.floorHeight,
    traversal: 'ropeSwings', entranceSide: 'W', theme: 'hronal', portals: [{ floor: 0, side: 'E' }] });
  assert(hub.ok, `${tier} hub: ${hub.checks.filter(c => !c.ok).map(c => c.name)}`);
  assert.equal(hub.jumpShaft?.method, 'ropeSwings');
  assert.equal(hub.headroom, o.floorHeight, 'open story above the top gallery for the bomber nest');
}

// Mount: slabs/pit from the staircase runtime, plus brackets and rider ropes once the rope runtime is live.
{
  class Node {
    constructor() { this.children = []; this.userData = {}; this.visible = true; this.position = { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } }; this.rotation = { x: 0, y: 0, z: 0 }; this.layers = { disable() {} }; }
    add(c) { this.children.push(c); c.parent = this; } remove(c) { this.children = this.children.filter(n => n !== c); c.parent = null; }
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  }
  class Geometry { dispose() {} } class Material { dispose() {} }
  class Mesh extends Node { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  const THREE = { Group: Node, Mesh, BoxGeometry: Geometry, PlaneGeometry: Geometry, MeshBasicMaterial: Material };
  const DS = { registerSurface() {}, registerPit() {}, clearScope() {} };
  const plan = Rope.compose({ shaft: 37, spacing: 10, floors: 3, seed: 1, theme: 'kanthic', entranceSide: 'S' });
  const added = [], removed = [];
  let live = false;
  const saved = globalThis.DevRandomRuinSimplePuzzles;
  globalThis.DevRandomRuinSimplePuzzles = {
    hasActiveRuinState: () => live,
    addFurnitureRope: (spec, mount) => { const rope = { spec, mount }; added.push(rope); return rope; },
    removeFurnitureRope: rope => { removed.push(rope); return true; },
  };
  try {
    const parent = new Node(), runtime = Rope.mount(plan, { THREE, DynamicSurfaces: DS, parent, tradition: 'kanthic' });
    assert.equal(runtime.method, 'ropeSwings');
    assert.equal(added.length, 0, 'no ropes before the ruin rope runtime exists');
    live = true; runtime.tick(.016);
    assert.equal(added.length, plan.ropes.length, 'one rider rope per planned rope');
    for (const rope of added) {
      const planned = plan.ropes.find(r => 'shaft-' + r.id === rope.spec.id);
      assert(planned && rope.spec.length === planned.length && rope.spec.maxLength === planned.length && rope.mount?.name === 'rope-shaft-bracket-' + planned.id);
    }
    runtime.tick(.016);
    assert.equal(added.length, plan.ropes.length, 'ropes are hung once');
    assert(Rope.assignFixture(plan, plan.routes[0].platformIds[0], 'ignitionBrazier'), 'the first step takes a brazier');
    assert.equal(runtime.getState().ropes, plan.ropes.length);
    runtime.dispose();
    assert.equal(removed.length, plan.ropes.length, 'ropes leave with the shaft');
    assert.equal(parent.children.length, 0);
  } finally {
    if (saved === undefined) delete globalThis.DevRandomRuinSimplePuzzles; else globalThis.DevRandomRuinSimplePuzzles = saved;
  }
}
console.log('ruin rope shaft: ok');
