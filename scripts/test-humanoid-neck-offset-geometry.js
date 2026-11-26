'use strict';
// Run: node scripts/run-tests.js humanoid-neck-offset-geometry
// Real portrait-geometry builder exercised without a WebGL renderer: four rig weights,
// both faces, UVs, a 2.5-pixel head junction, and body vertices owned by the actual spine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing production function ${name}`);
  const begin = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = begin + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, `malformed function ${name}`);
  return source.slice(start, end);
}
const ctx = vm.createContext({});
for (const name of [
  'smoothstep01', 'neckBlendBand', 'neckBlendWeight', 'headOffsetWeightAt',
  'neckBlendRows', 'headScaleGateAtPixel', 'headScaleWeightAt',
]) vm.runInContext(extract(name), ctx);
ctx.window = ctx; // Run the exact shared seven-node interpolation, not a fixture that puts every torso vertex on spine node 6.
vm.runInContext(fs.readFileSync('docs/js/character-spine.js', 'utf8'), ctx);
vm.runInContext(`const OFFSET_BONE = 7, NECK_BONE = 8, HEAD_BONE = 9;
const spineNodeWeightsAt = (y, base, height, posterior) => window.HobunjiCharacterSpine.nodeWeightsAt(y, base, height, posterior);`, ctx);
vm.runInContext(extract('buildSkinnedPlaneGeometry'), ctx);

