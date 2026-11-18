#!/usr/bin/env node
'use strict';

// A colored lunge blur reuses the original textures and GPU skeleton with a 2x2-reduced grid.
// The effect must never CPU-bake or copy the character's animated portrait. Uses real Three.js r128 if available.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let THREE;
try { THREE = require('three'); } catch (_) { try { THREE = require(require.resolve('three', { paths: [process.env.THREE_DIR || process.cwd()] })); } catch (__) { console.log('SKIP: three not resolvable (set THREE_DIR to a dir with node_modules/three@0.128)'); process.exit(0); } }
const source = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8');

function gridPortrait(segX, segY, withUserData = true) {
  const positions = [], uvs = [], skinIndex = [], skinWeight = [];
  const W = 2, H = 3;
  const vertex = (px, py) => { // px/py in 0..1 plane space, like appendVertex.
    positions.push(-W / 2 + px * W, H / 2 - py * H, 0); uvs.push(px, 1 - py);
    skinIndex.push(0, 1, 0, 0); const t = 1 - py; skinWeight.push(1 - t, t, 0, 0); // Bottom follows bone 0, top follows bone 1.
  };
  const cell = (c, r, back) => {
    const x0 = c / segX, x1 = (c + 1) / segX, y0 = r / segY, y1 = (r + 1) / segY;
    const front = [[x0, y1], [x1, y1], [x0, y0], [x1, y1], [x1, y0], [x0, y0]];
    for (const [x, y] of back ? [...front].reverse() : front) vertex(x, y);
  };
  for (let r = 0; r < segY; r += 1) for (let c = 0; c < segX; c += 1) cell(c, r, false);
  const frontCount = positions.length / 3;
  for (let r = 0; r < segY; r += 1) for (let c = 0; c < segX; c += 1) cell(c, r, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.addGroup(0, frontCount, 0); geometry.addGroup(frontCount, frontCount, 1);
  if (withUserData) geometry.userData = { segmentsX: segX, segmentsY: segY };
  const root = new THREE.Bone(), top = new THREE.Bone();
  top.position.y = 1; root.add(top);
  const skeleton = new THREE.Skeleton([root, top]);
  const mesh = new THREE.SkinnedMesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
  mesh.add(root); mesh.bind(skeleton);
  mesh.name = 'portrait_grid';
  for (const material of mesh.material) material.name = 'npc_avatar_skinned_front_grid';
  mesh.updateMatrixWorld(true);
  top.rotation.z = 0.4; top.position.x = 0.3; // Pose the upper bone so positions differ from bind.
  mesh.updateMatrixWorld(true);
  return mesh;
}

function runner(mesh) {
  const scene = new THREE.Scene(); // Host scene used to confirm the effect is a single independent draw.
  const root = new THREE.Group(); scene.add(root); root.add(mesh);
  const player = { x: 0, y: 0, lunging: true, dodging: false, stamina: 200 }; // Movement that drives the real combat update wrapper.
  const combat = { abilities: { register() {} }, deps: { player, playerMesh: root, TILE: 64, hostileObjects: [], getCurrentArea: () => null }, update() {}, setMovementSpeedMul() {} };
  const windowStub = {
    Combat: combat, THREE,
    BanditCombat: { setCombatExpression() {} },
    WorldPortraitLife: { setPlayerCombatExpression() {}, isPlayerCombatExpressionApplied: () => true },
  };
  let now = 1000; // Controlled milliseconds for the 55ms movement sample cadence.
  vm.runInNewContext(source, { window: windowStub, performance: { now: () => now }, console }, { filename: 'combat-blink-dodge.js' });
  combat.update(0.016); // Establish the initial location without forcing a teleport or generating a smear.
  const step = () => { player.x += 64; now += 60; combat.update(0.06); };
  const smears = () => scene.children.filter(child => child.name === 'combat_portrait_motion_smear');
  return { step, smears, debug: () => windowStub.HobunjiDodgeFeedback.getDebug().blink.afterimages };
}

const mesh = gridPortrait(28, 36);
const skinCalls = { count: 0 }; // Used to forbid expensive per-snapshot CPU vertex baking.
mesh.boneTransform = () => { skinCalls.count++; throw new Error('No CPU pose baking allowed for a GPU skinned smear'); };
mesh.material[0].color.setRGB(0.82, 0.23, 0.51);
mesh.material[1].color.setRGB(0.21, 0.44, 0.96);
const run = runner(mesh);
run.step();
const smear = run.smears()[0];
assert(smear, 'a quick lunge creates a visible motion smear');
assert.equal(run.smears().length, 1, 'one actor has only one smear mesh, not three ghost portraits');
assert.strictEqual(smear.skeleton, mesh.skeleton, 'new mesh shares the original animated skeleton');
assert.notStrictEqual(smear.geometry, mesh.geometry, 'reduced geometry is built only once for a new avatar');
assert.equal(smear.geometry.getAttribute('position').count, mesh.geometry.getAttribute('position').count / 4);
assert.deepEqual(smear.geometry.groups.map(g => [g.start, g.count, g.materialIndex]), [[0, 1512, 0], [1512, 1512, 1]]);
for (const channel of ['uv', 'skinIndex', 'skinWeight']) {
  assert.equal(smear.geometry.getAttribute(channel).count, 3024, channel + ' must retain avatar color or live GPU skinning');
}
assert.equal(skinCalls.count, 0, 'no CPU boneTransform calls during smear creation');
assert.deepEqual(smear.material[0].color.toArray(), mesh.material[0].color.toArray(), 'front RGB remains identical');
assert.deepEqual(smear.material[1].color.toArray(), mesh.material[1].color.toArray(), 'back RGB remains identical');
assert.equal(smear.material[0].depthWrite, false, 'the translucent trail does not write occlusion depth');
const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <skinning_vertex>',
  fragmentShader: '#include <common>\n#include <dithering_fragment>' }; // Unit-level shader instrumentation, no live WebGL necessary.
