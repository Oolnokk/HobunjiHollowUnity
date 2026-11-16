#!/usr/bin/env node
'use strict';

// X-ray groups keep the saved depth and punch out only the holder's nearby
// floor (stencil-marked where frontmost, then reset to far), redrawing only
// objects that touch that actor-centered circular patch. Runs the real helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/held-object-render-order.js'), 'utf8');
const slice = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert(i > 0 && j > i, a); return source.slice(i, j); };
const code = [slice('  function setGroundElevationFilter(', '  // Ordinary parts need repaired cutout/cover depth')].join('\n');

const C = { AlwaysDepth: 'ALWAYS_D', LessEqualDepth: 'LEQUAL_D', AlwaysStencilFunc: 'ALWAYS_S', EqualStencilFunc: 'EQUAL_S', KeepStencilOp: 'KEEP', ReplaceStencilOp: 'REPLACE', ZeroStencilOp: 'ZERO' };
class Box3 { constructor() { this.min = {}; this.max = {}; } copy(b) { this.min = { ...b.min }; this.max = { ...b.max }; return this; } applyMatrix4(m) { for (const k of ['x', 'y', 'z']) { this.min[k] += m[k] || 0; this.max[k] += m[k] || 0; } return this; } }
const THREE = { ...C, Box3, ShaderMaterial: class { constructor(o) { Object.assign(this, o); } }, PlaneGeometry: class {}, Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
  Scene: class { constructor() { this.children = []; } add(o) { this.children.push(o); } }, OrthographicCamera: class {} };
const draws = [];
const rawRender = { call(renderer, scene, camera) {
  draws.push({ scene, mask: camera.layers?.mask, materials: [...groundMats].map(m => ({ ...m, uniforms: undefined, enabled: m.userData.hobunjiXrayElevationShader.uniforms.enabled.value })), hiddenUnsupported: !unsupportedMesh.visible, hiddenFarGround: !farGround.visible });
} };
const forEachMaterial = (m, fn) => (Array.isArray(m) ? m : [m]).forEach(fn);
const restoreVisibility = states => { for (const [o, v] of states) o.visible = v; };
const mat = supported => ({ colorWrite: true, depthWrite: true, depthTest: true, depthFunc: 'LEQUAL_D', stencilWrite: false, stencilFunc: 'ALWAYS_S', stencilRef: 0, stencilFuncMask: 0xff, stencilWriteMask: 0xff, stencilFail: 'KEEP', stencilZFail: 'KEEP', stencilZPass: 'KEEP',
  userData: { hobunjiXrayElevationShader: { supported, uniforms: { enabled: { value: 0 }, elevation: { value: 0 }, centerCount: { value: 0 }, centers: { value: null } } } } });
const grass = mat(true), dirt = mat(true), custom = mat(false);
const groundMats = new Set([grass, dirt, custom]);
const filteredMesh = { visible: true, material: grass }, unsupportedMesh = { visible: true, material: custom };
const farGround = { visible: true, material: dirt, matrixWorld: {}, geometry: { boundingBox: { min: { x: 40, y: 0, z: 40 }, max: { x: 48, y: 1, z: 48 } } } }; // Cannot contain the holder's floor.
const hasLayer = (o, l) => (((o.layers?.mask ?? 1) >>> 0) & (1 << l)) !== 0;
const api = new Function('THREE', 'rawRender', 'forEachMaterial', 'restoreVisibility', 'instancedReplaySphere', 'XRAY_CIRCLE_RADIUS', 'GROUND_REPLAY_MASK', 'GROUND_REPLAY_LAYER', 'hasLayer', 'XRAY_ELEVATION_TOLERANCE', code +
  '\nreturn { punchHeldGroupFloor, hideOutsideFloorPatch, setGroundElevationFilter, setEnabled: v => { floorPunchEnabled = v; }, stats: () => ({ floorPunches, floorPunchRefillHidden, floorPunchRefillKept }) };')(
  THREE, rawRender, forEachMaterial, restoreVisibility, () => null, 1.5, 1 << 28, 28, hasLayer, 0.08);

