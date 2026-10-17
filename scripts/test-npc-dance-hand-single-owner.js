#!/usr/bin/env node
'use strict';

// NPC dance hands have one owner: NpcDancePresentationRuntime's late sentinel.
// npc-social-inhibition-runtime.js used to add the same overhead punch on its
// render hook first; the late runtime then re-based from that already-posed
// socket and added the punch again, lifting hands ~2 arm lengths overhead.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'npc-social-inhibition-runtime.js'), 'utf8');

function vec(x = 0, y = 0, z = 0) {
  return { x, y, z, clone() { return vec(this.x, this.y, this.z); }, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } };
}
function quat() {
  return { x: 0, y: 0, z: 0, w: 1, clone() { return quat(); }, copy() { return this; } };
}
function node(name, children = []) {
  const n = {
    name, children, position: vec(name.includes('left') ? -0.2 : 0.2, 0.1, 0), quaternion: quat(), rotation: { y: 0 },
    rotateX() {}, rotateY() {}, rotateZ() {}, updateMatrix() {}, updateMatrixWorld() {},
    traverse(fn) { fn(this); for (const child of this.children) child.traverse(fn); },
  };
  return n;
}

async function run(presentationInstalled) {
  class Renderer {}
  Renderer.prototype.render = function render() {};
  const left = node('left_hand_socket');
  const right = node('right_hand_socket');
  const root = node('npc_root', [left, right]);
  root.position = vec(3.5, 0, 4.5);
  const walker = {
    root, state: 'idle', area: 'test', avatarHeight: 0.72, avatarWidth: 0.6,
    avatarGroup: { userData: { proceduralHandRig: { armLengthForSide: () => 0.34 } } },
    currentScheduleTarget: { socialDance: { stimulusId: 'probe', style: 'loose-sway', armStyle: 'overhead-punch', sourceX: 5, sourceZ: 4.5 } },
  };
  const windowObject = {
    THREE: { WebGLRenderer: Renderer },
    NpcActivityPlanner: { init() {}, resolveNpcTarget: () => null },
    SocialRhythmClock: { dancerBeatAt: () => 0.5 }, // Mid-beat: the left punch is at full extension.
    performance: { now: () => 0 },
    setInterval: () => 0,
  };
  if (presentationInstalled) windowObject.NpcDancePresentationRuntime = { installed: true };
  const context = { window: windowObject, performance: windowObject.performance, console, setInterval: () => 0, Promise };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'npc-social-inhibition-runtime.js' });
  windowObject.NpcActivityPlanner.init({ listNpcWalkersInArea: () => [walker], getCurrentArea: () => 'test' });

  const before = left.position.y;
  windowObject.THREE.WebGLRenderer.prototype.render.call({}, {}, {});
  const during = left.position.y;
  await Promise.resolve();
  await Promise.resolve();
  return { before, during, after: left.position.y, debug: windowObject.NpcSocialInhibition.getDebug() };
}

(async () => {
  const owned = await run(true);
  assert.ok(owned.debug.danceApplications >= 1, 'the inhibition runtime still applies the rest of the dance presentation');
  assert.equal(owned.during, owned.before, 'with the late presentation runtime installed, the inhibition hook leaves hand sockets alone');

  const legacy = await run(false);
  assert.ok(legacy.during > legacy.before + 0.3, 'without the presentation runtime, the inhibition hook still lifts the hands itself');
  assert.equal(legacy.after, legacy.before, 'its hand pose is restored after the frame');

  console.log('NPC dance hands have a single owner: ok');
})().catch(error => { console.error(error); process.exit(1); });
