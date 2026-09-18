const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/procedural-swim-gait.js', 'utf8'); // Executes the real shared runtime/editor swim module below.
const panelUi = fs.readFileSync('docs/js/panel-ui.js', 'utf8'); // Guards the procedural editor loader seam.
const combatLoader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Guards the runtime loader seam.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); this.isVector3 = true; }
  set(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
  distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
  lerp(other, t) {
    this.x += (other.x - this.x) * t;
    this.y += (other.y - this.y) * t;
    this.z += (other.z - this.z) * t;
    return this;
  }
}
class CopyTarget { copy(value) { this.value = value; return this; } }
class WebGLRenderer {}
let baseRenderCalls = 0;
WebGLRenderer.prototype.render = function () { baseRenderCalls += 1; };

function foot(x) {
  const node = {
    position: new Vector3(x, 0, 0),
    quaternion: new CopyTarget(),
    getWorldPosition(out) { return out.copy(this.position); },
  };
  return node;
}
function legRoot() {
  const parts = {
    left_hip: { position: new Vector3(-0.1, 0.3, 0) },
    left_thigh: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    left_calf: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    left_foot: foot(-0.1),
    right_hip: { position: new Vector3(0.1, 0.3, 0) },
    right_thigh: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    right_calf: { position: new Vector3(), quaternion: new CopyTarget(), children: [] },
    right_foot: foot(0.1),
  };
  return {
    position: new Vector3(),
    rotation: {},
    quaternion: {},
    updateMatrixWorld() {},
    worldToLocal(vector) { return vector; },
    getObjectByName(name) { return parts[name] || null; },
  };
}

let inWater = true;
let lastSuppressed = null;
let setChannelCall = null;
const clearedChannels = [];
const player = { x: 100, y: 100, prone: false };
const bodyRoot = { rotation: { y: 0 } };
const ProceduralLegAnimation = {
  attach(_THREE, _parent, options) {
    return {
      group: legRoot(),
      update(_dt, _speed, suppressed) { lastSuppressed = !!suppressed; },
      options,
    };
  },
};
const PlayerBodyTransformComposer = {
  setChannel(name, contribution) { setChannelCall = { name, contribution }; },
  clearChannel(name) { clearedChannels.push(name); if (setChannelCall?.name === name) setChannelCall = null; },
  resolvedYawDeltaRad() { return 0; },
  getPlayerMesh() { return bodyRoot; },
};
const THREE = { Vector3, WebGLRenderer };

const window = {
  THREE,
  ProceduralLegAnimation,
  PlayerBodyTransformComposer,
  Combat: { deps: { player, TILE: 48 } },
  HobunjiAnimalSubtleElevation: { isInSwimWater: () => inWater },
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { referenceSpeedWorldUnitsPerSecond: 4.3 } } } } },
  LegBones: {
    solveTwoBoneLeg(_three, { hip, foot: target }) {
      const full = hip.distanceTo(target);
      return {
        thighQuaternion: {},
        thighLength: full * 0.5,
        calfLocalQuaternion: {},
        calfLength: full * 0.5,
      };
    },
  },
};

vm.runInNewContext(source, { window, console, Math, Number, Object, Array, Set }, { filename: 'procedural-swim-gait.js' });
const api = window.HobunjiProceduralSwimGait;
assert.ok(api, 'shared procedural swim API installs');
assert.equal(api.version, 1);

const nearly = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);
nearly(api.facingYawFromMovement(1, 0), Math.PI / 2, 'east movement uses the game player-facing yaw convention');
nearly(api.facingYawFromMovement(0, 1), 0, 'south/map+Y movement maps to zero player-facing yaw');
nearly(api.facingYawFromMovement(-1, 0), -Math.PI / 2, 'west movement uses the opposite yaw');
assert.equal(api.facingYawFromMovement(0, 0), null, 'zero movement does not invent a swim facing');

const leftKick = api.sampleKick(0.25, 1);
const rightKick = api.sampleKick(0.75, 1);
assert.ok(leftKick.travelRatio > 0 && rightKick.travelRatio < 0, 'half-cycle-separated legs kick in opposite travel directions');
nearly(Math.abs(leftKick.travelRatio), Math.abs(rightKick.travelRatio), 'alternating kick reach is symmetric');

const playerLegs = window.ProceduralLegAnimation.attach(THREE, {}, { name: 'player' });
playerLegs.update(0.016, 2.5, false, undefined);
assert.equal(lastSuppressed, true, 'swimming suppresses the ordinary ground-contact gait');
let debug = api.getDebug();
assert.equal(debug.runtime.swimming, true, 'runtime enters swim mode on the shared water detector');
assert.ok(debug.runtime.strength > 0, 'moving swim mode drives kick strength');
assert.equal(debug.runtime.hasDirection, false, 'first water frame does not invent a direction before resolved movement exists');

player.x += 8;
playerLegs.update(0.016, 2.5, false, undefined);
debug = api.getDebug();
assert.equal(debug.runtime.moving, true, 'resolved post-collision movement activates directional swimming');
assert.equal(debug.runtime.hasDirection, true, 'resolved movement records a swim heading');
THREE.WebGLRenderer.prototype.render.call({});
assert.ok(setChannelCall, 'pre-render swim facing publishes a body-composer channel');
assert.equal(setChannelCall.name, 'procedural-swim-facing');
nearly(setChannelCall.contribution.rotation.yaw, Math.PI / 2, 'whole-body swim yaw follows resolved movement');
assert.equal('translation' in setChannelCall.contribution, false, 'swim body channel never translates the player');
assert.equal(baseRenderCalls, 1, 'swim render hook preserves the underlying renderer call');

player.x += 8;
playerLegs.update(0.016, 2.5, true, undefined);
debug = api.getDebug();
assert.equal(debug.runtime.swimming, false, 'an already-suppressed avatar does not start a competing swim gait');
assert.equal(debug.runtime.strength, 0, 'suppressed locomotion has no swim kick strength');
assert.equal(debug.runtime.hasDirection, false, 'leaving active swim state clears stale direction');
assert.ok(clearedChannels.includes('procedural-swim-facing'), 'leaving swim mode clears the body-facing channel');

inWater = false;
playerLegs.update(0.016, 2.5, false, undefined);
assert.equal(lastSuppressed, false, 'ordinary ground gait resumes outside water');

const channelBlock = source.match(/composer\.setChannel\(BODY_CHANNEL, \{[\s\S]*?\n    \}\);/)?.[0] || '';
assert.ok(channelBlock, 'swim body composer call is present');
assert.doesNotMatch(channelBlock, /translation\s*:/, 'source-level guard: swim composer channel owns rotation only');
assert.match(source, /!suppressed && runtimeWaterCheck\(player\)/, 'runtime swim mode respects pre-existing locomotion suppression');
assert.match(source, /runtimeState\.hasDirection = false/, 'stale swim direction is explicitly cleared');
assert.match(source, /model\.rotation\.y = desiredYaw/, 'editor preview uses the same absolute yaw as runtime');
assert.doesNotMatch(source, /baseModelYaw \+ desiredYaw/, 'editor preview does not double-offset runtime-facing yaw');

assert.match(panelUi, /proceduralSwimGaitEditorScript/, 'procedural animation editor loads the shared Swim mode adapter');
assert.match(panelUi, /procedural-swim-gait\.js\?v=20260917b/, 'editor loader points at the current swim module revision');
assert.match(combatLoader, /procedural-swim-gait\.js\?v=20260917b/, 'runtime loader points at the current swim module revision');

console.log('procedural swim gait regression passed');
