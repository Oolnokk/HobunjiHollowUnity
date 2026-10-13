'use strict';

// Interior ceilings: flat by default, gables raise their wall stretch into a
// peak, the ceiling lerps from a gable to the wall opposite it, and the
// faces wind so the overhead camera culls them. Runs the real module.
const assert = require('node:assert/strict');

global.window = global;
require('../docs/js/interior-ceilings.js');
const IC = window.InteriorCeilings;

const floor = [];
for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) floor.push([c, r]);

const heightAt = (data, x, z) => { // Exact lattice vertex lookup on the ceiling mesh.
  const P = data.ceiling.positions;
  for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i] - x) < 1e-9 && Math.abs(P[i + 2] - z) < 1e-9) return P[i + 1];
  return undefined;
};
const faceNormalY = (P, I, k) => {
  const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
  const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  return e1[2] * e2[0] - e1[0] * e2[2];
};

// Stretches: one per wall of the rectangle.
const stretches = IC.wallStretches(floor);
assert.equal(stretches.length, 4);
assert.deepEqual(stretches.find(s => s.side === 'north'), { side: 'north', line: 0, from: 0, to: 8 });

// Flat default: one quad per floor cell at the wall height, all facing down.
const flat = IC.buildCeilingGeometryData(floor, 2, undefined);
assert.equal(flat.ceiling.indices.length / 6, floor.length);
assert(flat.ceiling.positions.every((v, i) => i % 3 !== 1 || v === 2), 'flat ceiling sits at the wall top');
for (let k = 0; k < flat.ceiling.indices.length; k += 3) assert(faceNormalY(flat.ceiling.positions, flat.ceiling.indices, k) < 0, 'ceiling faces wind downward');
assert.equal(flat.gables.length, 0);

// Disabled ceiling builds nothing.
assert.equal(IC.buildCeilingGeometryData(floor, 2, { enabled: false }).ceiling.indices.length, 0);

// A click just outside the north wall (or on the floor tile beside it) picks that stretch.
let toggled = IC.toggleGableAt(undefined, floor, 4, 0.2, 1.5);
assert.equal(toggled.action, 'added');
assert.deepEqual(toggled.ceiling.gables, [{ side: 'north', line: 0, from: 0, to: 8, rise: 1.5 }]);

// Lone gable: peak over the north wall's midpoint, sloping to the flat south wall.
const lone = IC.buildCeilingGeometryData(floor, 1.75, toggled.ceiling);
assert.equal(heightAt(lone, 4, 0), 3.25);
assert.equal(heightAt(lone, 4, 3), 2.5);
assert.equal(heightAt(lone, 4, 6), 1.75);
assert.equal(heightAt(lone, 0, 0), 1.75, 'gable corners stay on the side-wall tops');
assert.equal(heightAt(lone, 2, 0), 2.5);
assert.equal(lone.gables.length, 1);
const g = lone.gables[0].positions; // Triangle in the north wall plane, apex at the midpoint.
assert(g.filter((v, i) => i % 3 === 2).every(v => v === 0));
assert.equal(Math.max(...g.filter((v, i) => i % 3 === 1)), 3.25);
for (let k = 0; k < lone.ceiling.indices.length; k += 3) assert(faceNormalY(lone.ceiling.positions, lone.ceiling.indices, k) < 0, 'sloped ceiling still faces down');

// Opposite gables: an even ridge across the room.
toggled = IC.toggleGableAt(toggled.ceiling, floor, 4, 5.9, 1.5);
const pitched = IC.buildCeilingGeometryData(floor, 1.75, toggled.ceiling);
for (let z = 0; z <= 6; z += 0.25) assert.equal(heightAt(pitched, 4, z), 3.25);
assert.equal(heightAt(pitched, 2, 3), 2.5);
assert.equal(pitched.gables.length, 2);

// Gable triangles face into the room (north: +Z, south: -Z).
for (const gable of pitched.gables) {
  const P = gable.positions;
  const e1 = [P[3] - P[0], P[4] - P[1], P[5] - P[2]], e2 = [P[6] - P[0], P[7] - P[1], P[8] - P[2]];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  assert(gable.side === 'north' ? nz > 0 : nz < 0, `${gable.side} gable faces inward`);
}

// Brick gable ends: one triangle-clipped WallBuilder panel per gable, on the
// wall top, with the same yaw as that side's wall panels.
const brickPanels = IC.gableBrickPanels(pitched.gables, 1.75);
assert.equal(brickPanels.length, 2);
const northPanel = brickPanels.find(p => p.id.startsWith('gable_north'));
assert.deepEqual(northPanel.position, [4, 1.75, 0]);
assert.deepEqual(northPanel.rotationDeg, [0, 0, 0]);
assert.equal(northPanel.width, 8);
assert.equal(northPanel.height, 1.5);
assert.equal(northPanel.triangleClip, true);
assert.deepEqual(brickPanels.find(p => p.id.startsWith('gable_south')).rotationDeg, [0, 180, 0]);

// Clicking the same stretch again removes it.
assert.equal(IC.toggleGableAt(toggled.ceiling, floor, 4, 0.1).action, 'removed');

// Stale gables (wall no longer there after a floor edit) are ignored.
const stale = IC.buildCeilingGeometryData(floor, 1.75, { gables: [{ side: 'north', line: 3, from: 0, to: 8 }] });
assert.equal(stale.gables.length, 0);
assert.equal(stale.maxY, 1.75);

console.log('interior ceilings: ok');