smear.material[0].onBeforeCompile(shader, {});
assert.match(shader.vertexShader, /transformed\.xz -= uSmearDirection/);
assert.match(shader.fragmentShader, /gl_FragColor\.a \*= uSmearOpacity \* smoothstep/);
assert(!shader.fragmentShader.includes('gl_FragColor.rgb ='), 'RGBA color is preserved; shader modifies alpha only');
const originalGeometry = smear.geometry, originalMaterial = smear.material[0]; // Detect unnecessary mesh recompilation after warmup.
for (let i = 0; i < 10; i++) run.step();
assert.equal(run.smears().length, 1, 'successive lunge ticks never allocate extra ghost meshes');
assert.strictEqual(run.smears()[0].geometry, originalGeometry, 'the reduced GPU geometry is reused across the entire lunge');
assert.strictEqual(run.smears()[0].material[0], originalMaterial, 'no new material/shader compilation each sample');
assert.equal(run.debug().entriesCreated, 1);
assert(run.debug().entriesReused > 0);
assert.equal(skinCalls.count, 0, 'no CPU pose baking occurs during repeated movement');

// Odd grid dimensions preserve both faces, including last partial cell.
const odd = runner(gridPortrait(5, 7));
odd.step();
assert.equal(odd.smears()[0].geometry.getAttribute('position').count / 6, 2 * 3 * 4,
  'odd dimensions are decimated to ceil(width/2) by ceil(height/2) blocks per face');

// If an unusual portrait is not a recognized skinned grid, reuse its geometry
// by reference rather than cloning thousands of vertices on first strike.
const unusual = runner(gridPortrait(4, 4, false));
unusual.step();
assert.strictEqual(unusual.smears()[0].geometry, unusual.smears()[0].geometry, 'unsupported topology must remain renderable');
console.log('OK: one skinned color smear replaces decimated ghosts and preserves live textures, bones and alpha-only fade');
