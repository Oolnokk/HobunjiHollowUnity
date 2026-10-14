'use strict';

// Interior ceilings: flat by default, gables raise their wall stretch into a
// peak, the ceiling lerps from a gable to the wall opposite it, and the
// faces wind so the overhead camera culls them. Runs the real module.
const assert = require('node:assert/strict');

global.window = global;
global.THREE = global.THREE || {}; // interior-scene-builder.js only checks it exists at load.
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

// Opposite-wall pairing ignores a nearer notch: a 10-wide nave (x 0..10,
// rows 0..7) with a 4-wide porch (x 3..7, rows 8..9). The short flat walls at
// row 8 (x 0..3 and 7..10) are nearer the north gable than the porch's
// south gable, but the two gables must still pair into one symmetric roof.
const nave = [];
for (let r = 0; r < 8; r++) for (let c = 0; c < 10; c++) nave.push([c, r]);
for (let r = 8; r < 10; r++) for (let c = 3; c < 7; c++) nave.push([c, r]);
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const naveRoof = IC.buildCeilingGeometryData(nave, 2, { gables: [
  { side: 'north', line: 0, from: 0, to: 10, rise: 2 },
  { side: 'south', line: 10, from: 3, to: 7, rise: 2 },
] });
for (const z of [0, 2, 4, 6, 8, 10]) near(heightAt(naveRoof, 5, z), 4, `ridge stays level at z=${z}`);
for (const z of [1, 4, 7]) for (const dx of [1, 2, 3]) {
  near(heightAt(naveRoof, 5 - dx, z), heightAt(naveRoof, 5 + dx, z), `roof is symmetric at z=${z}, dx=${dx}`);
}
// A lone gable slopes to the middle of the wall facing its midpoint (the porch), not a corner notch.
const lonePorch = IC.buildCeilingGeometryData(nave, 2, { gables: [{ side: 'north', line: 0, from: 0, to: 10, rise: 2 }] });
near(heightAt(lonePorch, 5, 10), 2, 'lone gable lands on the porch wall top');
assert(heightAt(lonePorch, 5, 7) > 2, 'ridge still rising toward the porch at z=7');
for (const dx of [1, 2, 3]) near(heightAt(lonePorch, 5 - dx, 4), heightAt(lonePorch, 5 + dx, 4), `lone gable symmetric dx=${dx}`);

// Stale gables (wall no longer there after a floor edit) are ignored.
const stale = IC.buildCeilingGeometryData(floor, 1.75, { gables: [{ side: 'north', line: 3, from: 0, to: 8 }] });
assert.equal(stale.gables.length, 0);
assert.equal(stale.maxY, 1.75);

// Carved roof material: one texture row per eave (V 0 at the eave, 1 at the
// ridge on both slopes) and U tiling gable to gable in whole repeats.
const carved = IC.buildCeilingGeometryData(floor, 1.75, { material: 'carved', gables: [
  { side: 'north', line: 0, from: 0, to: 8, rise: 1.5 },
  { side: 'south', line: 6, from: 0, to: 8, rise: 1.5 },
] });
assert.equal(carved.material, 'carved');
const uvAt = (data, x, z) => { // First vertex at (x, z) — quads repeat vertices with identical UVs inside one gable frame.
  const P = data.ceiling.positions;
  for (let i = 0, k = 0; i < P.length; i += 3, k += 2) if (Math.abs(P[i] - x) < 1e-9 && Math.abs(P[i + 2] - z) < 1e-9) return [data.ceiling.uvs[k], data.ceiling.uvs[k + 1]];
  return undefined;
};
near(uvAt(carved, 0, 3)[1], 0, 'west eave V');
near(uvAt(carved, 8, 3)[1], 0, 'east eave V');
near(uvAt(carved, 4, 3)[1], 1, 'ridge V');
near(uvAt(carved, 2, 3)[1], 0.5, 'mid-slope V');
const slope = Math.hypot(4, 1.5), repeats = Math.max(1, Math.round(6 / slope));
near(uvAt(carved, 2, 0)[0], 0, 'U starts at the north gable');
near(uvAt(carved, 2, 6)[0], repeats, 'U ends at the south gable after whole repeats');
assert.equal(IC.normalizeCeiling({ material: 'marble', tint: 'red' }).material, null, 'unknown material ignored');
assert.equal(IC.normalizeCeiling({ material: 'carved', tint: '#7D7355' }).tint, '#7d7355');
// Planks keep world UVs.
assert.deepEqual(uvAt(IC.buildCeilingGeometryData(floor, 1.75, {}), 3, 2), [3, 2]);

// Windows punch openings: wall-mounted window records become apertures on the
// wall plane they were attached to, sized by their wall-space scale.
window.DaylightWindowRuntime = { windowSilhouette: key => key === 'crossbarWindow' ? { minX: -0.55, maxX: 0.55, minY: 0.5, maxY: 1.74, width: 1.1, height: 1.24 } : null };
require('../docs/js/interior-scene-builder.js'); // Needs window.THREE to exist (any object) to install.
const ISB = window.InteriorSceneBuilder;
const templeWindow = { id: 'w', itemKey: 'crossbarWindowFurniture', wallOrnamentKey: 'crossbarWindow', col: 9, row: 1, rotY: 0, postX: 0.646, postY: 0.232, postZ: 0.7, postSX: 1.5, postSY: 2, postSZ: 1,
  wallAttachment: { wallPoint: [10.146, 2.472, 2], wallNormal: [0, 0, 1], offsetU: 0, offsetV: 0, normalOffset: 0.1875 } };
const [opening] = ISB.windowWallOpenings([templeWindow, { itemKey: 'benchFurniture', col: 1, row: 1 }]);
near(opening.center[0], 10.146, 'opening x'); near(opening.center[1], 2.472, 'opening centred on the scaled frame'); near(opening.center[2], 2, 'opening on the wall plane');
near(opening.width, 1.65, 'opening width scales with X'); near(opening.height, 2.48, 'opening height scales with Y');
// It actually cuts the north wall panel it sits on.
const templeNorthWall = { id: 'wn', width: 10, height: 3.5, position: [10, 0, 2], rotationDeg: [0, 0, 0] };
const pieces = ISB.applyWallOpenings([templeNorthWall], [opening]);
assert(pieces.length >= 3, 'north wall split around the window');
const covered = pieces.reduce((sum, piece) => sum + piece.width * piece.height, 0);
near(covered, 10 * 3.5 - 1.65 * (3.5 - (2.472 - 1.24)), 'only the window area (clipped at the wall top) is removed');
// Gable bricks get the same aperture as an excludeQuad on the wall plane.
const [quad] = ISB.openingExcludeQuads([opening]);
assert(quad.every(point => Math.abs(point[2] - 2) < 1e-9), 'exclude quad lies on the wall plane');
near(quad[1][1] - quad[0][1], 2.48, 'exclude quad height');

console.log('interior ceilings: ok');