const camera = { layers: { mask: 0xffffffff } };
const colorLog = [];
const colorBuffer = { setMask: v => colorLog.push(['mask', v]), setLocked: v => colorLog.push(['lock', v]) };
const group = { elevation: 0, regions: [{ col: 10, row: 10, x: 10.5, z: 10.5 }], centers: new Float32Array([10.5, 10.5]) };
assert.equal(api.punchHeldGroupFloor({}, {}, camera, group, [filteredMesh, unsupportedMesh, farGround], groundMats, colorBuffer), true);
assert.equal(draws.length, 2, 'one ground-layer stencil pass, one far-depth quad');
const [groundPass, quadPass] = draws;
assert.equal(groundPass.mask, 1 << 28, 'only the ground replay layer is drawn');
assert.ok(groundPass.hiddenUnsupported, 'a mesh whose material has no compiled filter is kept out of the punch');
assert.ok(groundPass.hiddenFarGround && farGround.visible, 'ground that cannot touch the patch is skipped for the punch, then shown again');
const g = groundPass.materials.find(m => m.userData === grass.userData);
assert.deepEqual([g.colorWrite, g.depthWrite, g.depthFunc, g.stencilWrite, g.stencilFunc, g.stencilZPass, g.stencilWriteMask, g.enabled], [false, false, 'LEQUAL_D', true, 'ALWAYS_S', 'REPLACE', 0x02, 2],
  'ground marks bit 0x02 only where its nearby floor passes LEQUAL against the existing depth, filter inverted (2)');
assert.equal(groundPass.materials.find(m => m.userData === custom.userData).stencilWrite, false, 'unsupported materials are not switched to stencil writes');
const quad = quadPass.scene.children[0].material;
assert.deepEqual([quad.depthFunc, quad.depthWrite, quad.colorWrite, quad.stencilFunc, quad.stencilRef, quad.stencilFuncMask, quad.stencilZPass, quad.stencilWriteMask], ['ALWAYS_D', true, false, 'EQUAL_S', 0x02, 0x02, 'ZERO', 0x02],
  'the quad writes far depth exactly on marked pixels and clears the mark');
const portraitBits = Number(source.match(/const FRONT_PORTRAIT_STENCIL_MASK = (0x\w+)/)[1]);
assert.equal(quad.stencilWriteMask & (portraitBits | 1), 0, 'the floor reset cannot erase portrait ownership or water tint');
assert.match(quad.vertexShader, /gl_Position = vec4\(position\.xy, 1\.0, 1\.0\)/, 'quad depth is the far plane');
assert.deepEqual([grass.colorWrite, grass.depthWrite, grass.stencilWrite, grass.stencilWriteMask, grass.userData.hobunjiXrayElevationShader.uniforms.enabled.value], [true, true, false, 0xff, 1],
  'material state is restored and the ordinary filter (1) is left on for the local refill');
assert.equal(unsupportedMesh.visible, true, 'hidden meshes come back');
assert.equal(camera.layers.mask, 0xffffffff);
assert.deepEqual(colorLog, [['mask', false], ['lock', true], ['lock', false], ['mask', true]], 'colour is locked off only during the punch');

// Patch cull: objects touching the circle's conservative bounds (+1.5 margin) stay; far ones leave; unbounded stay.
const boxed = (x0, x1, z0, z1) => ({ visible: true, matrixWorld: {}, geometry: { boundingBox: { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: 5, z: z1 } } } });
const inside = boxed(10, 11, 10, 11), edge = boxed(12.9, 14, 10, 11), far = boxed(30, 31, 30, 31), unbounded = { visible: true, matrixWorld: {}, geometry: {} };
const patchGround = { ...boxed(9, 12, 9, 12), layers: { mask: 1 | (1 << 28) } }; // The floor chunk under the holder.
const aboveFloor = boxed(10, 11, 10, 11); aboveFloor.geometry.boundingBox.min.y = 0.5; // e.g. the holder's torso: wholly above the floor.
const hidden = api.hideOutsideFloorPatch([inside, edge, far, unbounded, patchGround, aboveFloor], group);
assert.deepEqual([inside.visible, edge.visible, far.visible, unbounded.visible, patchGround.visible, aboveFloor.visible], [true, true, false, true, false, false],
  'the refill keeps non-ground objects in the patch column that reach below the floor; ground, far and wholly-above objects leave');
restoreVisibility(hidden);
assert.equal(far.visible, true);

api.setEnabled(false);
assert.equal(api.punchHeldGroupFloor({}, {}, camera, group, [], groundMats, colorBuffer), false, 'A/B switch');

// Shader: mode 2 keeps ONLY the nearby floor, mode 1 discards it, 0 is off.
assert.match(source, /if \(uHobunjiXrayElevationEnabled > 1\.5\) \{ if \(hobunjiXrayNearFloor < 0\.5\) discard; \}\s*\nelse if \(hobunjiXrayNearFloor > 0\.5\) discard;/);
assert.match(source, /hobunji-ground-circle-xray-v6/, 'shader change bumps the program cache key');
console.log('ok - x-ray groups punch only the holder\'s nearby floor and redraw only its patch');
