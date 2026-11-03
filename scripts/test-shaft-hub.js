#!/usr/bin/env node
'use strict';
const assert = require('assert');
const G = require('../docs/js/cell-grid-3d.js');
const H = require('../docs/js/shaft-hub.js');
globalThis.window = globalThis; // the real DynamicSurfaces is a browser IIFE
globalThis.document = globalThis.document || { createElement: () => ({}), addEventListener() {} };
let DS = null; try { require('../docs/js/dynamic-surfaces.js'); DS = globalThis.DynamicSurfaces || null; } catch (e) { DS = null; }
const CS = require('../docs/js/climb-surfaces.js');

// ---- every rotation composes and proves itself
for (const seed of [1, 4, 5, 6, 7, 11]) {
  const r = H.compose({ seed });
  assert(r.ok, `seed ${seed}: ` + JSON.stringify(r.checks.filter(c => !c.ok)));
  assert.equal(r.balconies.length, 3); assert.equal(new Set(r.balconies.map(b => b.side)).size, 3, 'one balcony per side');
  assert(!r.balconies.some(b => b.side === r.entrance.side), 'the entrance side is the one without a balcony');
  assert.deepEqual(r.balconies.map(b => b.level), [4, 8, 12], 'floors every 4 levels');
  assert.equal(r.surfaces.length, 3, 'one merged climbable wall per balcony');
}

// ---- geometry: walls are thick, the shaft is hollow, balconies are real floors with headroom
{
  const r = H.compose({ seed: 1 }), g = r.grid, mid = 6;
  assert(g.isSolid(0, 0, 5) && g.isSolid(1, 6, 5) && g.isSolid(2, 6, 5), 'the shell is 3 thick');
  assert(!g.isSolid(mid, mid, 0) && !g.isSolid(mid, mid, 12), 'the shaft is hollow to the ceiling');
  assert(g.isSolid(mid, mid, r.levels - 1), 'under a ceiling');
  for (const b of r.balconies) for (const c of b.cells) { assert(g.canStand(c.col, c.row, b.level)); assert(!g.canStand(c.col, c.row, b.level - 1), 'no floor inside the buttress'); }
  const s = r.surfaces[0]; assert(s.style === 'holds' && Math.abs(s.y0 - 0) < 1e-9, 'surfaces run from the ground, styled');
  assert(r.surfaces.every(s => (s.u1 - s.u0) === 3), 'a balcony is 3 wide so its wall is 3 wide');
  const spans = r.surfaces.map(s => s.y1).sort((a, b) => a - b); assert.deepEqual(spans, [4, 8, 12]);
  assert.equal(g.stats().levels, 15);
}

// ---- the proof is a real proof: break the hub and it says so
{
  const r = H.compose({ seed: 1 }), g = r.grid;
  g.paintClimbFaces; // sanity
  for (const b of r.balconies) for (const f of b.front) for (let l = 0; l < b.level; l++) g.clearClimbFace(f.c, f.r, l, b.climbDir);
  const broken = H.verify({ ...r, surfaces: g.collectClimbSurfaces() });
  assert(broken.some(c => /Reachable$/.test(c.name) && !c.ok) && broken.some(c => /Climbable$/.test(c.name) && !c.ok), 'without climbable walls the balconies are unreachable: ' + JSON.stringify(broken.filter(c => !c.ok).map(c => c.name)));
  const r2 = H.compose({ seed: 1 }), d = r2.doors[1], t = d.tunnel[1];
  r2.grid.set(t.col, t.row, d.level, G.KIND.SOLID);
  const blocked = H.verify(r2);
  assert(blocked.some(c => c.name === 'door1Clear' && !c.ok) && blocked.some(c => c.name === 'door1Reachable' && !c.ok), 'a blocked tunnel is caught');
  const r3 = H.compose({ seed: 1 }); r3.grid.set(r3.entrance.inside.c, r3.entrance.inside.r, 1, G.KIND.SOLID);
  assert(H.verify(r3).some(c => c.name === 'entranceOpen' && !c.ok), 'a blocked entrance (no headroom) is caught');
}

// ---- option clamping
{
  const r = H.compose({ seed: 2, balconies: 9, shaft: 4, spacing: 1, length: 99, depth: 9 });
  assert(r.ok, JSON.stringify(r.checks.filter(c => !c.ok)));
  assert.equal(r.balconies.length, 3); assert(r.options.shaft >= 5 && r.options.spacing >= 3 && r.options.length <= r.options.shaft - 2);
  const one = H.compose({ seed: 3, balconies: 1 }); assert(one.ok && one.balconies.length === 1 && one.levels === 7);
}

// ---- mount: surfaces registered into ClimbSurfaces and DynamicSurfaces, then cleared
{
  const r = H.compose({ seed: 1, originX: 20, originZ: 30 });
  const reg = []; const fakeDS = { registerSurface: d => reg.push(d), clearScope(s) { for (let i = reg.length - 1; i >= 0; i--) if (reg[i].scope === s) reg.splice(i, 1); } };
  const calls = []; const fakeRuin = { setLevelRelativeSupport: v => calls.push(v) };
  CS.clearScope('hub');
  const m = H.mount(r, { ClimbSurfaces: CS, DynamicSurfaces: fakeDS, DevRandomRuin: fakeRuin, scope: 'hub' });
  assert.equal(m.surfaces, 3); assert(m.floors > 30, 'standable cells became support surfaces: ' + m.floors); assert.deepEqual(calls, [true], 'stacked floors switch support sampling to level-relative');
  assert.equal(CS.list().filter(s => s.scope === 'hub').length, 3);
  assert(reg.some(s => s.topY === 12), 'the top balcony is a support surface at y = 12');
  H.unmount({ ClimbSurfaces: CS, DynamicSurfaces: fakeDS, scope: 'hub' });
  assert.equal(CS.list().filter(s => s.scope === 'hub').length, 0); assert.equal(reg.length, 0);
}

// ---- the real DynamicSurfaces: why level-relative sampling is needed
if (DS) {
  const r = H.compose({ seed: 1, originX: 0, originZ: 0 });
  H.mount(r, { DynamicSurfaces: DS, scope: 'hubreal' });
  const b = r.balconies[2], cell = b.cells[0], x = cell.col + .5, z = cell.row + .5;
  assert.equal(DS.sampleSupport(x, z, { minY: -4, maxY: 5, pad: .02 }), null, 'the old fixed band [-4,5] cannot see a balcony 12 up: the player would be "falling"');
  const rel = DS.sampleSupport(x, z, { minY: 12 - 8, maxY: 12 + .44, pad: .02 });
  assert(rel && Math.abs(rel.y - 12) < 1e-9, 'level-relative sampling finds it');
  const floor = DS.sampleSupport(6.5, 6.5, { minY: -8, maxY: 0.44, pad: .02 }); assert(floor && floor.y === 0, 'and still finds the floor from the floor');
  DS.clearScope('hubreal');
} else console.log('(real DynamicSurfaces not loadable in node: skipped)');

// ---- levelRoom: the hub as an abstract room for the composer
{
  const r = H.compose({ seed: 1 }), room = H.levelRoom(r, 0);
  assert(!room.solid(6.5, 6.5) && room.solid(0.5, 0.5), 'the floor level’s open shaft vs its shell');
  assert.equal(room.floorY, 0); assert.equal(H.levelRoom(r, 8).floorY, 8);
}
console.log('ok test-shaft-hub');
