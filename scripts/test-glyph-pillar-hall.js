#!/usr/bin/env node
'use strict';
// The projectile room (glyphObelisk) is a hall of solid pillars hiding three glyph targets.
// Regression: every pillar blocker must be registered WITH an id (DynamicSurfaces throws otherwise).
const assert = require('node:assert/strict');
const path = require('node:path');
class Obj { constructor(){this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};this.rotation={x:0,y:0,z:0};this.children=[];this.userData={};this.visible=true;}
  add(...c){for(const o of c){o.parent=this;this.children.push(o);}} remove(c){this.children=this.children.filter(x=>x!==c);} traverse(f){f(this);this.children.forEach(c=>c.traverse?.(f));} }
class Mesh extends Obj { constructor(g,m){super();this.geometry=g;this.material=m;this.isMesh=true;} }
class Geo { dispose(){} }
const THREE = { Group:Obj, Mesh, MeshBasicMaterial:class{constructor(o){Object.assign(this,o);}dispose(){}}, BoxGeometry:Geo, CylinderGeometry:Geo, PlaneGeometry:Geo, SphereGeometry:Geo };
const blockers = new Map(), scopes = [];
const DS = { registerBlocker: d => { if (!d?.id) throw new Error('DynamicSurfaces blocker requires an id'); blockers.set(d.id, d); return d; }, clearScope: s => { scopes.push(s); for (const [k,v] of blockers) if (v.scope === s) blockers.delete(k); } };
const Challenges = require(path.join(__dirname, '..', 'docs/js/ruin-layer-challenges.js'));
const footprints = new Map();
const Footprint = { register: (id, p) => { footprints.set(id, p); return () => footprints.delete(id); } };
const bus = { registerExternalProjectileTarget: () => () => {}, hasActiveRuinState: () => true };
const composeHall = (id, y) => Challenges.compose({
  THREE, parent: new Obj(), room: { x: 10, z: 10, w: 16, d: 16 }, id, kind: 'glyphObelisk', y,
  isActive: () => true, onSolved: () => {}, getPlayerPosition: () => ({ x: 18, z: 18 }), getPlayerY: () => y,
  projectileBus: bus, DynamicSurfaces: DS, AreaFootprintBlockers: Footprint,
});
const rec = composeHall('room-a', 0);
assert.equal(rec.targets.length, 3, 'three hidden glyph targets');
assert.ok(blockers.size >= 6, 'every pillar is solid: ' + blockers.size);
for (const b of blockers.values()) {
  assert.ok(b.scope.startsWith('ruin-layer-glyph-'));
  const bounds = typeof b.bounds === 'function' ? b.bounds(b) : b.bounds; // DynamicSurfaces reads ONLY `bounds`: bare minX/maxX meant an infinite, map-wide wall.
  for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) assert.ok(Number.isFinite(bounds?.[key]), 'finite ' + key);
  assert.ok(bounds.maxX - bounds.minX < 2 && bounds.maxZ - bounds.minZ < 2, 'a pillar-sized footprint, not the whole map');
  assert.equal(b.blocksAt(0, 0, 1.25, b, .2, { worldY: 50 }), false, 'a different story is not blocked');
  assert.equal(b.blocksAt(0, 0, 1.25, b, .2, { worldY: 0.1 }), true, 'this story is blocked');
}
// Walking, dodges and lunges consult AreaFootprintBlockers, not DynamicSurfaces: the pillars must be solid there too.
assert.equal(footprints.size, 1, 'pillars also register a ground-movement footprint');
const fp = [...footprints.values()][0], any = [...blockers.values()][0];
const bb = typeof any.bounds === 'function' ? any.bounds(any) : any.bounds, cx = (bb.minX + bb.maxX) / 2, cz = (bb.minZ + bb.maxZ) / 2;
assert.equal(fp.blocksBox(cx, cz, .2, null), true, 'a walker cannot enter a pillar');
assert.equal(fp.blocksBox(cx, cz, .2, 40), false, 'another height is clear');
assert.equal(fp.blocksBox(cx + 5, cz + 5, .2, null), false, 'open floor stays open');
rec.dispose();
assert.equal(footprints.size, 0, 'dispose removes the footprint');
assert.equal(blockers.size, 0, 'dispose clears the pillar blockers');
// Check the actual collision provider at the visible opening and on all closed faces.
const sides = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const openings = new Set();
const shotRadius = 7 / 55; // Crossbow radius in world units.
for (const id of ['upper-a', 'upper-b', 'upper-c', 'upper-d']) {
  const hall = composeHall(id, 8);
  const cover = [...footprints.values()][0];
  for (const glyph of hall.targets) {
    const face = Math.round(glyph.rune.rotation.y / (Math.PI / 2) + 4) % 4;
    openings.add(face);
    const { x, y, z } = glyph.origin;
    for (const [side, [dx, dz]] of sides.entries()) {
      let blocked = false;
      for (let distance = .6; distance >= -.001; distance -= .025) {
        if (cover.blocksBox(x + dx * distance, z + dz * distance, shotRadius, y)) blocked = true;
      }
      assert.equal(blocked, side !== face, 'only the visible opening admits a centered shot');
    }
    assert.equal(cover.blocksBox(x, z, .2, null), true, 'walking still uses the solid footprint');
    assert.equal(cover.blocksBox(x, z, shotRadius, y - 8), false, 'the same point on the lower story is clear');
  }
  hall.dispose();
}
assert.equal(openings.size, 4, 'fixtures exercise all four opening orientations');
console.log('glyph pillar hall: all four opening faces, solid sides, movement, and floor isolation passed');
