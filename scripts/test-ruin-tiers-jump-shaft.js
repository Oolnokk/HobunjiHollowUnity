#!/usr/bin/env node
'use strict';
// Executes the rarity tiers (cave / hole / lich) end to end at the pure-logic layer:
//  * RuinLayerPlan.tierOptions + compose give exactly the specified floors, wings,
//    wing rooms and braziers, with the gallery thickness unchanged,
//  * ShaftHub.compose accepts the jump-platform traversal for every tier and theme,
//  * RuinJumpShaft platforms pass the real PlayerJump hop limits and carry the
//    per-theme hazards (ice / pillar-radius slabs / mostly-plasm slabs).
const assert = require('node:assert/strict');
const path = require('node:path');
const docs = rel => path.join(__dirname, '..', 'docs', rel);
const Plan = require(docs('js/ruin-layer-plan.js'));
const Hub = require(docs('js/shaft-hub.js'));
const Jump = require(docs('js/ruin-jump-shaft.js'));

const SPEC = {
  cave: { floors: 2, wings: 3, rooms: 2, central: 13 },
  hole: { floors: 3, wings: 4, rooms: 3, central: 27 },
  lich: { floors: 4, wings: 5, rooms: 3, central: 39 },
};
const SIDES = ['N', 'E', 'S', 'W'];

for (const [tier, spec] of Object.entries(SPEC)) {
  const options = Plan.tierOptions(tier);
  assert.equal(options.shaftSize - 10, spec.central, `${tier}: only the central chamber shrinks; the 5-cell galleries stay`);
  assert.equal(options.nativeV50, false, `${tier}: no unaccounted native V50 floors`);
  for (let seed = 1; seed <= 60; seed++) for (const side of SIDES) {
    const plan = Plan.compose({ seed: seed * 104729, spacing: 64, anchorX: 256, anchorZ: 256, groundEntranceSide: side, plinthTrial: seed % 3 === 0, ...options });
    assert.ok(plan.ok, `${tier} seed ${seed}${side}: ${plan.checks.filter(c => !c.ok).map(c => c.name)}`);
    assert.equal(plan.floorCount, spec.floors);
    assert.equal(plan.totalWings, spec.wings);
    assert.equal(plan.totalBraziers, spec.wings, 'one brazier per wing, all required for the Great Door');
    for (const floor of plan.floors) for (const wing of floor.wings) assert.equal(wing.rooms.length, spec.rooms, `${tier}: ${spec.rooms}-room wings`);
    assert.ok(plan.floors[0].wings.every(w => w.side !== side), 'ground floor keeps the entrance wall free');
  }
  for (const theme of ['tothal', 'hronal', 'kanthic']) for (const entranceSide of SIDES) {
    const hub = Hub.compose({ seed: 5, floors: spec.floors, chambers: false, wall: 8, shaft: options.shaftSize, spacing: options.floorHeight,
      traversal: 'jumpPlatforms', entranceSide, theme, portals: [{ floor: 0, side: SIDES.find(s => s !== entranceSide) }] });
    assert.ok(hub.ok, `${tier}/${theme}/${entranceSide} hub: ${hub.checks.filter(c => !c.ok).map(c => c.name + ':' + c.detail)}`);
    assert.equal(hub.doors.length, 0, `${tier}/${theme}: no leftover balcony door tunnels; doorways exist only for real wings`);
    assert.equal(hub.wingPortals.length, 1, `${tier}/${theme}: exactly the requested wing doorways`);
    const jump = hub.jumpShaft;
    assert.ok(jump?.ok, `${tier}/${theme} jump plan`);
    assert.equal(jump.routes.length, spec.floors - 1);
    for (const route of jump.routes) {
      const list = route.platformIds.map(id => jump.platforms.find(p => p.id === id));
      assert.ok(route.rise <= Jump.RISE + 1e-9, 'every hop is within the comfortable rise');
      for (let i = 1; i < list.length; i++) {
        const gx = Math.max(0, Math.abs(list[i].x - list[i - 1].x) - (list[i].w + list[i - 1].w) / 2);
        const gz = Math.max(0, Math.abs(list[i].z - list[i - 1].z) - (list[i].d + list[i - 1].d) / 2);
        assert.ok(Math.hypot(gx, gz) <= jump.physics.reach * .85, `${tier}/${theme}: hop ${i} is jumpable`);
      }
      assert.ok(list.every(p => p.y > route.entryY && p.y < route.exitY), 'platforms stay between their two galleries');
    }
    const kinds = new Set(jump.platforms.map(p => p.kind));
    if (theme === 'tothal') assert.deepEqual([...kinds], ['ice'], 'tothal: every platform is ice');
    if (theme === 'hronal') {
      assert.ok(kinds.has('pillar'));
      for (const p of jump.platforms.filter(q => q.kind === 'pillar')) assert.ok(Math.abs(p.w - Jump.PILLAR_RADIUS) < 1e-9 && Math.abs(p.d - Jump.PILLAR_RADIUS) < 1e-9, 'pillar platform is exactly the blast radius wide');
    }
    if (theme === 'kanthic') {
      assert.ok(kinds.has('plasm'));
      for (const p of jump.platforms.filter(q => q.kind === 'plasm')) {
        assert.ok(p.tiles.length > p.clearTiles.length * 1.8, 'wide slab is mostly plasm');
        assert.ok(p.clearTiles.length >= 5, 'entry, exit and stepping tiles stay clear');
      }
    }
  }
}
console.log('ruin tiers + jump shaft: ok');
