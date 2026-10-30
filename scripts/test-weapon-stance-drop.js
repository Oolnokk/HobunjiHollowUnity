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

// The leg group is raised by the sink (persistent, so skinned garments see it); the body owner lowers the body by the same amount.
handle.setStanceDrop(drop); settle();
assert(Math.abs(handle.group.position.y - drop) < 1e-4, `leg group raised by the sink (${handle.group.position.y})`);
const composer = win.PlayerBodyTransformComposer;
composer.setChannel('t', { translation: { x: 0, y: -handle.getStanceDrop(), z: 0 } });
const scene = new THREE.Scene(); scene.add(playerMesh);
const fakeRenderer = Object.create(THREE.WebGLRenderer.prototype);
fakeRenderer.render(scene, new THREE.PerspectiveCamera());
assert(Math.abs(bodyY - -drop) < 1e-4, `body lowered (${bodyY})`);
assert(Math.abs(legWorldY) < 1e-4, `leg group nets to the floor (${legWorldY})`);
assert.strictEqual(playerMesh.position.y, 0, 'render delta undone');
composer.clearChannel('t');
handle.setStanceDrop(0); settle();
assert.strictEqual(handle.group.position.y, 0, 'leg group back on the floor when the sink is released');

// Pose channel: bodySink lerps Neutral -> Windup -> Strike like every other channel, in percent of height.
const SAP = (() => { const w = { SCRATCHBONES_CONFIG: win.SCRATCHBONES_CONFIG, setTimeout, performance }; w.window = w; vm.runInNewContext(read('docs/js/combat/shared-attack-pose.js'), { window: w, performance }, { filename: 'shared-attack-pose.js' }); return w.SharedAttackPose; })();
assert.strictEqual(SAP.idleBodySinkPct(), 6, 'idle stance sink comes from proceduralFeet.stanceDrop.heightFraction');
const out = SAP.createSample();
const pose = { neutral: { bodySink: 6 }, windup: { bodySink: 14 }, strike: { bodySink: 2 } };
const at = p => SAP.samplePose(out, pose, SAP.STYLE_NEUTRAL_POSE.thrust, p, 0.3, 0.5, 0.7).bodySink;
assert(Math.abs(at(0) - 6) < 1e-9, 'starts at the neutral sink');
assert(Math.abs(at(0.3) - 14) < 1e-9, 'reaches the windup sink');
assert(Math.abs(at(0.5) - 2) < 1e-9, 'reaches the strike sink');
assert(at(0.15) > 6 && at(0.15) < 14, 'lerps across the windup');
const inherit = SAP.samplePose(out, { neutral: { bodySink: 9 }, windup: {}, strike: {} }, SAP.STYLE_NEUTRAL_POSE.thrust, 0.4, 0.3, 0.5, 0.7).bodySink;
assert(Math.abs(inherit - 9) < 1e-9, 'a pose without an authored sink inherits the neutral');
assert.strictEqual(SAP.samplePose(out, {}, SAP.STYLE_NEUTRAL_POSE.thrust, 0.4, 0.3, 0.5, 0.7).bodySink, 0, 'no authored sink at all means standing');
console.log('weapon-stance-drop OK');