class Attribute {
  constructor(values, itemSize) { this.array = values; this.itemSize = itemSize; this.count = values.length / itemSize; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  getW(i) { return this.array[i * this.itemSize + 3]; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.groups = []; this.userData = {}; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  getAttribute(name) { return this.attributes[name]; }
  addGroup(start, count, index) { this.groups.push({ start, count, materialIndex: index }); }
  computeBoundingBox() {}
  computeBoundingSphere() {}
}
const THREE = {
  BufferGeometry,
  Float32BufferAttribute: Attribute,
  Uint16BufferAttribute: Attribute,
};
function verifyPixelBand(size, headBottom, segmentsY) {
  const modelHeight = 1; // Fixed world height: variation must come from sprite pixels, not a species-height guess.
  const neckY = 0.5 - (headBottom + 0.5) / size;
  const geometry = ctx.buildSkinnedPlaneGeometry(THREE, 1, modelHeight, { x: 0, y: neckY, z: 0 }, {
    pixelWidth: size, pixelHeight: size, segmentsX: 6, segmentsY,
    spineBaseY: neckY - 2.5 / size, posteriorY: neckY - 0.42, // The upper spline node now reaches the last sprite head pixel.
    headBoundsPx: { left: size * 0.3, right: size * 0.7 },
  });
  const { top, bottom } = geometry.userData.neckBandPx;
  assert.equal(geometry.userData.portraitGridRows.length, segmentsY + 1, 'attachment sampler uses the actual redistributed grid');
  assert.ok(Math.abs(geometry.userData.neckPivotPx - (headBottom + 0.5)) < .001, 'joint stays at last sprite head pixel');
  assert.ok(bottom - top > 0 && bottom - top <= size * .30 + .001, 'broad blend is clipped to the sprite, not the physical joint');
  assert.ok(Math.abs(geometry.userData.blendHeight - .30) < 1e-8, 'native broad falloff restored');
  assert.equal(geometry.userData.planeCellCount, 6 * segmentsY, 'no extra geometry cells');
  const expected = 6 * segmentsY * 6 * 2; // Two triangles, three vertices, two rendered faces per cell.
  const positions = geometry.getAttribute('position'), uvs = geometry.getAttribute('uv');
  const indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  assert.equal(positions.count, expected, 'two-sided mesh keeps the original fixed vertex budget');
  assert.equal(indices.count, expected, 'every vertex has four skin-bone slots');
  const samples = new Map(); // Exact centerline rows used below for fold tests.
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i), x = positions.getX(i);
    assert.ok(Math.abs((uvs.getY(i) - (0.5 + y / modelHeight))) < 1e-5, 'texture UVs track redistributed vertex rows');
    const total = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
    assert.ok(Math.abs(total - 1) < 1e-5, 'four skin weights normalize at every vertex');
    const turn = [0, 1, 2, 3].reduce((sum, j) => {
      const bone = indices.array[i * 4 + j];
      return sum + (bone === 8 || bone === 9 ? weights.array[i * 4 + j] : 0);
    }, 0);
    const pixelX = (x + .5) * size;
    const expectedTurn = ctx.neckBlendWeight(y, neckY, geometry.userData.blendHeight, modelHeight);
    const expectedScale = ctx.headScaleWeightAt(y, neckY, modelHeight, pixelX, { left: size * .3, right: size * .7 }, expectedTurn, geometry.userData.blendHeight);
    assert.ok(Math.abs(turn - Math.max(expectedTurn, expectedScale)) < 1e-5, 'GPU weights reproduce legacy broad turn and independent scale');
    assert.ok([0, 1, 2, 3].every(j => indices.array[i * 4 + j] !== 7 || weights.array[i * 4 + j] === 0), 'no long placement-only pseudo-neck: real spine supplies remaining weight');
    if (Math.abs(x) < 1e-5) {
      const spineReachShare = [0, 1, 2, 3].reduce((sum, j) => {
        const bone = indices.array[i * 4 + j]; // Actual y-displacement at each spine bone k is reach * k/6; short neck bones inherit the tip's full reach.
        return sum + weights.array[i * 4 + j] * (bone >= 7 ? 1 : bone / 6);
      }, 0);
      const key = Math.round(y * 1e7);
      if (!samples.has(key)) samples.set(key, { y, spineReachShare });
      else assert.ok(Math.abs(samples.get(key).spineReachShare - spineReachShare) < 1e-5,
        'front, back and duplicated triangle vertices use identical seven-node spine stretch');
    }
  }
  const rows = [...samples.values()].sort((a, b) => b.y - a.y);
  assert.ok(rows.length >= segmentsY, 'the mesh contains the full range of neck-adapted rows');
  for (const offset of [-0.12, -0.095, -0.055, 0.12]) {
    for (let i = 1; i < rows.length; i++) {
      const above = rows[i - 1], below = rows[i];
      const renderedAbove = above.y + offset * above.spineReachShare;
      const renderedBelow = below.y + offset * below.spineReachShare;
      assert.ok(renderedAbove >= renderedBelow - 2e-6,
        `offset ${offset} inverted portrait rows at ${above.y.toFixed(6)} -> ${below.y.toFixed(6)}`);
    }
  }
  return { size, headBottom, segmentsY, rows: rows.length, bandHeightPx: bottom - top };
}
const cases = [
  verifyPixelBand(200, 65, 26),
  verifyPixelBand(200, 142, 36),
  verifyPixelBand(512, 210, 16),
  verifyPixelBand(2048, 660, 26),
  verifyPixelBand(200, 198, 26), // Head approaching canvas bottom cannot produce collapsed body triangles.
];
assert.match(source, /headOffsetJoint\.add\(neckJoint\)/, 'rotation lives below the placement joint in main character rig');
assert.match(source, /headOffsetBone\.add\(neckBone\)/, 'hostile front and rear rigs share the same hierarchy');
assert.match(fs.readFileSync('docs/js/character-rig-scale.js', 'utf8'), /spineApi\.applyNeckReach\(rig, reachY, modelHeight, composedHunch\)/,
  'spine-capable characters redistribute head-height and scale changes through their real spine before hunch');
assert.match(fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'), /avatarRef\.headOffsetJoint\?\.front/, 'hostile offsets use their separate placement bones');
console.log('Head rotation/offset: skin weights, two faces, UVs, portrait density and offset-fold cases PASS', JSON.stringify(cases));
