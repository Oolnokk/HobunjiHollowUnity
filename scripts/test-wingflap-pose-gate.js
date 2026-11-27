'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/tzatzul-live-visuals.js'), 'utf8');
const calls = []; // Captures exact audio starts/stops as the authoritative visual wing pose changes.
const nativeGroup = {
  children: [],
  parent: {},
  userData: {},
  add(child) { this.children.push(child); child.parent = this; },
}; // Native flying avatar attachment root used by the real visual owner.
const bird = {
  id: 'bird1', creatureKey: 'tzatzul', areaId: 'forest',
  x: 64, y: 64, health: 12, tzatzulFlightPose: 'perched',
  avatarRef: { group: nativeGroup },
};
const actors = new Set([bird]);
const window = {
  AudioSystem: {
    playWingflapSfx(actor) { calls.push({ action: 'play', actor }); return true; },
    stopWingflapSfx(actor) { calls.push({ action: 'stop', actor }); return true; },
  },
  TzatzulRegistration: {
    KIND: 'tzatzul', HATCHLING_KIND: 'tzatzul-hatchling',
    identityFor() { return { color: '#aaaaaa' }; },
    createRig() {
      return {
        flapHz: 2.2, // Authored visual flapping rate is also the audio recurrence rate.
        root: { scale: { setScalar() {} }, rotation: {}, position: {}, parent: null },
        update() {}, dispose() {},
      };
    },
  },
};
const context = { window, performance: { now: () => 1000 }, Math, Promise, Set, Map, console };
window.window = window;
vm.runInNewContext(source, context, { filename: 'tzatzul-live-visuals.js' });
const visuals = window.TzatzulLiveVisuals;
visuals.init({
  hostileObjects: actors,
  companionObjects: new Set(),
  getCurrentArea: () => 'forest',
  player: { x: 0, y: 0 },
  TILE: 64,
});

(async () => {
  visuals.tick(0.02); // Initial scan mounts the shared native bird rig asynchronously.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(visuals.snapshot().liveRigs, 1, 'real authored bird rig is mounted');
  visuals.tick(0.02);
  assert.equal(calls.length, 0, 'perched bird must not produce footstep-like wing noise');

  bird.tzatzulFlightPose = 'flap';
  visuals.tick(0.02);
  assert.deepEqual(calls.map(c => c.action), ['play'], 'entering a flap starts one flap sound');
  visuals.tick(0.1);
  assert.equal(calls.length, 1, 'one wingbeat does not spam the sound on each frame');
  visuals.tick(0.25);
  visuals.tick(0.25);
  assert.deepEqual(calls.map(c => c.action), ['play', 'play'],
    'continuing flapping repeats once per actual wing rig cycle');

  bird.tzatzulFlightPose = 'glide';
  visuals.tick(0.02);
  assert.deepEqual(calls.map(c => c.action), ['play', 'play', 'stop'],
    'gliding stops an in-progress flap sample, not merely future triggers');
  visuals.tick(0.25);
  assert.equal(calls.length, 3, 'sustained glide stays completely silent');

  bird.tzatzulFlightPose = 'perched';
  visuals.tick(0.25);
  assert.equal(calls.length, 3, 'perching neither plays nor repeatedly stops a clip');

  bird.tzatzulFlightPose = 'flap';
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'play', 'resuming a real flap immediately restarts its sound');
  bird.prone = true;
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'stop', 'knockdown silences an otherwise flapping rig');
  bird.prone = false;
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'play', 'recovered bird flapping makes noise again');

  bird.tzatzulInNest = true;
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'stop', 'hidden birds cannot continue playing wings outside the nest');
  bird.tzatzulInNest = false;
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'play');
  const rigRoot = nativeGroup.children[0]; // The mounted Three.Group may temporarily detach during avatar rebuild.
  assert(rigRoot, 'fixture must contain the mounted flight rig');
  rigRoot.parent = null;
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'stop', 'a detached/hidden rig cannot leave a phantom audible flap');
  rigRoot.parent = nativeGroup;
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'play', 'restored flying art can sound its actual flap again');
  bird.health = 0;
  visuals.tick(0.02);
  assert.equal(calls.at(-1).action, 'stop', 'despawn/death also releases wing sound ownership');
  assert.equal(visuals.snapshot().tracked, 0);

  console.log('Flying visual flap/glide/perch sound synchronization regression: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
