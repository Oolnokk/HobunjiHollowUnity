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
    for (const p of jump.platforms) {
      assert(p.fixtureSlot, `${tier}/${theme}: every shaft platform has a central fixture slot`);
      assert.equal(p.fixtureSlot.x, p.x);
      assert.equal(p.fixtureSlot.y, p.y);
      assert.equal(p.fixtureSlot.z, p.z);
      assert(p.fixtureSlot.w >= .8 && p.fixtureSlot.w <= p.w - .24 + 1e-6, 'fixture fits inside the slab');
      assert(p.fixtureSlot.d >= .8 && p.fixtureSlot.d <= p.d - .24 + 1e-6, 'fixture does not overhang the slab');
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
    // Gameplay props replace conflicting hazards without moving their verified jump slabs.
    const replaceable = jump.platforms.find(p => p.kind === 'pillar' || p.kind === 'plasm') || jump.platforms[0];
    const originalKind = replaceable.kind;
    const originalShape = [replaceable.x, replaceable.y, replaceable.z, replaceable.w, replaceable.d];
    const placed = Jump.assignFixture(jump, replaceable.id, 'ignitionBrazier');
    assert(placed && jump.ok, `${tier}/${theme}: fixture is safe to install`);
    assert.equal(placed.occupiedBy, 'ignitionBrazier');
    assert.deepEqual([replaceable.x, replaceable.y, replaceable.z, replaceable.w, replaceable.d], originalShape, 'never move or shrink a verified jump');
    if (originalKind === 'pillar' || originalKind === 'plasm') {
      assert.equal(replaceable.kind, 'plain', 'fixture swaps out conflicting hazards');
      assert.equal(replaceable.originalKind, originalKind, 'diagnostics identify the removed hazard');
      assert.equal(replaceable.tiles, undefined, 'no leftover lethal plasm tiles');
    }
    assert.equal(Jump.assignFixture(jump, replaceable.id, 'anotherBrazier'), null, 'one slot cannot host two fixtures');
    assert.equal(Jump.assignFixture(jump, 'nonexistent', 'fixture'), null, 'unknown platforms do not receive props');
    assert.equal(Jump.assignFixture(jump, replaceable.id, '<script>'), null, 'invalid fixture IDs are ignored');
  }
}
// Mount-time safety: a plan can replace a Hronal pillar or Kanthic plasm patch
// before the scene is built, never by mutating a live hazard after mounting.
{
  class Node {
    constructor() {
      this.children = []; this.userData = {}; this.visible = true;
      this.position = {x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
      this.rotation = {x:0,y:0,z:0};
    }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
  }
  class Geometry { dispose() {} }
  class Material { dispose() {} }
  class Mesh extends Node { constructor(geometry,material) { super(); this.geometry=geometry; this.material=material; } }
  const THREE={ Group:Node, Mesh, BoxGeometry:Geometry, PlaneGeometry:Geometry, MeshBasicMaterial:Material };
  const DynamicSurfaces={registerSurface(){},registerPit(){},clearScope(){}};
  const previousThemes=globalThis.DevRandomRuinLichThemes;
  try {
    for (const theme of ['hronal','kanthic','tothal']) {
      const plan=Jump.compose({shaft:37,spacing:10,floors:2,seed:73,theme});
      assert(plan.ok);
      const toReplace=plan.platforms.find(p=>['pillar','plasm'].includes(p.kind)) || plan.platforms[0];
      assert(Jump.assignFixture(plan,toReplace.id,'testFixture'),'fixture must be allocated before theme mounts');
      const remaining=plan.platforms.filter(p=>p.kind==='pillar'||p.kind==='plasm');
      const spawned=[]; // Captures which physical hazards the real composer would mount.
      globalThis.DevRandomRuinLichThemes={
        activeTheme:()=>theme,
        addPlatformPillar:props=>{spawned.push(['pillar',props.id]);return props;},
        createPlasmPatch:(_tiles,opts)=>{spawned.push(['plasm',opts?.label||'platform']);return {dispose(){}};},
      };
      const runtime=Jump.mount(plan,{THREE,DynamicSurfaces,parent:new Node(),tradition:theme});
      assert.equal(plan.mounted,true,'platform plan must know the 3D scene is already mounted');
      const stillHazard=remaining[0];
      if (stillHazard) {
        assert.equal(Jump.assignFixture(plan,stillHazard.id,'tooLate'),null,
          'no fixture may turn a live Hronal pillar or Kanthic plasm into a phantom hazard');
        assert.equal(stillHazard.kind,theme==='hronal'?'pillar':'plasm');
      }
      runtime.tick();
      const state=runtime.getState();
      assert.equal(state.platforms,plan.platforms.length,'mobile diagnostic must retain total platform count');
      assert.equal(state.hazards,theme,'mobile diagnostic must include the themed hazard type');
      assert.equal(state.hazardsAttached,true,'the theme producer must finish mounting');
      assert(state.fixtures.some(item=>item[0]===toReplace.id&&item[1]==='testFixture'),
        'mobile diagnostic reports replacement fixture');
      if(theme==='hronal')assert.equal(spawned.length,remaining.length,'the replaced pillar was never spawned');
      if(theme==='kanthic')assert.equal(spawned.length,remaining.length+1,'only remaining plasm plus pit were spawned');
      runtime.noteFall();
      assert.equal(runtime.getState().falls,1,'mobile fall counter remains visible');
      runtime.dispose();
      assert.equal(plan.mounted,false,'a disposed runtime no longer owns the platform plan');
    }
  } finally {
    if (previousThemes === undefined) delete globalThis.DevRandomRuinLichThemes;
    else globalThis.DevRandomRuinLichThemes=previousThemes;
  }
}
// Invalid geometry must roll back both the slot and hazard, not leave a broken plan.
{
  const plan=Jump.compose({shaft:37,spacing:10,floors:2,theme:'hronal'});
  const pillar=plan.platforms.find(p=>p.kind==='pillar');
  const originalReach=plan.physics.reach;
  const oldChecks=plan.checks;
  plan.physics.reach=0; // Makes the placement verification reject every nonzero jump.
  assert.equal(Jump.assignFixture(plan,pillar.id,'testFixture'),null,'failed verification rejects the fixture');
  assert.equal(pillar.kind,'pillar','failed verification restores the pillar kind');
  assert.equal(pillar.fixtureSlot.occupiedBy,'explodingPillar','failed verification restores slot ownership');
  assert.equal(pillar.originalKind,undefined,'failed verification removes temporary history');
  assert.equal(plan.checks,oldChecks,'failed verification keeps the original plan check references');
  plan.physics.reach=originalReach;
  assert(plan.ok&&Jump.verify(plan).every(check=>check.ok),'rollback preserves the original playable plan');
}
// A room is a room: every puzzle room draws from the whole set; fire and ice belong to Tothal only; no back-to-back repeats.
{
  const seen = { tothal: new Set(), hronal: new Set(), kanthic: new Set() };
  for (const theme of Object.keys(seen)) for (const tier of ['hole', 'lich']) for (let seed = 1; seed <= 150; seed++) {
    const plan = Plan.compose({ seed: seed * 7919, spacing: 64, anchorX: 256, anchorZ: 256, groundEntranceSide: 'W', theme, ...Plan.tierOptions(tier) });
    assert.ok(plan.ok, `${theme}/${tier}/${seed}: ${plan.checks.filter(c => !c.ok).map(c => c.name)}`);
    for (const floor of plan.floors) for (const wing of floor.wings) {
      const kinds = wing.rooms.slice(0, -1).map(r => r.challenge);
      kinds.forEach((k, i) => { seen[theme].add(k); if (i && !plan.trialRoomId) assert.notEqual(k, kinds[i - 1], 'no back-to-back repeat'); });
    }
  }
  assert.ok(!seen.hronal.has('dungeonFire') && !seen.kanthic.has('dungeonFire'), 'fire and ice puzzles only appear in Tothal ruins');
  assert.ok(seen.tothal.has('dungeonFire'), 'Tothal ruins do get fire and ice');
  for (const theme of Object.keys(seen)) for (const kind of ['pressurePlate', 'glyphObelisk', 'ceilingRailTargets', 'timedMelody', 'ropeChain', 'findBlocks'])
    assert.ok(seen[theme].has(kind), `${theme} ruins can now roll ${kind} in any room`);
}
console.log('ruin tiers + jump shaft: ok');
