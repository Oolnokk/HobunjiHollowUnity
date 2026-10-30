'use strict';
// Executes the real leg handle + body composer: a weapon-stance drop must lower the hips and body while the soles stay on the floor
// and the leg bones keep their full length (knees fold). Needs three.js r128; skips (exit 0) when it is not resolvable from here.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let THREE;
try { THREE = require('three'); } catch (_) { try { THREE = require(require.resolve('three', { paths: [process.env.THREE_DIR || process.cwd()] })); } catch (__) { console.log('SKIP: three not resolvable (set THREE_DIR to a dir with node_modules/three@0.128)'); process.exit(0); } }

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const win = {
  THREE,
  SCRATCHBONES_CONFIG: { game: { appearanceEditor: { species: {} }, assets: { pngPlaneAvatar: { proceduralFeet: { enabled: true, stanceDrop: { heightFraction: 0.06 } } } } } },
  requestAnimationFrame() {},
};
win.window = win;
const sandbox = { window: win, THREE, URL, document: { currentScript: null, createElement: () => ({ getContext: () => null }) }, location: { href: 'http://localhost/index.html' }, console, performance: { now: () => 0 } };
vm.createContext(sandbox);
let bodyY, legWorldY, playerMesh, handle;
THREE.WebGLRenderer.prototype.render = function (s) { s.updateMatrixWorld(true); bodyY = playerMesh.getWorldPosition(new THREE.Vector3()).y; legWorldY = handle.group.getWorldPosition(new THREE.Vector3()).y; }; // r128 has no prototype render; the game installs one before the composer wraps it.
for (const f of ['docs/js/leg-bones.js', 'docs/js/procedural-leg-animation.js', 'docs/js/player-body-transform-composer.js']) vm.runInContext(read(f), sandbox, { filename: f });

const H = 2;
playerMesh = new THREE.Group();
handle = win.ProceduralLegAnimation.attach(THREE, playerMesh, { speciesId: 'human', gender: 'male', modelWidth: 0.9, modelHeight: H, name: 'player' });
assert(handle, 'legs attach');
playerMesh.add(handle.group);
assert.strictEqual(win.PlayerBodyTransformComposer.getPlayerLegHandle(), handle, 'composer exposes the player leg handle');

const settle = () => { for (let i = 0; i < 60; i++) handle.update(1 / 30, 0, false, undefined, {}); };
const measure = () => {
  playerMesh.updateMatrixWorld(true);
  const dbg = handle.getStandingPoseDebug();
  const chains = {};
  handle.group.traverse(o => { if (/_(hip|thigh|calf)$/.test(o.name)) chains[o.name] = o; });
  const hip = chains.left_hip.position.y;
  const calfLen = chains.left_calf.userData.hobunjiCalfLength;
  const thighLen = -chains.left_calf.position.y;
  return { hip, bones: thighLen + calfLen, footY: dbg.left.targetY, posteriorY: dbg.posteriorY };
};

settle();
const rest = measure();
assert(Math.abs(rest.hip - rest.posteriorY) < 1e-9, 'rest hip at posterior');

const drop = 0.06 * H;
handle.setStanceDrop(drop);
settle();
const lowered = measure();
assert(Math.abs(handle.getStanceDrop() - drop) < 1e-4, `drop applied (${handle.getStanceDrop()})`);
assert(Math.abs(lowered.hip - (rest.hip - drop)) < 1e-4, 'hips sink by the drop');
assert(Math.abs(lowered.footY - rest.footY) < 1e-9, 'feet targets stay at floor contact height');
assert(Math.abs(lowered.bones - (rest.hip - rest.footY)) < 1e-3, `legs not shortened: bones ${lowered.bones} vs ${rest.hip - rest.footY}`);

// Airborne/suppressed gating releases the drop.
handle.update(1 / 30, 0, true, undefined, {}); for (let i = 0; i < 90; i++) handle.update(1 / 30, 0, true, undefined, {});
assert.strictEqual(handle.getStanceDrop(), 0, 'suppressed (mounted etc.) releases the drop');
handle.update(1 / 30, 0, false, undefined, {}); settle();
assert(handle.getStanceDrop() > 0, 'drop returns once the legs own locomotion again');
handle.setStanceDrop(0); settle();
assert.strictEqual(handle.getStanceDrop(), 0, 'releasing the stance restores the standing pose exactly');
assert(Math.abs(measure().hip - rest.hip) < 1e-9);

// Composer: body lowered, leg group counter-raised, both restored after render.
const composer = win.PlayerBodyTransformComposer;
composer.setChannel('t', { plantedLegs: true, translation: { x: 0, y: -drop, z: 0 } });
const scene = new THREE.Scene(); scene.add(playerMesh);
const fakeRenderer = Object.create(THREE.WebGLRenderer.prototype);
{
  fakeRenderer.render(scene, new THREE.PerspectiveCamera());
  assert(Math.abs(bodyY - -drop) < 1e-9, `body lowered (${bodyY})`);
  assert(Math.abs(legWorldY) < 1e-9, `leg group stays on the floor (${legWorldY})`);
  assert.strictEqual(playerMesh.position.y, 0, 'render delta undone');
  assert.strictEqual(handle.group.position.y, 0, 'leg group restored after render');
}
console.log('weapon-stance-drop OK');
